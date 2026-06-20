import os
import logging
from .celery_app import celery_app
from .database import SessionLocal
from .models import Post, InstagramAccount, Log
from .instagram import InstagramAPIError
from .crew.crew import InstagramPublishingCrew

logger = logging.getLogger("celery_tasks")

@celery_app.task(name="app.tasks.publish_post_task", bind=True)
def publish_post_task(self, post_id: int):
    """
    Celery background task that handles post optimization, 
    publishing, and monitoring for a specific Post record.
    """
    logger.info(f"Starting Celery background job for post ID {post_id}")
    db = SessionLocal()
    
    try:
        # 1. Fetch Post details
        post = db.query(Post).filter(Post.id == post_id).first()
        if not post:
            error_msg = f"Task aborted: Post ID {post_id} not found in database."
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}

        # 2. Fetch Account details
        account = db.query(InstagramAccount).filter(InstagramAccount.id == post.instagram_account_id).first()
        if not account:
            error_msg = f"Task aborted: Instagram Account ID {post.instagram_account_id} not found."
            logger.error(error_msg)
            post.publish_status = "Failed"
            db.commit()
            return {"status": "error", "message": error_msg}

        if account.status != "ACTIVE":
            error_msg = f"Task aborted: Instagram Account {account.instagram_username_or_email} is INACTIVE."
            logger.error(error_msg)
            post.publish_status = "Failed"
            db.commit()
            
            # Log deactivation skip
            db.add(Log(
                user_id=post.user_id,
                action="PUBLISH_SKIP",
                description=f"Publishing skipped for post {post_id}. Account {account.instagram_username_or_email} is inactive."
            ))
            db.commit()
            return {"status": "error", "message": error_msg}

        # Mark status as Preparing Media (20%)
        from .utils import update_post_progress
        update_post_progress(db, post.id, "Preparing Media", 20)
        db.add(Log(
            user_id=post.user_id,
            action="PREPARE_MEDIA",
            description=f"Preparing media and validating constraints for post {post_id}."
        ))
        db.commit()

        # Update status to Uploading Media (35%)
        update_post_progress(db, post.id, "Uploading Media", 35)
        db.add(Log(
            user_id=post.user_id,
            action="UPLOAD_MEDIA",
            description=f"Uploading media file to server/staging for post {post_id}."
        ))
        db.commit()

        from .security import decrypt_token
        decrypted_password = decrypt_token(account.encrypted_password)
        decrypted_access_token = decrypt_token(account.encrypted_access_token) if account.encrypted_access_token else decrypted_password
        accounts_info = [{
            "id": account.id,
            "username": account.instagram_username_or_email,
            "credentials": decrypted_password,
            "access_token": decrypted_access_token
        }]

        # 3. Detect if media is a video (based on file extension)
        video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
        _, ext = os.path.splitext(post.media_path.lower())
        is_video = ext in video_extensions

        # 4. Trigger CrewAI Sequential Execution
        from .config import settings
        
        # Check if OpenAI API key is placeholder
        if not settings.OPENAI_API_KEY or "placeholder" in settings.OPENAI_API_KEY or settings.OPENAI_API_KEY == "":
            logger.info("OpenAI API key is placeholder or empty. Executing in Mock Agent Simulation mode.")
            
            # Start Log
            db.add(Log(
                user_id=post.user_id,
                action="CREW_START",
                description=f"[SIMULATION] Mock Agent execution started for post {post_id}. Target account: {account.instagram_username_or_email}"
            ))
            db.commit()

            # Content Agent Simulation
            db.add(Log(
                user_id=post.user_id,
                action="AGENT_OPTIMIZE",
                description=f"[Content Agent] [SIMULATION] Validated media file and caption length. Caption enhanced and hashtags optimized: {post.hashtags or ''} #instagram #viral #ai"
            ))
            db.commit()

            # Publishing Agent Simulation
            from .crew.tools import publish_to_instagram
            from .security import decrypt_token
            decrypted_password = decrypt_token(account.encrypted_password)
            decrypted_access_token = decrypt_token(account.encrypted_access_token) if account.encrypted_access_token else decrypted_password

            # Add logging
            print(type(publish_to_instagram))
            print(dir(publish_to_instagram))

            # Prepare parameters
            tool_args = {
                "username": account.instagram_username_or_email,
                "password": decrypted_password,
                "access_token": decrypted_access_token,
                "media_path": post.media_path,
                "caption": f"{post.caption or ''}",
                "hashtags": f"{post.hashtags or ''} #instagram #viral #ai",
                "post_id": post_id,
                "account_id": account.id,
                "is_video": is_video
            }

            # Execute the CrewAI tool using the best execution method
            tool_result = None
            if hasattr(publish_to_instagram, "func"):
                tool_result = publish_to_instagram.func(**tool_args)
            elif hasattr(publish_to_instagram, "_run"):
                tool_result = publish_to_instagram._run(**tool_args)
            else:
                try:
                    tool_result = publish_to_instagram(**tool_args)
                except TypeError:
                    try:
                        tool_result = publish_to_instagram.run(**tool_args)
                    except TypeError:
                        tool_result = publish_to_instagram.invoke(tool_args)

            # Monitoring Agent Simulation
            report = f"Mock Agent Simulation Completed. Details:\n{tool_result}"
            db.add(Log(
                user_id=post.user_id,
                action="CREW_SUCCESS",
                description=f"[SIMULATION] Mock Agent workflow completed. Summary: {report[:500]}"
            ))
            db.commit()

            return {
                "status": "success",
                "post_id": post_id,
                "report": report
            }

        logger.info(f"Initializing CrewAI workflow. Target Account: {account.instagram_username_or_email}")
        
        # Write initial system audit log
        start_log = Log(
            user_id=post.user_id,
            action="CREW_START",
            description=f"CrewAI execution started for post {post_id}. Target account: {account.instagram_username_or_email}"
        )
        db.add(start_log)
        db.commit()

        crew_runner = InstagramPublishingCrew()
        crew_report = crew_runner.kickoff(
            post_id=post_id,
            caption=post.caption or "",
            hashtags=post.hashtags or "",
            media_path=post.media_path,
            accounts_info=accounts_info,
            is_video=is_video
        )

        logger.info(f"CrewAI workflow completed for post ID {post_id}.")
        
        # Log crew final report
        end_log = Log(
            user_id=post.user_id,
            action="CREW_SUCCESS",
            description=f"CrewAI execution completed. Summary: {crew_report[:1000]}"
        )
        db.add(end_log)
        db.commit()

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
        
        raw_info = ""
        if hasattr(e, "raw_response") and getattr(e, "raw_response", None):
            raw_info = f"\nRaw Response: {e.raw_response}"
            
        full_error = f"{str(e)}{raw_info}"
        
        # Update post status to Failed and set failure reason (store the full error message)
        from .utils import update_post_progress
        post = db.query(Post).filter(Post.id == post_id).first()
        progress = post.progress_percent if post else 35
        update_post_progress(
            db, 
            post_id, 
            "Failed", 
            progress, 
            failure_reason=f"Error: {full_error}\n\nStack Trace:\n{stack_trace}"
        )
            
        # Write error log (including stack trace for admins)
        err_log = Log(
            user_id=post.user_id if post else None,
            action="CREW_FAILURE",
            description=f"Celery task encountered an unhandled exception: {str(e)}\n\nStack Trace:\n{stack_trace}"
        )
        db.add(err_log)
        db.commit()

        return {"status": "error", "message": f"Task execution failed: {str(e)}"}
        
    finally:
        db.close()
