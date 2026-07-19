import logging
from .celery_app import celery_app
from .config import settings

logger = logging.getLogger("worker_service")

class WorkerService:
    @staticmethod
    def get_status() -> dict:
        """
        Pings Celery workers to check if any are active/running.
        Returns a dict containing worker status, broker url, registered tasks, etc.
        """
        # Timeout = 5 as requested
        inspect = celery_app.control.inspect(timeout=5)
        
        workers = None
        worker_running = False
        try:
            workers = inspect.ping()
            if workers:
                # ping() returns a dictionary of workers (e.g. {'celery@Kamalesh': {'ok': 'pong'}})
                worker_running = True
        except Exception as e:
            logger.error(f"[WorkerService] Failed to ping Celery workers: {e}")

        registered_tasks = sorted(list(celery_app.tasks.keys()))

        return {
            "worker_running": worker_running,
            "workers": list(workers.keys()) if workers else [],
            "broker": settings.REDIS_URL,
            "registered_tasks": registered_tasks,
            "queue": "celery"
        }
