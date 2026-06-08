import datetime
import os
from crewai.tools import tool
from ..database import SessionLocal
from ..models import InstagramAccount, Post, Log
from ..security import decrypt_token
from ..instagram import InstagramClient, InstagramAPIError
from ..config import settings

@tool("InstagramPublishTool")
def publish_to_instagram(post_id: int, account_id: int, caption: str, media_path: str, is_video: bool) -> str:
    """
    Publishes content (image or video) to a specific Instagram account using the Instagram Graph API.
    
    Parameters:
    - post_id: The ID of the post in the database.
    - account_id: The ID of the Instagram account to publish to.
    - caption: The optimized caption and hashtags.
    - media_path: The local path or public URL of the media file.
    - is_video: True if the file is a video, False otherwise.
    """
    db = SessionLocal()
    try:
        # 1. Fetch the post and the account details
        post = db.query(Post).filter(Post.id == post_id).first()
        if not post:
            return f"Error: Post ID {post_id} not found."
            
        account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
        if not account:
            post.publish_status = "Failed"
            db.commit()
            return f"Error: Account ID {account_id} not found."
            
        if account.status != "ACTIVE":
            post.publish_status = "Failed"
            db.commit()
            return f"Error: Account @{account.instagram_username} is INACTIVE. Publishing skipped."

        # Log start
        start_log = Log(
            user_id=post.user_id,
            action="PUBLISH_START",
            description=f"Starting publication of post {post_id} to Instagram account: @{account.instagram_username}"
        )
        db.add(start_log)
        db.commit()

        # 2. Decrypt token and prepare public media URL
        try:
            decrypted_access_token = decrypt_token(account.access_token)
        except Exception as e:
            post.publish_status = "Failed"
            db.commit()
            return f"Error decrypting token for account @{account.instagram_username}: {str(e)}"

        if media_path.startswith("http://") or media_path.startswith("https://"):
            public_media_url = media_path
        else:
            filename = os.path.basename(media_path)
            public_media_url = f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{filename}"

        # 3. Connect to Instagram Graph API
        ig_business_id = InstagramClient.verify_account(decrypted_access_token)
        
        # Create media container
        creation_id = InstagramClient.create_media_container(
            instagram_business_id=ig_business_id,
            media_url=public_media_url,
            caption=caption,
            access_token=decrypted_access_token,
            is_video=is_video
        )

        # If it is a video, wait for processing
        if is_video:
            InstagramClient.wait_for_video_processing(
                container_id=creation_id,
                access_token=decrypted_access_token
            )

        # Publish
        media_id = InstagramClient.publish_media_container(
            instagram_business_id=ig_business_id,
            creation_id=creation_id,
            access_token=decrypted_access_token
        )

        # 4. Success: Update database
        post.publish_status = "Success"
        
        success_log = Log(
            user_id=post.user_id,
            action="PUBLISH_SUCCESS",
            description=f"Successfully published post {post_id} to @{account.instagram_username}. Media ID: {media_id}"
        )
        db.add(success_log)
        db.commit()

        return f"SUCCESS: Post {post_id} successfully published to @{account.instagram_username}. Media ID: {media_id}"

    except InstagramAPIError as e:
        db.rollback()
        error_msg = f"Instagram API Error: {str(e)} (Code: {e.fb_error_code}, Subcode: {e.error_subcode})"
        post = db.query(Post).filter(Post.id == post_id).first()
        if post:
            post.publish_status = "Failed"
        
        fail_log = Log(
            user_id=post.user_id if post else None,
            action="PUBLISH_FAILED",
            description=f"Failed publishing post {post_id} to @{account.instagram_username if account else account_id}. Error: {error_msg}"
        )
        db.add(fail_log)
        db.commit()
        return f"FAILED: {error_msg}"
        
    except Exception as e:
        db.rollback()
        error_msg = f"System Error: {str(e)}"
        post = db.query(Post).filter(Post.id == post_id).first()
        if post:
            post.publish_status = "Failed"
        
        fail_log = Log(
            user_id=post.user_id if post else None,
            action="PUBLISH_FAILED",
            description=f"Failed publishing post {post_id} to account {account_id}. Error: {error_msg}"
        )
        db.add(fail_log)
        db.commit()
        return f"FAILED: {error_msg}"
        
    finally:
        db.close()

@tool("AuditLoggerTool")
def audit_log(action: str, message: str) -> str:
    """
    Writes a custom operational or audit log entry directly to the database.
    
    Parameters:
    - action: The category of action (e.g. 'AGENT_AUDIT', 'VALIDATION_CHECK', 'SYSTEM_MONITOR').
    - message: The message content explaining the action details.
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
