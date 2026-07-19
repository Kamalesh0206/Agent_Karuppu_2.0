import os
import requests
import uuid
import logging
from datetime import datetime
from .config import settings

logger = logging.getLogger("supabase_storage")

def upload_to_supabase_storage(file_content: bytes, original_filename: str, mime_type: str, is_image: bool) -> dict:
    """
    Uploads binary media file directly to Supabase Storage bucket 'Karuppu' via REST API.
    Does NOT write any file to local disk or localhost server.
    Returns dictionary with storage metadata & public HTTPS URL.
    """
    ext = os.path.splitext(original_filename)[1].lower()
    if not ext:
        ext = ".png" if is_image else ".mp4"

    now = datetime.utcnow()
    year_str = now.strftime("%Y")
    month_str = now.strftime("%m")
    folder = "images" if is_image else "videos"

    unique_id = str(uuid.uuid4())
    stored_filename = f"{unique_id}{ext}"
    storage_path = f"{folder}/{year_str}/{month_str}/{stored_filename}"
    bucket = settings.SUPABASE_STORAGE_BUCKET or "Karuppu"

    base_url = settings.SUPABASE_URL.rstrip('/')
    upload_url = f"{base_url}/storage/v1/object/{bucket}/{storage_path}"

    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "Content-Type": mime_type or ("image/jpeg" if is_image else "video/mp4"),
        "x-upsert": "true"
    }

    start_time = datetime.utcnow()
    logger.info(f"[Supabase Storage] Uploading {len(file_content)} bytes to bucket '{bucket}' path '{storage_path}'...")

    # Execute HTTP POST request to Supabase Storage API
    try:
        response = requests.post(upload_url, data=file_content, headers=headers, timeout=60)
        elapsed_sec = (datetime.utcnow() - start_time).total_seconds()

        if response.status_code not in [200, 201]:
            logger.error(f"[Supabase Storage Error] HTTP {response.status_code}: {response.text}")
            raise Exception(f"Supabase Storage upload failed ({response.status_code}): {response.text}")

        public_url = f"{base_url}/storage/v1/object/public/{bucket}/{storage_path}"
        logger.info(f"[Supabase Storage Success] Completed in {elapsed_sec:.2f}s. Public URL: {public_url}")

        return {
            "bucket_name": bucket,
            "storage_path": storage_path,
            "stored_filename": stored_filename,
            "public_url": public_url
        }
    except Exception as e:
        logger.error(f"[Supabase Storage Exception] Failed to upload object to Supabase: {str(e)}", exc_info=True)
        raise e
