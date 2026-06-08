import os
import logging
from .celery_app import celery_app
from .database import SessionLocal
from .models import Post, InstagramAccount, Log
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
            error_msg = f"Task aborted: Instagram Account @{account.instagram_username} is INACTIVE."
            logger.error(error_msg)
            post.publish_status = "Failed"
            db.commit()
            
            # Log deactivation skip
            db.add(Log(
                user_id=post.user_id,
                action="PUBLISH_SKIP",
                description=f"Publishing skipped for post {post_id}. Account @{account.instagram_username} is inactive."
            ))
            db.commit()
            return {"status": "error", "message": error_msg}

        # Mark status as Pending / In Progress
        post.publish_status = "Pending"
        db.commit()

        accounts_info = [{
            "id": account.id,
            "username": account.instagram_username
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
                description=f"[SIMULATION] Mock Agent execution started for post {post_id}. Target account: @{account.instagram_username}"
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
            tool_result = publish_to_instagram.fn(
                post_id=post_id,
                account_id=account.id,
                caption=f"{post.caption or ''} {post.hashtags or ''} #instagram #viral #ai",
                media_path=post.media_path,
                is_video=is_video
            )

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

        logger.info(f"Initializing CrewAI workflow. Target Account: @{account.instagram_username}")
        
        # Write initial system audit log
        start_log = Log(
            user_id=post.user_id,
            action="CREW_START",
            description=f"CrewAI execution started for post {post_id}. Target account: @{account.instagram_username}"
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
        
        # Write error log
        err_log = Log(
            user_id=post.user_id,
            action="CREW_FAILURE",
            description=f"Celery task encountered an unhandled exception: {str(e)}"
        )
        db.add(err_log)
        
        # Update post status to Failed
        post = db.query(Post).filter(Post.id == post_id).first()
        if post:
            post.publish_status = "Failed"
        db.commit()

        return {"status": "error", "message": f"Task execution failed: {str(e)}"}
        
    finally:
        db.close()
