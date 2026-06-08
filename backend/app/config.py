import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Instagram Multi-Account Publisher"
    
    # Database Settings
    DATABASE_URL: str = "sqlite:///./ig_publisher.db"
    
    # Security Settings
    JWT_SECRET_KEY: str = "supersecretjwtkeyfordevelopmentpurposeonlychangeinproduction"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # Fernet Symmetric Encryption Key (32 url-safe base64-encoded bytes)
    # Generated using cryptography.fernet.Fernet.generate_key().decode()
    ENCRYPTION_KEY: str = "vA3Z6f_y-G1L6XQ9sH02Z_XJ0_pU48c-7Fv0v22119c=" 
    
    # Redis & Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_TASK_ALWAYS_EAGER: bool = True
    
    # CrewAI / OpenAI LLM Config
    OPENAI_API_KEY: str = "sk-placeholder-key-for-crewai-agent"
    OPENAI_MODEL_NAME: str = "gpt-4o-mini"
    
    # Instagram Static Server Configuration
    # Instagram Graph API needs public URLs to fetch files.
    # In a local development setup, this prefix allows the application to serve uploaded files.
    # When deployed, it should point to a public server address (e.g., ngrok or production domain).
    PUBLIC_URL_PREFIX: str = "http://localhost:8000/static/uploads"
    
    # Default Admin Credentials
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"  # Will be hashed on startup

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
