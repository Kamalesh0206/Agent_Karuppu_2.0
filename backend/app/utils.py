def get_simplified_failure_reason(error: Exception) -> str:
    """
    Maps various exceptions or error string messages into clean, 
    user-friendly failure reasons, preventing leaking stack trace info 
    directly to standard users.
    """
    err_str = str(error).lower()
    
    # Common simulated failure keywords
    if "invalid username or password" in err_str or "incorrect password" in err_str:
        return "Instagram login failed. Invalid username or password."
    if "two-factor" in err_str or "2fa" in err_str:
        return "Two-Factor Authentication is enabled on this Instagram account."
    if "checkpoint" in err_str or "security challenge" in err_str:
        return "Instagram security challenge detected. Email verification required."
    if "locked" in err_str:
        return "Account temporarily locked."
    if "session expired" in err_str:
        return "Session expired."
    if "timeout" in err_str:
        return "Upload timeout."
    if "format" in err_str or "unsupported" in err_str:
        return "Unsupported media format."
    if "connection" in err_str or "network" in err_str:
        return "Network connection failure."
    if "rate limit" in err_str:
        return "Instagram rate limit reached."
    if "service unavailable" in err_str:
        return "Instagram service unavailable."
    if "automation error" in err_str:
        return "Browser automation error."
    if "element not found" in err_str:
        return "Element not found during login."
        
    return "Unknown publishing error"


def update_post_progress(db, post_id: int, status: str, percent: int, failure_reason: str = None):
    """
    Updates the database record and publishes a real-time event via Redis Pub/Sub.
    """
    import redis
    import json
    import datetime
    from .models import Post
    from .config import settings

    post = db.query(Post).filter(Post.id == post_id).first()
    if post:
        post.publish_status = status
        post.progress_percent = percent
        if failure_reason is not None:
            post.failure_reason = failure_reason
        post.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(post)

        # Broadcast progress update to Redis
        try:
            r = redis.Redis.from_url(settings.REDIS_URL)
            payload = {
                "post_id": post.id,
                "job_id": post.job_id,
                "instagram_account_id": post.instagram_account_id,
                "status": status,
                "progress_percent": percent,
                "failure_reason": post.failure_reason,
                "updated_at": post.updated_at.isoformat()
            }
            r.publish("instagram_publish_progress", json.dumps(payload))
            r.close()
        except Exception as e:
            print(f"[Redis Warning] Failed to publish progress update: {e}")

