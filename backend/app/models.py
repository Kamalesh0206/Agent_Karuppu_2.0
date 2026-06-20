import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    mobile_number = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="User", nullable=False)  # "Super Admin", "User"
    status = Column(String, default="Pending Approval", nullable=False)  # "Pending Approval", "Approved", "Rejected", "Deactivated"
    email_verified = Column(Boolean, default=True, nullable=False)  # Defaults to True as OTP is removed
    mobile_verified = Column(Boolean, default=True, nullable=False) # Defaults to True as OTP is removed
    publishing_permission = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    accounts = relationship("InstagramAccount", back_populates="user", cascade="all, delete-orphan")
    requests = relationship("CredentialUpdateRequest", back_populates="user", cascade="all, delete-orphan")
    posts = relationship("Post", back_populates="user", cascade="all, delete-orphan")
    logs = relationship("Log", back_populates="user")

class InstagramAccount(Base):
    __tablename__ = "instagram_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    instagram_username_or_email = Column(String, nullable=False)
    encrypted_password = Column(Text, nullable=False)
    encrypted_access_token = Column(Text, nullable=True)
    status = Column(String, default="ACTIVE", nullable=False)  # "ACTIVE", "INACTIVE", "LOCKED"
    last_login_status = Column(String, default="NEVER_LOGGED", nullable=False)  # "SUCCESS", "FAILED"
    last_publish_status = Column(String, default="NEVER_PUBLISHED", nullable=False)  # "SUCCESS", "FAILED"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="accounts")
    posts = relationship("Post", back_populates="instagram_account", cascade="all, delete-orphan")
    requests = relationship("CredentialUpdateRequest", back_populates="instagram_account", cascade="all, delete-orphan")

class CredentialUpdateRequest(Base):
    __tablename__ = "credential_update_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="SET NULL"), nullable=True)
    requested_username_or_email = Column(String, nullable=False)
    requested_password = Column(String, nullable=True) # Plain text, encrypted upon approval before saving
    requested_access_token = Column(Text, nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String, default="Pending", nullable=False)  # "Pending", "Approved", "Rejected"
    admin_comments = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="requests")
    instagram_account = relationship("InstagramAccount", back_populates="requests")

class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    media_path = Column(String, nullable=False)
    caption = Column(Text, nullable=True)
    hashtags = Column(Text, nullable=True)
    publish_status = Column(String, default="Pending", nullable=False)  # "Pending", "Success", "Failed"
    failure_reason = Column(Text, nullable=True)
    job_id = Column(String, nullable=True)
    progress_percent = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="posts")
    instagram_account = relationship("InstagramAccount", back_populates="posts")

class Log(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="logs")
