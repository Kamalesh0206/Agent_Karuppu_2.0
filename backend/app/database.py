from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

db_url = (settings.DATABASE_URL or "").strip()

# Standardize SQLAlchemy PostgreSQL connection scheme (postgres:// -> postgresql://)
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

if db_url.startswith("sqlite"):
    engine = create_engine(
        db_url,
        connect_args={"check_same_thread": False, "timeout": 30}
    )
else:
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=300
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
