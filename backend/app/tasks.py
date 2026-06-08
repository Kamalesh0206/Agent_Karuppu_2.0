import os
import logging
from .celery_app import celery_app
from .database import SessionLocal
from .models import Post, Account, PostAccount, Log
from .crew.crew import InstagramPublishingCrew

logger = logging.getLogger("celery_tasks")

@celery_app.task(name="app.tasks.publish_post_task", bind=True)
def publish_post_task(self, post_id: int, account_ids: list[int]):
    """
    Celery background task that handles the post verification, 
    content optimization, publishing, and monitoring via CrewAI.
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
        accounts = db.query(Account).filter(Account.id.in_(account_ids)).all()
        if not accounts:
            error_msg = f"Task aborted: No valid accounts found for IDs: {account_ids}."
            logger.error(error_msg)
            
            # Mark all post account jobs as failed
            db.query(PostAccount).filter(
                PostAccount.post_id == post_id
            ).update({"publish_status": "FAILED", "error_message": error_msg})
            db.commit()
            return {"status": "error", "message": error_msg}

        # Format accounts metadata for CrewAI input
        accounts_info = []
        for acc in accounts:
            # Only include ACTIVE accounts in verification details
            if acc.status == "ACTIVE":
                accounts_info.append({
                    "id": acc.id,
                    "username": acc.username
                })
            else:
                # Update status of inactive accounts to FAILED
                post_acc = db.query(PostAccount).filter(
                    PostAccount.post_id == post_id,
                    PostAccount.account_id == acc.id
                ).first()
                if post_acc:
                    post_acc.publish_status = "FAILED"
                    post_acc.error_message = f"Account {acc.username} is INACTIVE. Publishing skipped."
                    db.commit()

        if not accounts_info:
            return {"status": "error", "message": "No active accounts selected."}

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
                action="CREW_START",
                message=f"[SIMULATION] Mock Agent execution started for post {post_id}. Accounts: {[a['username'] for a in accounts_info]}"
            ))
            db.commit()

            # Content Agent Simulation
            db.add(Log(
                action="AGENT_OPTIMIZE",
                message=f"[Content Agent] [SIMULATION] Validated media file and caption length. Caption enhanced and hashtags optimized: {post.hashtags or ''} #instagram #viral #ai"
            ))
            db.commit()

            # Publishing Agent Simulation (Runs the real tool logic directly, ensuring mock publishing works)
            from .crew.tools import publish_to_instagram
            results = []
            for acc in accounts_info:
                tool_result = publish_to_instagram.fn(
                    post_id=post_id,
                    account_id=acc["id"],
                    caption=f"{post.caption or ''} {post.hashtags or ''} #instagram #viral #ai",
                    media_path=post.media_path,
                    is_video=is_video
                )
                results.append(tool_result)

            # Monitoring Agent Simulation
            report = f"Mock Agent Simulation Completed.\nTotal Targets: {len(accounts_info)}\nDetails:\n" + "\n".join(results)
            db.add(Log(
                action="CREW_SUCCESS",
                message=f"[SIMULATION] Mock Agent workflow completed. Summary: {report[:500]}"
            ))
            db.commit()

            return {
                "status": "success",
                "post_id": post_id,
                "report": report
            }

        logger.info(f"Initializing CrewAI workflow. Target Accounts count: {len(accounts_info)}")
        
        # Write initial system audit log
        start_log = Log(
            action="CREW_START",
            message=f"CrewAI execution started for post {post_id}. Accounts: {[a['username'] for a in accounts_info]}"
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
            action="CREW_SUCCESS",
            message=f"CrewAI execution completed. Analytics Summary: {crew_report[:1000]}"
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
            action="CREW_FAILURE",
            message=f"Celery task encountered an unhandled exception: {str(e)}"
        )
        db.add(err_log)
        
        # Update any pending or in-progress post-accounts to failed
        db.query(PostAccount).filter(
            PostAccount.post_id == post_id,
            PostAccount.publish_status.in_(["PENDING", "IN_PROGRESS"])
        ).update({
            "publish_status": "FAILED", 
            "error_message": f"Unhandled worker failure: {str(e)}"
        }, synchronize_session=False)
        db.commit()

        return {"status": "error", "message": f"Task execution failed: {str(e)}"}
        
    finally:
        db.close()
