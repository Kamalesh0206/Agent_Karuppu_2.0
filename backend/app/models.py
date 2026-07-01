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
    email_verified = Column(Boolean, default=True, nullable=False)
    mobile_verified = Column(Boolean, default=True, nullable=False)
    publishing_permission = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    accounts = relationship("InstagramAccount", back_populates="user", cascade="all, delete-orphan")
    posts = relationship("PublishingLog", back_populates="user", cascade="all, delete-orphan")
    logs = relationship("Log", back_populates="user")

class InstagramAccount(Base):
    __tablename__ = "instagram_accounts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Meta OAuth specific fields
    facebook_user_id = Column(String, nullable=True)
    facebook_page_id = Column(String, nullable=True)
    facebook_page_name = Column(String, nullable=True)
    page_access_token = Column(Text, nullable=False)  # Encrypted
    instagram_business_id = Column(String, unique=True, nullable=True)
    instagram_username = Column(String, nullable=True)
    token_expiry = Column(DateTime, nullable=True)
    status = Column(String, default="ACTIVE", nullable=False)  # "ACTIVE", "INACTIVE", "LOCKED"
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="accounts")
    logs = relationship("PublishingLog", back_populates="account", cascade="all, delete-orphan")

class PublishingLog(Base):
    __tablename__ = "publishing_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    media_type = Column(String, nullable=False)  # "IMAGE", "VIDEO"
    caption = Column(Text, nullable=True)
    hashtags = Column(Text, nullable=True)
    status = Column(String, default="Pending", nullable=False)  # "Pending", "Success", "Failed"
    error_message = Column(Text, nullable=True)
    post_id = Column(String, nullable=True)  # Instagram Media ID
    published_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="posts")
    account = relationship("InstagramAccount", back_populates="logs")

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
