import ssl
from celery import Celery
from celery.signals import worker_ready
from .config import settings

# Print broker URL during worker startup
print(f"Worker Broker:\n{settings.REDIS_URL}")

celery_app = Celery(
    "agent_karuppu",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks"]
)

# Configure Celery options with connection retries and limits
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_always_eager=settings.CELERY_TASK_ALWAYS_EAGER,
    
    # Automatic connection retry settings
    broker_connection_retry_on_startup=True,
    broker_pool_limit=0,
    broker_transport_options={
        "retry_on_timeout": True,
        "socket_keepalive": True,
        "visibility_timeout": 3600
    }
)

# SSL configuration if secure scheme is detected
if settings.REDIS_URL.startswith("rediss://"):
    from urllib.parse import urlparse, parse_qs
    import ssl
    
    parsed = urlparse(settings.REDIS_URL)
    query_params = parse_qs(parsed.query)
    ssl_cert_reqs_param = query_params.get("ssl_cert_reqs", [""])[0].lower()
    
    ssl_cert_reqs = ssl.CERT_REQUIRED
    if ssl_cert_reqs_param == "none":
        ssl_cert_reqs = ssl.CERT_NONE
        
    ssl_opts = {
        "ssl_cert_reqs": ssl_cert_reqs
    }
    celery_app.conf.update(
        broker_use_ssl=ssl_opts,
        redis_backend_use_ssl=ssl_opts
    )

# Signal to log all registered tasks during worker startup
@worker_ready.connect
def log_registered_tasks(sender, **kwargs):
    tasks = sorted(list(sender.app.tasks.keys()))
    print("Registered tasks:")
    for t in tasks:
        print(f"  - {t}")

