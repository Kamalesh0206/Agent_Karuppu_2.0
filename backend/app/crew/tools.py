import datetime
import os
from crewai.tools import tool
from ..database import SessionLocal
from ..models import Account, PostAccount, Log
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
    
    This tool retrieves the account, decrypts its access token, resolves the media URL,
    calls the Instagram API to upload and publish the container, and updates the database
    with the publishing outcome.
    """
    db = SessionLocal()
    try:
        # 1. Fetch the post-account mapping and the account details
        post_acc = db.query(PostAccount).filter(
            PostAccount.post_id == post_id, 
            PostAccount.account_id == account_id
        ).first()
        
        if not post_acc:
            return f"Error: Post-account relation for post {post_id} and account {account_id} not found."
        
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            post_acc.publish_status = "FAILED"
            post_acc.error_message = "Target Instagram account not found in database."
            db.commit()
            return f"Error: Account ID {account_id} not found."
            
        if account.status != "ACTIVE":
            post_acc.publish_status = "FAILED"
            post_acc.error_message = "Account is inactive."
            db.commit()
            return f"Error: Account {account.username} is INACTIVE. Publishing skipped."

        # Update status to IN_PROGRESS
        post_acc.publish_status = "IN_PROGRESS"
        db.commit()

        # Log start
        start_log = Log(
            action="PUBLISH_START",
            message=f"Starting publication of post {post_id} to Instagram account: {account.username}"
        )
        db.add(start_log)
        db.commit()

        # 2. Decrypt token and prepare public media URL
        try:
            decrypted_access_token = decrypt_token(account.access_token)
        except Exception as e:
            post_acc.publish_status = "FAILED"
            post_acc.error_message = f"Token decryption failed: {str(e)}"
            db.commit()
            return f"Error decrypting token for account {account.username}: {str(e)}"

        # Prepare public media URL.
        # Instagram Graph API requires media to be hosted on a public URL.
        # If media_path is already a URL, use it. Otherwise, build it using PUBLIC_URL_PREFIX.
        if media_path.startswith("http://") or media_path.startswith("https://"):
            public_media_url = media_path
        else:
            filename = os.path.basename(media_path)
            public_media_url = f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{filename}"

        # 3. Connect to Instagram Graph API
        # Retrieve Instagram Business Account ID linked to Page Token
        ig_business_id = InstagramClient.verify_account(decrypted_access_token)
        
        # Create media container
        creation_id = InstagramClient.create_media_container(
            instagram_business_id=ig_business_id,
            media_url=public_media_url,
            caption=caption,
            access_token=decrypted_access_token,
            is_video=is_video
        )

        # If it is a video, wait for Instagram server side rendering/transcoding
        if is_video:
            InstagramClient.wait_for_video_processing(
                container_id=creation_id,
                access_token=decrypted_access_token
            )

        # Publish the container
        media_id = InstagramClient.publish_media_container(
            instagram_business_id=ig_business_id,
            creation_id=creation_id,
            access_token=decrypted_access_token
        )

        # 4. Success: Update database
        post_acc.publish_status = "SUCCESS"
        post_acc.published_at = datetime.datetime.utcnow()
        post_acc.error_message = None
        
        success_log = Log(
            action="PUBLISH_SUCCESS",
            message=f"Successfully published post {post_id} to {account.username}. Media ID: {media_id}"
        )
        db.add(success_log)
        db.commit()

        return f"SUCCESS: Post {post_id} successfully published to {account.username}. Media ID: {media_id}"

    except InstagramAPIError as e:
        db.rollback()
        # Handle Instagram-specific errors
        error_msg = f"Instagram API Error: {str(e)} (Code: {e.fb_error_code}, Subcode: {e.error_subcode})"
        post_acc.publish_status = "FAILED"
        post_acc.error_message = error_msg
        
        fail_log = Log(
            action="PUBLISH_FAILED",
            message=f"Failed publishing post {post_id} to {account.username or account_id}. Error: {error_msg}"
        )
        db.add(fail_log)
        db.commit()
        return f"FAILED: {error_msg}"
        
    except Exception as e:
        db.rollback()
        # Handle system/network errors
        error_msg = f"System Error: {str(e)}"
        post_acc.publish_status = "FAILED"
        post_acc.error_message = error_msg
        
        fail_log = Log(
            action="PUBLISH_FAILED",
            message=f"Failed publishing post {post_id} to {account_id}. Error: {error_msg}"
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
            message=message
        )
        db.add(db_log)
        db.commit()
        return f"Log entry created successfully: [{action.upper()}] {message}"
    except Exception as e:
        db.rollback()
        return f"Failed to write log entry: {str(e)}"
    finally:
        db.close()
