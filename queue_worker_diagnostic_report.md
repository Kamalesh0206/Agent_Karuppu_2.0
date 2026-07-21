# Production Publishing Queue & Worker Diagnostic Report

**Domain**: `https://thenexrevo.com` / `https://api.thenexrevo.com`  
**Date**: July 21, 2026  

---

## 1. Root Cause Analysis

### Localhost vs Production Discrepancy
- **Localhost Execution**: `run_local.bat` launched both the FastAPI web server (`uvicorn`) and a local Celery worker process simultaneously. When a post was submitted, the local Celery worker immediately consumed the job from Redis and executed `process_queue_task`.
- **Production Execution**: Only the FastAPI Web Service container was running on Render. When `POST /publish` was invoked, FastAPI created database queue rows with status `"QUEUED" / "Pending Queue Slot"` and sent a Celery message to Redis. Because no Celery worker container was running on Render to consume messages from Redis, the jobs remained unconsumed with status `"Pending Queue Slot"` indefinitely.

Furthermore, line 1226 in `backend/app/main.py` previously contained a strict worker check (`if not status_info["worker_running"]: raise ValueError(...)`) that prevented publishing if a standalone Celery worker was not detected.

---

## 2. Technical Solution Implemented

### A. Dual Execution Strategy (In-Process Fallback + Background Worker)
Updated `POST /publish` and `POST /publish/{id}/retry` in `backend/app/main.py`:
- Checks if an active Celery worker is connected.
- If a Celery worker is active, dispatches via `process_queue_task.apply_async()`.
- If no Celery worker is active or if Celery dispatch fails, triggers an in-process FastAPI `BackgroundTasks` thread (`background_tasks.add_task(process_queue_task)`).
- This guarantees immediate, non-blocking execution regardless of standalone worker status.

### B. Extended Queue Status Filter (`backend/app/tasks.py`)
Updated `process_queue_task` in `backend/app/tasks.py`:
- Added `"Pending Queue Slot"` and `"PENDING"` to the status filter query:
  `PublishingQueue.status.in_(["QUEUED", "Waiting", "Retrying", "Pending Queue Slot", "PENDING"])`
- Wrapped recursive task triggers in safety blocks to prevent unhandled worker exceptions.

### C. Dedicated Render Worker Definition (`render.yaml`)
Added a dedicated Render Background Worker service (`thenexrevo-celery-worker`) to `render.yaml`:
```yaml
services:
  - type: web
    name: thenexrevo-backend
    env: python
    buildCommand: pip install -r backend/requirements.txt
    startCommand: cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT

  - type: worker
    name: thenexrevo-celery-worker
    env: python
    buildCommand: pip install -r backend/requirements.txt
    startCommand: cd backend && celery -A app.celery_app.celery_app worker --loglevel=info

  - type: static
    name: thenexrevo-frontend
    buildCommand: cd frontend && npm install && npm run build
    staticPublishPath: frontend/dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

---

## 3. Workflow Progression Verification

With these updates, every queued publish request progresses through all pipeline stages:

1. **Queue Injection**: `Pending Queue Slot` (0%)
2. **Downloading**: `Downloading` (15%)
3. **Validating**: `Validating` (30%)
4. **Container Creation**: `Creating Container` (50%)
5. **Publishing**: `Publishing` (85%)
6. **Completion**: `Completed` / `Success` (100%)
