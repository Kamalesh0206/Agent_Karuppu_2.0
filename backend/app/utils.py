from datetime import datetime, timedelta
import redis
import json
from .models import PublishingLog
from .config import settings

def get_simplified_failure_reason(error: Exception) -> str:
    """
    Maps exceptions or error string messages into clean, user-friendly failure reasons.
    """
    err_str = str(error).lower()
    if "permissions" in err_str:
        return "Facebook Page permissions check failed."
    if "oauth" in err_str or "access token" in err_str:
        return "Facebook OAuth session expired or invalid."
    if "expired" in err_str:
        return "Facebook token has expired."
    if "unsupported" in err_str:
        return "Unsupported media format (must be JPG, PNG, MP4, or MOV)."
    if "network" in err_str or "timeout" in err_str:
        return "Network timeout contacting Meta APIs."
    if "rate limit" in err_str:
        return "Meta API rate limit reached."
    return "Unknown publishing error"

def update_post_progress(db, post_id: int, status: str, percent: int, failure_reason: str = None):
    """
    Updates the database record and publishes a real-time event via Redis Pub/Sub.
    """
    post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
    if post:
        post.status = status
        # Note: percent isn't stored in our new schema since the schema specifies:
        # id, account_id, media_type, caption, hashtags, status, error_message, post_id, published_at
        # But we update progress in memory or via Redis progress stream, and we update status & error_message in DB.
        if failure_reason is not None:
            post.error_message = failure_reason
        post.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(post)

        # Broadcast progress update to Redis
        try:
            r = redis.Redis.from_url(settings.REDIS_URL)
            payload = {
                "post_id": post.id,
                "account_id": post.account_id,
                "status": status,
                "progress_percent": percent,
                "failure_reason": post.error_message,
                "updated_at": post.updated_at.isoformat()
            }
            r.publish("instagram_publish_progress", json.dumps(payload))
            r.close()
        except Exception as e:
            print(f"[Redis Warning] Failed to publish progress update: {e}")
