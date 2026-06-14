import datetime
import os
from crewai.tools import tool
from ..database import SessionLocal
from ..models import InstagramAccount, Post, Log
from ..security import decrypt_token
from ..config import settings
from ..instagram import InstagramClient, InstagramAPIError

@tool("InstagramPublishTool")
def publish_to_instagram(
    username: str = None,
    password: str = None,
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
    - username: The username or email of the Instagram account.
    - password: The decrypted password.
    - media_path: The local path or public URL of the media file.
    - caption: The optimized caption.
    - hashtags: The optimized hashtags.
    - post_id: (Optional) The ID of the post in the database.
    - account_id: (Optional) The ID of the Instagram account in the database.
    - is_video: (Optional) True if the file is a video, False otherwise.
    """
    db = SessionLocal()
    try:
        # 1. Fetch the post and the account details from database if identifiers are provided
        post = None
        if post_id:
            post = db.query(Post).filter(Post.id == post_id).first()
            
        account = None
        if account_id:
            account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
        elif username:
            account = db.query(InstagramAccount).filter(InstagramAccount.instagram_username_or_email == username).first()
            
        if not account and post:
            account = db.query(InstagramAccount).filter(InstagramAccount.id == post.instagram_account_id).first()

        if account and (account.status == "LOCKED" or account.status == "INACTIVE"):
            if post:
                post.publish_status = "Failed"
                post.failure_reason = f"Error: Account {account.instagram_username_or_email} is {account.status}. Publishing blocked."
                db.commit()
            return f"Error: Account {account.instagram_username_or_email} is {account.status}. Publishing blocked. Direct credential update is required."

        # Resolve credentials
        access_token = password
        if not access_token and account:
            access_token = decrypt_token(account.encrypted_password)

        if not access_token:
            raise ValueError("No access token provided or found for the Instagram account.")

        # Resolve media_path, caption, hashtags, and is_video
        if not media_path and post:
            media_path = post.media_path
        if not media_path:
            raise ValueError("No media path provided or found for the post.")

        if not caption and post:
            caption = post.caption or ""
        
        # Combine caption and hashtags if hashtags is provided and not already in caption
        if hashtags and hashtags.strip() and hashtags not in caption:
            caption = f"{caption}\n\n{hashtags}"
        elif post and post.hashtags and post.hashtags.strip() and post.hashtags not in caption:
            caption = f"{caption}\n\n{post.hashtags}"

        if not is_video and media_path:
            video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
            _, ext = os.path.splitext(media_path.lower())
            is_video = ext in video_extensions

        # Log start
        if post or account:
            start_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_START",
                description=f"Starting publication of post {post_id or ''} to Instagram feed: {username or (account.instagram_username_or_email if account else '')}"
            )
            db.add(start_log)
            db.commit()

        # Check for simulated failures based on the access token/password
        sim_errors = {
            "wrong_password": "Instagram login failed. Invalid username or password.",
            "fail": "Instagram login failed. Invalid username or password.",
            "two_factor": "Two-Factor Authentication is enabled on this Instagram account.",
            "security_challenge": "Instagram security challenge detected. Email verification required.",
            "checkpoint": "Instagram security checkpoint required.",
            "locked": "Account temporarily locked.",
            "session_expired": "Session expired.",
            "timeout": "Upload timeout.",
            "unsupported_media": "Unsupported media format.",
            "network_error": "Network connection failure.",
            "rate_limit": "Instagram rate limit reached.",
            "service_unavailable": "Instagram service unavailable.",
            "automation_error": "Browser automation error.",
            "element_not_found": "Element not found during login."
        }
        
        pw_lower = access_token.lower().strip()
        matched_error = None
        for err_key, err_val in sim_errors.items():
            if err_key in pw_lower:
                matched_error = err_val
                break

        if matched_error:
            if account and any(k in pw_lower for k in ["wrong_password", "fail", "locked"]):
                account.last_login_status = "FAILED"
                account.last_publish_status = "FAILED"
                account.status = "LOCKED"
                db.commit()
            raise InstagramAPIError(f"[SIMULATION] API Error: {matched_error}", status_code=400)

        # Determine if simulation mode or real Graph API publishing
        is_mock = InstagramClient.is_mock_token(access_token)

        if is_mock:
            # --- SIMULATION MODE ---
            import time
            from ..utils import update_post_progress
            mock_container_id = "18273645901234567"
            mock_media_id = "17945612349876543"

            # 5. Create media container simulation
            if post_id:
                update_post_progress(db, post_id, "Creating Instagram Media Container", 50)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_CREATE",
                    description=f"[SIMULATION] Creating Instagram media container for post {post_id}."
                ))
                db.commit()
            time.sleep(1.0)

            # 6. Poll status simulation
            if post_id:
                update_post_progress(db, post_id, "Waiting for Instagram Processing", 65)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_POLL",
                    description=f"[SIMULATION] Waiting for media container processing on Instagram for post {post_id}."
                ))
                db.commit()
            time.sleep(1.0)

            # 7. Publish simulation
            if post_id:
                update_post_progress(db, post_id, "Publishing Post", 80)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_PUBLISH",
                    description=f"[SIMULATION] Publishing container {mock_container_id} to Instagram for post {post_id}."
                ))
                db.commit()
            time.sleep(1.0)

            # 8. Verify simulation
            if post_id:
                update_post_progress(db, post_id, "Verifying Publication", 90)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="PUBLISH_VERIFY",
                    description=f"[SIMULATION] Verifying published post {mock_media_id} on Instagram for post {post_id}."
                ))
                db.commit()
            time.sleep(1.0)

            # Create the dynamic simulation audit log entry
            audit_description = (
                f"Instagram User ID: {account.instagram_username_or_email if account else (username or 'mock_user')}\n"
                f"Media Container ID: {mock_container_id}\n"
                f"Publish Response Payload: {{'id': '{mock_media_id}'}}\n"
                f"Timestamp: {datetime.datetime.utcnow().isoformat()}"
            )
            audit_log_rec = Log(
                user_id=post.user_id if post else None,
                action="IG_PUBLISH_AUDIT",
                description=audit_description
            )
            db.add(audit_log_rec)

            if account:
                account.last_login_status = "SUCCESS"
                account.last_publish_status = "SUCCESS"
                account.updated_at = datetime.datetime.utcnow()
            
            if post_id:
                update_post_progress(db, post_id, "Success", 100)
            
            success_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_SUCCESS",
                description=f"[SIMULATION] Successfully published post {post_id or ''} to {username or (account.instagram_username_or_email if account else '')}."
            )
            db.add(success_log)
            db.commit()

            return f"SUCCESS: [SIMULATION] Post {post_id or ''} successfully published to {username or (account.instagram_username_or_email if account else '')}."

        else:
            # --- REAL INSTAGRAM GRAPH API PUBLISHING ---
            from ..utils import update_post_progress
            
            # 1. Verify permissions
            InstagramClient.verify_token_permissions(access_token)

            # 2. Retrieve Instagram Business ID (linked to Facebook page)
            ig_business_id = InstagramClient.verify_account(access_token)

            # 3. Verify Instagram Account Type (Business or Creator)
            InstagramClient.verify_instagram_account_type(ig_business_id, access_token)

            # 4. Resolve public media URL
            if media_path.startswith("http://") or media_path.startswith("https://"):
                media_url = media_path
            else:
                filename = os.path.basename(media_path)
                media_url = f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{filename}"

            # 5. Create media container
            if post_id:
                update_post_progress(db, post_id, "Creating Instagram Media Container", 50)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_CREATE",
                    description=f"Creating Instagram media container for post {post_id}."
                ))
                db.commit()
            
            container_id = InstagramClient.create_media_container(
                instagram_business_id=ig_business_id,
                media_url=media_url,
                caption=caption,
                access_token=access_token,
                is_video=is_video
            )

            # 6. Poll status until container is FINISHED/PUBLISHED
            if post_id:
                update_post_progress(db, post_id, "Waiting for Instagram Processing", 65)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_POLL",
                    description=f"Waiting for media container processing on Instagram for post {post_id}."
                ))
                db.commit()
            
            InstagramClient.wait_for_container_processing(container_id, access_token)

            # 7. Publish media container
            if post_id:
                update_post_progress(db, post_id, "Publishing Post", 80)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="CONTAINER_PUBLISH",
                    description=f"Publishing container {container_id} to Instagram for post {post_id}."
                ))
                db.commit()
            
            media_id = InstagramClient.publish_media_container(ig_business_id, container_id, access_token)

            # 8. Verify post exists on Instagram using its returned media ID
            if post_id:
                update_post_progress(db, post_id, "Verifying Publication", 90)
                db.add(Log(
                    user_id=post.user_id if post else None,
                    action="PUBLISH_VERIFY",
                    description=f"Verifying published post {media_id} on Instagram for post {post_id}."
                ))
                db.commit()
            
            InstagramClient.verify_published_post(media_id, access_token)

            # 9. Create standard audit log entry with Instagram User ID, Container ID, and Publish payload
            audit_description = (
                f"Instagram User ID: {ig_business_id}\n"
                f"Media Container ID: {container_id}\n"
                f"Publish Response Payload: {{'id': '{media_id}'}}\n"
                f"Timestamp: {datetime.datetime.utcnow().isoformat()}"
            )
            audit_log_rec = Log(
                user_id=post.user_id if post else None,
                action="IG_PUBLISH_AUDIT",
                description=audit_description
            )
            db.add(audit_log_rec)

            if account:
                account.last_login_status = "SUCCESS"
                account.last_publish_status = "SUCCESS"
                account.updated_at = datetime.datetime.utcnow()

            if post_id:
                update_post_progress(db, post_id, "Success", 100)

            success_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_SUCCESS",
                description=f"Successfully published post {post_id or ''} to {username or account.instagram_username_or_email}."
            )
            db.add(success_log)
            db.commit()

            return f"SUCCESS: Post {post_id or ''} successfully published to {username or account.instagram_username_or_email} (Media ID: {media_id})."

    except Exception as e:
        db.rollback()
        import traceback
        stack_trace = traceback.format_exc()
        error_msg = str(e)
        
        # Check if the error is InstagramAPIError and contains raw response
        raw_info = ""
        if isinstance(e, InstagramAPIError) and getattr(e, "raw_response", None):
            raw_info = f"\nRaw Response: {e.raw_response}"
            
        full_error = f"{error_msg}{raw_info}"
        
        from ..utils import update_post_progress
        if post_id:
            # Re-fetch post record to prevent session state issues
            post = db.query(Post).filter(Post.id == post_id).first()
            progress = post.progress_percent if post else 35
            update_post_progress(
                db, 
                post_id, 
                "Failed", 
                progress, 
                failure_reason=f"Error: {full_error}\n\nStack Trace:\n{stack_trace}"
            )
        
        if account:
            account.last_publish_status = "FAILED"
            db.commit()
        
        if post_id or account:
            fail_log = Log(
                user_id=post.user_id if post else None,
                action="PUBLISH_FAILED",
                description=f"Failed publishing post {post_id or ''} to account {username or (account.instagram_username_or_email if account else '')}. Error: {full_error}\n\nStack Trace:\n{stack_trace}"
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
