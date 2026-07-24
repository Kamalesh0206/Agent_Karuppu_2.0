from typing import Any
from datetime import datetime, timedelta, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base

def utcnow():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    mobile_number = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="User", nullable=False)  # "Super Admin", "User"
    status = Column(String, default="Pending Approval", nullable=False)  # "Pending Approval", "Approved", "Rejected", "Disabled", "Suspended"
    approval_status = Column(String, default="Pending", nullable=False)  # "Pending", "Approved", "Rejected"
    approved_by = Column(Integer, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(String, nullable=True)
    disabled_at = Column(DateTime, nullable=True)
    suspended_at = Column(DateTime, nullable=True)
    last_login = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    email_verified = Column(Boolean, default=True, nullable=False)
    mobile_verified = Column(Boolean, default=True, nullable=False)
    publishing_permission = Column(Boolean, default=True, nullable=False)

    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    deletion_reason = Column(String, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    accounts = relationship("InstagramAccount", back_populates="user", cascade="all, delete-orphan", foreign_keys="[InstagramAccount.user_id]")
    groups = relationship("Group", back_populates="user", cascade="all, delete-orphan")
    posts = relationship("Post", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")
    access_tokens = relationship("AccessToken", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")

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
    profile_picture = Column(Text, nullable=True)
    business_name = Column(String, nullable=True)
    followers_count = Column(Integer, default=0, nullable=False)
    token_expiry = Column(DateTime, nullable=True)
    status = Column(String, default="Connected", nullable=False)  # "Connected", "Expired", "Publishing", "Disconnected", "Locked"
    group_name = Column(String, default="Default", nullable=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)

    # Ownership Metadata
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    owner_name = Column(String, nullable=True)
    linked_by = Column(String, nullable=True)
    linked_at = Column(DateTime, default=utcnow)
    created_by = Column(String, nullable=True)
    updated_by = Column(String, nullable=True)
    last_modified_by = Column(String, nullable=True)
    last_modified_at = Column(DateTime, nullable=True)
    
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    deletion_reason = Column(String, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    user = relationship("User", back_populates="accounts", foreign_keys=[user_id])
    owner = relationship("User", foreign_keys=[owner_id])
    group = relationship("Group", back_populates="accounts")
    queue_items = relationship("PublishingQueue", back_populates="account", cascade="all, delete-orphan")
    history_items = relationship("PublishingHistory", back_populates="account", cascade="all, delete-orphan")
    synced_posts = relationship("SyncedPost", back_populates="account", cascade="all, delete-orphan")
    following_relationships = relationship("FollowRelationship", foreign_keys="[FollowRelationship.follower_account_id]", back_populates="follower", cascade="all, delete-orphan")
    followed_relationships = relationship("FollowRelationship", foreign_keys="[FollowRelationship.followed_account_id]", back_populates="followed", cascade="all, delete-orphan")
    followers = relationship("Follower", back_populates="account", cascade="all, delete-orphan")
    following = relationship("Following", back_populates="account", cascade="all, delete-orphan")
    sync_histories = relationship("SyncHistory", back_populates="account", cascade="all, delete-orphan")

class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    caption = Column(Text, nullable=True)
    media_url = Column(Text, nullable=False)
    media_type = Column(String, nullable=False)  # "IMAGE", "REELS"
    onedrive_share_url = Column(Text, nullable=True)
    direct_download_url = Column(Text, nullable=True)
    filename = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    file_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    # Relationships
    user = relationship("User", back_populates="posts")
    queue_entries = relationship("PublishingQueue", back_populates="post", cascade="all, delete-orphan")
    history_entries = relationship("PublishingHistory", back_populates="post", cascade="all, delete-orphan")

class PublishingQueue(Base):
    __tablename__ = "publishing_queue"

    id: Any = Column(Integer, primary_key=True, index=True)
    post_id: Any = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    account_id: Any = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    status: Any = Column(String, default="Waiting", nullable=False)  # "Waiting", "Preparing", "Uploading", "Container Created", "Publishing", "Completed", "Retrying", "Failed", "Cancelled"
    progress_percent: Any = Column(Integer, default=0, nullable=False)
    current_step: Any = Column(String, nullable=True)
    elapsed_time: Any = Column(Integer, default=0, nullable=False)  # seconds
    retry_count: Any = Column(Integer, default=0, nullable=False)
    created_at: Any = Column(DateTime, default=utcnow)
    updated_at: Any = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    post = relationship("Post", back_populates="queue_entries")
    account = relationship("InstagramAccount", back_populates="queue_items")
    publishing_logs = relationship("PublishingLog", back_populates="queue_item", cascade="all, delete-orphan")

class PublishingHistory(Base):
    __tablename__ = "publishing_history"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    media_id = Column(String, nullable=False)  # Published Post ID from Meta
    published_time = Column(DateTime, default=utcnow)
    caption = Column(Text, nullable=True)
    media_url = Column(Text, nullable=True)
    username = Column(String, nullable=False)

    # Relationships
    post = relationship("Post", back_populates="history_entries")
    account = relationship("InstagramAccount", back_populates="history_items")

class PublishingLog(Base):
    __tablename__ = "publishing_logs"

    id = Column(Integer, primary_key=True, index=True)
    queue_id = Column(Integer, ForeignKey("publishing_queue.id", ondelete="CASCADE"), nullable=False)
    http_status = Column(Integer, nullable=True)
    meta_error_code = Column(String, nullable=True)
    subcode = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    fbtrace_id = Column(String, nullable=True)
    request_url = Column(Text, nullable=True)
    request_body = Column(Text, nullable=True)
    response = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=utcnow)
    retry_count = Column(Integer, default=0, nullable=False)

    # Relationships
    queue_item = relationship("PublishingQueue", back_populates="publishing_logs")

class AccessToken(Base):
    __tablename__ = "access_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(Text, unique=True, index=True, nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="access_tokens")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(Text, unique=True, index=True, nullable=False)
    is_revoked = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="refresh_tokens")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String, nullable=False)  # "Login", "Logout", "OAuth", "Publishing", "Token Refresh", "Failures", "Errors", "User Action"
    description = Column(Text, nullable=False)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User", back_populates="audit_logs")

class Group(Base):
    __tablename__ = "groups"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    
    # Relationships
    user = relationship("User", back_populates="groups")
    accounts = relationship("InstagramAccount", back_populates="group")

class SyncedPost(Base):
    __tablename__ = "synced_posts"

    id = Column(Integer, primary_key=True, index=True)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    media_id = Column(String, unique=True, index=True, nullable=False)
    permalink = Column(String, nullable=True)
    media_url = Column(Text, nullable=True)
    caption = Column(Text, nullable=True)
    media_type = Column(String, nullable=True)  # IMAGE, VIDEO, CAROUSEL_ALBUM
    like_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    published_at = Column(DateTime, nullable=True)
    synced_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationships
    account = relationship("InstagramAccount", back_populates="synced_posts")

class FollowRelationship(Base):
    __tablename__ = "follow_relationships"

    id = Column(Integer, primary_key=True, index=True)
    follower_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    followed_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, default="Unknown", nullable=False)  # Following, Not Following, Unknown
    last_checked = Column(DateTime, default=utcnow)

    # Relationships
    follower = relationship("InstagramAccount", foreign_keys=[follower_account_id], back_populates="following_relationships")
    followed = relationship("InstagramAccount", foreign_keys=[followed_account_id], back_populates="followed_relationships")

class Follower(Base):
    __tablename__ = "followers"

    id = Column(Integer, primary_key=True, index=True)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    username = Column(String, nullable=False, index=True)
    external_user_id = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    is_verified = Column(Boolean, default=False)
    account_type = Column(String, nullable=True)
    last_synced = Column(DateTime, default=utcnow)
    source = Column(String, default="Mock API")

    # Relationships
    account = relationship("InstagramAccount", back_populates="followers")

class Following(Base):
    __tablename__ = "following"

    id = Column(Integer, primary_key=True, index=True)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    username = Column(String, nullable=False, index=True)
    external_user_id = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    is_verified = Column(Boolean, default=False)
    account_type = Column(String, nullable=True)
    last_synced = Column(DateTime, default=utcnow)
    source = Column(String, default="Mock API")

    # Relationships
    account = relationship("InstagramAccount", back_populates="following")

class SyncHistory(Base):
    __tablename__ = "sync_history"

    id = Column(Integer, primary_key=True, index=True)
    instagram_account_id = Column(Integer, ForeignKey("instagram_accounts.id", ondelete="CASCADE"), nullable=False)
    sync_type = Column(String, nullable=False)  # followers, following, both
    status = Column(String, default="success")  # success, failed, unsupported
    progress = Column(Integer, default=100)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    # Relationships
    account = relationship("InstagramAccount", back_populates="sync_histories")

class MediaUpload(Base):
    __tablename__ = "media_uploads"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=True)
    stored_filename = Column(String, nullable=True)
    media_type = Column(String, nullable=False)  # "IMAGE", "REELS"
    mime_type = Column(String, nullable=True)
    file_size = Column(Integer, nullable=False)
    bucket_name = Column(String, default="Karuppu", nullable=True)
    storage_path = Column(String, nullable=True)
    public_url = Column(Text, nullable=True)
    storage_url = Column(Text, nullable=False)
    uploaded_by = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=utcnow)
