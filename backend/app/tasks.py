import os
import logging
import datetime
from .celery_app import celery_app
from .database import SessionLocal
from .models import PublishingLog, InstagramAccount, Log
from .instagram import InstagramClient, InstagramAPIError
from .crew.crew import InstagramPublishingCrew
from .security import decrypt_token

logger = logging.getLogger("celery_tasks")

@celery_app.task(name="app.tasks.publish_post_task", bind=True)
def publish_post_task(self, post_id: int):
    """
    Celery background task that handles post validation, optimization,
    and publishing to Instagram for a specific PublishingLog record.
    """
    logger.info(f"Starting Celery background job for publishing log ID {post_id}")
    db = SessionLocal()
    
    try:
        # 1. Fetch PublishingLog details
        post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
        if not post:
            error_msg = f"Task aborted: Publishing log ID {post_id} not found."
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}

        # 2. Fetch Account details
        account = db.query(InstagramAccount).filter(InstagramAccount.id == post.account_id).first()
        if not account:
            error_msg = f"Task aborted: Instagram Account ID {post.account_id} not found."
            logger.error(error_msg)
            post.status = "Failed"
            post.error_message = error_msg
            db.commit()
            return {"status": "error", "message": error_msg}

        if account.status == "LOCKED":
            error_msg = f"Task aborted: Instagram Account {account.instagram_username} is LOCKED."
            logger.error(error_msg)
            post.status = "Failed"
            post.error_message = error_msg
            db.commit()
            
            db.add(Log(
                user_id=post.user_id,
                action="PUBLISH_SKIP",
                description=f"Publishing skipped for post {post_id}. Account {account.instagram_username} is locked."
            ))
            db.commit()
            return {"status": "error", "message": error_msg}

        # 3. Before every publish, perform the requested validations
        decrypted_access_token = decrypt_token(account.page_access_token)
        
        # Validations:
        # - Token exists
        if not decrypted_access_token:
            raise ValueError("Token does not exist or is empty.")
            
        # - Token starts with EAA, reject if starts with IG
        token_str = decrypted_access_token.strip()
        if token_str.startswith("IG"):
            raise ValueError("Invalid token type. Tokens starting with 'IG' (Instagram User tokens) are not supported. A Facebook Page token starting with 'EAA' is required.")
        if not token_str.startswith("EAA") and not InstagramClient.is_mock_token(token_str):
            raise ValueError("Invalid token type. Token must be a Facebook Page token starting with 'EAA'.")

        # - Token not expired
        if account.token_expiry and account.token_expiry < datetime.datetime.utcnow():
            raise ValueError("Token is expired.")

        # Real Graph API validation if not mock
        if not InstagramClient.is_mock_token(token_str):
            # - Call GET /me and GET /me/accounts, verify permissions and Instagram Business Account linked
            InstagramClient.verify_token_permissions(token_str)
            ig_business_id = InstagramClient.verify_account(token_str)
            InstagramClient.verify_instagram_account_type(ig_business_id, token_str)

        # 4. Trigger S3 upload if file is local
        media_path = post.media_path
        if not (media_path.startswith("http://") or media_path.startswith("https://")):
            from .s3 import upload_file_to_s3
            unique_filename = os.path.basename(media_path)
            # Upload to S3 and get public URL
            public_url = upload_file_to_s3(media_path, unique_filename)
            media_path = public_url

        # 5. Detect if media is a video
        video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
        _, ext = os.path.splitext(post.media_path.lower())
        is_video = ext in video_extensions

        # 6. Kickoff CrewAI sequence
        account_info = {
            "id": account.id,
            "username": account.instagram_username,
            "access_token": decrypted_access_token
        }

        # Seed initial CREW_START log
        db.add(Log(
            user_id=post.user_id,
            action="CREW_START",
            description=f"CrewAI execution started for publishing log {post_id}. Target account: {account.instagram_username}"
        ))
        db.commit()

        crew_runner = InstagramPublishingCrew()
        crew_report = crew_runner.kickoff(
            post_id=post_id,
            caption=post.caption or "",
            hashtags=post.hashtags or "",
            media_path=media_path,
            account_info=account_info,
            is_video=is_video
        )

        logger.info(f"CrewAI workflow completed for publishing log ID {post_id}.")
        return {
            "status": "success",
            "post_id": post_id,
            "report": crew_report
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Failed to run publish task: {str(e)}", exc_info=True)
        import traceback
        stack_trace = traceback.format_exc()
        
        post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
        if post:
            post.status = "Failed"
            post.error_message = str(e)
            db.commit()
            
        if account:
            if any(x in str(e).lower() for x in ["permissions", "oauth", "access token", "expired", "revoked"]):
                account.status = "LOCKED"
            db.commit()

        # Write error log
        err_log = Log(
            user_id=post.user_id if post else None,
            action="CREW_FAILURE",
            description=f"Task execution failed: {str(e)}\n\nStack Trace:\n{stack_trace}"
        )
        db.add(err_log)
        db.commit()

        return {"status": "error", "message": f"Task execution failed: {str(e)}"}
        
    finally:
        db.close()
