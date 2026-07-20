import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "The NexRevo AI"
    
    # Database Settings
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/agent_karuppu"
    
    # Security Settings
    JWT_SECRET_KEY: str = "supersecretjwtkeyfordevelopmentpurposeonlychangeinproduction"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # Fernet Symmetric Encryption Key (32 url-safe base64-encoded bytes)
    # Generated using cryptography.fernet.Fernet.generate_key().decode()
    ENCRYPTION_KEY: str = "vA3Z6f_y-G1L6XQ9sH02Z_XJ0_pU48c-7Fv0v22119c=" 
    
    # Redis & Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_TASK_ALWAYS_EAGER: bool = False
    
    # Google Gemini LLM Config
    GEMINI_API_KEY: str = "placeholder-gemini-key"
    
    # Instagram Static Server Configuration
    PUBLIC_URL_PREFIX: str = "https://api.thenexrevo.com/static/uploads"
    
    # Default Admin Credentials
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"  # Will be hashed on startup
    
    # Meta / Facebook Login OAuth Settings
    FACEBOOK_CLIENT_ID: str = ""
    FACEBOOK_CLIENT_SECRET: str = ""
    FACEBOOK_REDIRECT_URI: str = "https://thenexrevo.com/auth/facebook/callback"

    # AWS S3 Storage Settings
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_STORAGE_BUCKET_NAME: str = ""
    AWS_S3_ENDPOINT_URL: Optional[str] = ""
    AWS_S3_REGION_NAME: Optional[str] = "us-east-1"

    # Supabase Storage Settings
    SUPABASE_URL: str = "https://your-supabase-project.supabase.co"
    SUPABASE_KEY: str = ""
    SUPABASE_STORAGE_BUCKET: str = "Karuppu"

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
