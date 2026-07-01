import boto3
import os
from .config import settings

def upload_file_to_s3(file_path: str, object_name: str) -> str:
    """
    Uploads a file to an S3-compatible bucket and returns its public URL.
    Falls back to local file storage URL if AWS S3 settings are missing.
    """
    if (not settings.AWS_ACCESS_KEY_ID or 
        not settings.AWS_SECRET_ACCESS_KEY or 
        not settings.AWS_STORAGE_BUCKET_NAME):
        # Fallback to local url
        return f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{object_name}"
        
    s3_client = boto3.client(
        's3',
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        endpoint_url=settings.AWS_S3_ENDPOINT_URL or None,
        region_name=settings.AWS_S3_REGION_NAME or "us-east-1"
    )
    
    try:
        s3_client.upload_file(
            file_path,
            settings.AWS_STORAGE_BUCKET_NAME,
            object_name,
            ExtraArgs={'ACL': 'public-read'}
        )
        if settings.AWS_S3_ENDPOINT_URL:
            # Custom S3 compatible endpoint (like MinIO or localstack)
            return f"{settings.AWS_S3_ENDPOINT_URL.rstrip('/')}/{settings.AWS_STORAGE_BUCKET_NAME}/{object_name}"
        else:
            return f"https://{settings.AWS_STORAGE_BUCKET_NAME}.s3.amazonaws.com/{object_name}"
    except Exception as e:
        print(f"[S3 Warning] Failed to upload to S3: {e}. Falling back to local storage URL.")
        return f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{object_name}"
