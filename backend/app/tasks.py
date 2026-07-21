# pyright: reportGeneralTypeIssues=false, reportAttributeAccessIssue=false
import time
import os
import logging
from datetime import datetime, timedelta
import json
import redis
import traceback
import sys
from typing import cast
from .celery_app import celery_app
from .database import SessionLocal
from .models import PublishingQueue, Post, InstagramAccount, PublishingHistory, PublishingLog, AuditLog
from .instagram import InstagramClient, InstagramAPIError
from .security import decrypt_token
from .config import settings

logger = logging.getLogger("celery_tasks")

# Initialize Redis client for broadcasting progress updates
redis_client = redis.Redis.from_url(settings.REDIS_URL)

def broadcast_status(queue_id: int, payload: dict):
    """Broadcast status updates to the WebSocket channel."""
    logger.info(f"[Socket] Broadcasting updates for Queue ID {queue_id}: {payload}")
    try:
        redis_client.publish("publishing_status_updates", json.dumps({
            "queue_id": queue_id,
            **payload
        }))
    except Exception as e:
        logger.error(f"Failed to publish WebSocket progress update to Redis: {e}")

@celery_app.task(name="app.tasks.process_queue_task", bind=True)
def process_queue_task(self):
    """
    Scans the database for the next QUEUED/Waiting/Retrying post queue item
    and executes the multi-step Instagram publishing pipeline sequentially.
    """
    logger.info("Executing Celery sequential queue worker check.")
    db = SessionLocal()
    
    # 1. Fetch next queue item ordered by creation date (FIFO)
    queue_item = db.query(PublishingQueue).filter(
        PublishingQueue.status.in_(["QUEUED", "Waiting", "Retrying", "Pending Queue Slot", "PENDING"])
    ).order_by(PublishingQueue.id.asc()).first()
    
    if not queue_item:
        db.close()
        return {"status": "idle", "message": "No queued posts to publish."}

    logger.info(f"[Worker] Job picked: Queue ID {queue_item.id}")

    # 2. Transition state to DOWNLOADING
    queue_item.status = "DOWNLOADING"
    queue_item.current_step = "Downloading"
    queue_item.progress_percent = 15
    db.commit()
    db.refresh(queue_item)
    
    start_time = time.time()
    queue_id: int = int(queue_item.id)
    account = queue_item.account
    
    broadcast_status(queue_id, {
        "status": "DOWNLOADING",
        "current_step": "Downloading",
        "progress_percent": 15,
        "elapsed_time": 0
    })

    try:
        post = queue_item.post
        
        # Verify account is not locked
        if account.status == "Locked":
            raise InstagramAPIError("Account is locked. Verification failed.", status_code=403)
            
        # Decrypt credentials
        decrypted_token = decrypt_token(account.page_access_token)
        
        # 3. Simulate media download / direct access check (DOWNLOADING -> VALIDATING)
        logger.info(f"[Media] Download started for URL: {post.media_url}")
        
        import requests as req_module
        try:
            res = req_module.get(post.media_url, stream=True, timeout=15)
            if res.status_code != 200:
                raise ValueError(f"URL is not publicly accessible. HTTP Status: {res.status_code}")
                
            headers = res.headers
            content_type = headers.get("Content-Type", "").split(";")[0].strip().lower()
            content_length = headers.get("Content-Length", "0")
            
            logger.info(f"[Media] MIME type: {content_type} | File size: {content_length} bytes")
            
            is_reels = post.media_type == "REELS"
            if is_reels:
                if content_type not in ["video/mp4", "video/quicktime"]:
                    raise ValueError(f"Content-Type '{content_type}' is not supported for Reels. Must be video/mp4 or video/quicktime.")
        except Exception as e:
            raise ValueError(f"Media validation failed: {str(e)}")
            
        logger.info(f"[Media] Download successful for URL: {post.media_url}")
        
        # Transition state to VALIDATING
        queue_item.status = "VALIDATING"
        queue_item.current_step = "Validating"
        queue_item.progress_percent = 30
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        broadcast_status(queue_id, {
            "status": "VALIDATING",
            "current_step": "Validating",
            "progress_percent": 30,
            "elapsed_time": queue_item.elapsed_time
        })
        
        is_reels = post.media_type == "REELS"
        
        # 4. Transition state to CREATING_CONTAINER
        queue_item.status = "CREATING_CONTAINER"
        queue_item.current_step = "Creating Container"
        queue_item.progress_percent = 50
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        broadcast_status(queue_id, {
            "status": "CREATING_CONTAINER",
            "current_step": "Creating Container",
            "progress_percent": 50,
            "elapsed_time": queue_item.elapsed_time
        })
        
        logger.info("[Instagram] Creating media container")
        creation_id = InstagramClient.create_media_container(
            instagram_business_id=account.instagram_business_id,
            media_url=post.media_url,
            caption=post.caption,
            access_token=decrypted_token,
            is_video=is_reels,
            username=account.instagram_username,
            queue_id=queue_id,
            retry_count=queue_item.retry_count
        )
        logger.info(f"[Instagram] Container ID received: {creation_id}")
        
        # 5. Transition state to WAITING_CONTAINER
        queue_item.status = "WAITING_CONTAINER"
        queue_item.current_step = "Waiting Container"
        queue_item.progress_percent = 70
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        broadcast_status(queue_id, {
            "status": "WAITING_CONTAINER",
            "current_step": "Waiting Container",
            "progress_percent": 70,
            "elapsed_time": queue_item.elapsed_time
        })
        
        logger.info("[Instagram] Waiting for processing")
        InstagramClient.wait_for_container_processing(
            container_id=creation_id,
            access_token=decrypted_token,
            username=account.instagram_username,
            queue_id=queue_id,
            retry_count=queue_item.retry_count
        )
        
        # 6. Transition state to PUBLISHING
        queue_item.status = "PUBLISHING"
        queue_item.current_step = "Publishing"
        queue_item.progress_percent = 90
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        broadcast_status(queue_id, {
            "status": "PUBLISHING",
            "current_step": "Publishing",
            "progress_percent": 90,
            "elapsed_time": queue_item.elapsed_time
        })
        
        logger.info("[Instagram] Publishing media")
        published_media_id = InstagramClient.publish_media_container(
            instagram_business_id=account.instagram_business_id,
            creation_id=creation_id,
            access_token=decrypted_token,
            username=account.instagram_username,
            queue_id=queue_id,
            retry_count=queue_item.retry_count
        )
        logger.info(f"[Instagram] Media published successfully: Media ID {published_media_id}")
        
        # 7. Verification step
        InstagramClient.verify_published_post(
            media_id=published_media_id,
            access_token=decrypted_token,
            username=account.instagram_username,
            queue_id=queue_id,
            retry_count=queue_item.retry_count
        )
        
        logger.info("[Database] Saving history")
        history = PublishingHistory(
            post_id=post.id,
            account_id=account.id,
            media_id=published_media_id,
            published_time=datetime.utcnow(),
            caption=post.caption,
            media_url=post.media_url,
            username=account.instagram_username
        )
        db.add(history)
        
        # Transition state to SUCCESS / Completed
        queue_item.status = "SUCCESS"
        queue_item.current_step = "Completed"
        queue_item.progress_percent = 100
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        logger.info(f"[Status] Updating progress: Queue ID {queue_id} -> SUCCESS")
        
        broadcast_status(queue_id, {
            "status": "SUCCESS",
            "current_step": "Completed",
            "progress_percent": 100,
            "elapsed_time": queue_item.elapsed_time,
            "media_id": published_media_id
        })
        
        # Log audit operation
        db.add(AuditLog(
            user_id=post.user_id,
            action="Publishing",
            description=f"Successfully published post ID {post.id} to @{account.instagram_username} (Media ID: {published_media_id})"
        ))
        db.commit()
        logger.info("[Completed]")
        
    except InstagramAPIError as e:
        db.rollback()
        tb = traceback.format_exc()
        logger.error(f"[Worker] Instagram Graph API exception occurred: {str(e)}\n{tb}")
        
        # Save exact failure details to PublishingLog
        payload_body = {
            "caption": queue_item.post.caption,
            "media_url": queue_item.post.media_url,
            "media_type": queue_item.post.media_type
        }
        
        db.add(PublishingLog(
            queue_id=queue_id,
            http_status=e.status_code,
            meta_error_code=str(e.fb_error_code) if e.fb_error_code else None,
            subcode=str(e.error_subcode) if e.error_subcode else None,
            message=str(e),
            fbtrace_id=e.fbtrace_id,
            request_url=f"https://graph.facebook.com/v25.0/{account.instagram_business_id}/media",
            request_body=json.dumps(payload_body),
            response=json.dumps(e.raw_response) if e.raw_response else tb,
            retry_count=queue_item.retry_count
        ))
        db.commit()

        # Handle failures and retry mechanics
        queue_item.elapsed_time = int(time.time() - start_time)
        retry_status = False
        
        if e.status_code in [429, 500, 502, 503, 504] or e.status_code is None:
            if queue_item.retry_count < 3:
                queue_item.retry_count += 1
                queue_item.status = "Retrying"
                queue_item.current_step = f"Retrying attempt {queue_item.retry_count}/3 due to transient error"
                db.commit()
                retry_status = True
                
                # Backoff delay reschedule
                current_retries = int(queue_item.retry_count or 0)
                delay = 2 ** current_retries
                process_queue_task.apply_async(countdown=delay)
                
                broadcast_status(queue_id, {
                    "status": "Retrying",
                    "current_step": f"Retrying attempt {queue_item.retry_count}/3",
                    "progress_percent": queue_item.progress_percent,
                    "elapsed_time": queue_item.elapsed_time,
                    "retry_count": queue_item.retry_count
                })

        if not retry_status:
            queue_item.status = "FAILED"
            queue_item.current_step = f"Failed: {str(e)}"
            db.commit()
            
            broadcast_status(queue_id, {
                "status": "FAILED",
                "current_step": f"Failed: {str(e)}",
                "progress_percent": queue_item.progress_percent,
                "elapsed_time": queue_item.elapsed_time,
                "error_message": str(e)
            })
            
            db.add(AuditLog(
                user_id=queue_item.post.user_id,
                action="Failures",
                description=f"Publishing failed for @{queue_item.account.instagram_username}: {str(e)}"
            ))
            db.commit()
            
    except Exception as general_err:
        db.rollback()
        tb = traceback.format_exc()
        logger.error(f"[Worker] General exception occurred: {str(general_err)}\n{tb}")
        
        db.add(PublishingLog(
            queue_id=queue_id,
            http_status=500,
            message=str(general_err),
            response=tb,
            retry_count=queue_item.retry_count
        ))
        db.commit()

        queue_item.status = "FAILED"
        queue_item.current_step = f"Failed: {str(general_err)}"
        queue_item.elapsed_time = int(time.time() - start_time)
        db.commit()
        
        broadcast_status(queue_id, {
            "status": "FAILED",
            "current_step": f"Failed: {str(general_err)}",
            "progress_percent": queue_item.progress_percent,
            "elapsed_time": queue_item.elapsed_time,
            "error_message": str(general_err)
        })
        
        db.add(AuditLog(
            user_id=queue_item.post.user_id,
            action="Failures",
            description=f"Publishing runtime failure: {str(general_err)}"
        ))
        db.commit()
        
    finally:
        db.close()
        
    # Queue next task check recursively to support sequential processing of enqueued items
    try:
        process_queue_task.apply_async(countdown=1)
    except Exception as err:
        logger.warning(f"[Celery Worker] Celery async trigger fallback: {err}")
    return {"status": "completed"}
