import datetime
import os
from crewai.tools import tool
from ..database import SessionLocal
from ..models import InstagramAccount, PublishingLog, Log
from ..security import decrypt_token
from ..instagram import InstagramClient, InstagramAPIError

@tool("InstagramPublishTool")
def publish_to_instagram(
    username: str = None,
    access_token: str = None,
    media_path: str = None,
    caption: str = None,
    hashtags: str = None,
    post_id: int = None,
    account_id: int = None,
    is_video: bool = False
) -> str:
    """
    Publishes content (image or video) to a specific Instagram account using stored credentials.
    
    Parameters:
    - username: The username of the Instagram account.
    - access_token: The decrypted access token.
    - media_path: The local path or public URL of the media file.
    - caption: The optimized caption.
    - hashtags: The optimized hashtags.
    - post_id: (Optional) The ID of the log in publishing_logs.
    - account_id: (Optional) The ID of the Instagram account in the database.
    - is_video: (Optional) True if the file is a video, False otherwise.
    """
    db = SessionLocal()
    try:
        post = None
        if post_id:
            post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
            
        account = None
        if account_id:
            account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
        elif username:
            account = db.query(InstagramAccount).filter(InstagramAccount.instagram_username == username).first()
            
        if not account and post:
            account = db.query(InstagramAccount).filter(InstagramAccount.id == post.account_id).first()

        if account and account.status == "LOCKED":
            if post:
                post.status = "Failed"
                post.error_message = f"Error: Account {account.instagram_username} is LOCKED. Publishing blocked."
                db.commit()
            return f"Error: Account {account.instagram_username} is LOCKED. Publishing blocked."

        # Resolve credentials
        if not access_token and account:
            access_token = decrypt_token(account.page_access_token)

        if not access_token:
            raise ValueError("No access token provided or found for the Instagram account.")

        # Resolve media_path, caption, hashtags
        if not media_path and post:
            media_path = post.media_path
        if not media_path:
            raise ValueError("No media path provided or found for the post.")

        if not caption and post:
            caption = post.caption or ""
        
        # Combine caption and hashtags
        if hashtags and hashtags.strip() and hashtags not in caption:
            caption = f"{caption}\n\n{hashtags}"
        elif post and post.hashtags and post.hashtags.strip() and post.hashtags not in caption:
            caption = f"{caption}\n\n{post.hashtags}"

        if not is_video and media_path:
            video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
            _, ext = os.path.splitext(media_path.lower())
            is_video = ext in video_extensions

        # Log start
        start_log = Log(
            user_id=post.user_id if post else None,
            action="PUBLISH_START",
            description=f"Starting publication to Instagram feed for account: {username or (account.instagram_username if account else '')}"
        )
        db.add(start_log)
        db.commit()

        # Determine if simulation mode or real Graph API publishing
        is_mock = InstagramClient.is_mock_token(access_token)

        if is_mock:
            # Simulation Mode
            import time
            mock_container_id = "18273645901234567"
            mock_media_id = "17945612349876543"

            time.sleep(1.0)
            if post:
                post.status = "Success"
                post.post_id = mock_media_id
                post.published_at = datetime.datetime.utcnow()
                db.commit()

            success_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_SUCCESS",
                description=f"[SIMULATION] Successfully published post to {username or (account.instagram_username if account else '')}."
            )
            db.add(success_log)
            db.commit()

            return f"SUCCESS: [SIMULATION] Post successfully published to {username or (account.instagram_username if account else '')}."

        else:
            # Real Instagram Graph API Publishing
            # 1. Verify permissions
            InstagramClient.verify_token_permissions(access_token)

            # 2. Retrieve Instagram Business ID (linked to Facebook page)
            ig_business_id = InstagramClient.verify_account(access_token)

            # 3. Verify Instagram Account Type (Business or Creator)
            InstagramClient.verify_instagram_account_type(ig_business_id, access_token)

            # 4. Resolve public media URL
            # S3 url or local url
            if media_path.startswith("http://") or media_path.startswith("https://"):
                media_url = media_path
            else:
                from ..config import settings
                filename = os.path.basename(media_path)
                media_url = f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{filename}"

            # 5. Create media container
            container_id = InstagramClient.create_media_container(
                instagram_business_id=ig_business_id,
                media_url=media_url,
                caption=caption,
                access_token=access_token,
                is_video=is_video
            )

            # 6. Poll status until container is FINISHED/PUBLISHED
            InstagramClient.wait_for_container_processing(container_id, access_token)

            # 7. Publish media container
            media_id = InstagramClient.publish_media_container(ig_business_id, container_id, access_token)

            # 8. Verify post exists on Instagram
            InstagramClient.verify_published_post(media_id, access_token)

            if post:
                post.status = "Success"
                post.post_id = media_id
                post.published_at = datetime.datetime.utcnow()
                db.commit()

            success_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_SUCCESS",
                description=f"Successfully published post to {username or account.instagram_username}."
            )
            db.add(success_log)
            db.commit()

            return f"SUCCESS: Post successfully published to {username or account.instagram_username} (Media ID: {media_id})."

    except Exception as e:
        db.rollback()
        error_msg = str(e)
        if post:
            post.status = "Failed"
            post.error_message = error_msg
            db.commit()
        
        if account:
            if isinstance(e, InstagramAPIError) and any(x in error_msg.lower() for x in ["permissions", "oauth", "access token", "expired", "revoked"]):
                account.status = "LOCKED"
            db.commit()
            
        fail_log = Log(
            user_id=post.user_id if post else None,
            action="PUBLISH_FAILED",
            description=f"Failed publishing to account {username or (account.instagram_username if account else '')}. Error: {error_msg}"
        )
        db.add(fail_log)
        db.commit()
        raise e
    finally:
        db.close()

@tool("AuditLoggerTool")
def audit_log(action: str, message: str) -> str:
    """
    Writes a custom operational or audit log entry directly to the database.
    """
    db = SessionLocal()
    try:
        db_log = Log(
            action=action.upper(),
            description=message
        )
        db.add(db_log)
        db.commit()
        return f"Log entry created successfully: [{action.upper()}] {message}"
    except Exception as e:
        db.rollback()
        return f"Failed to write log entry: {str(e)}"
    finally:
        db.close()
