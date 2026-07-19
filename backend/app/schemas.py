from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field

# User Schemas
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    full_name: str
    email: Optional[str] = None
    mobile_number: Optional[str] = None
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    full_name: str
    email: Optional[str] = None
    mobile_number: Optional[str] = None
    username: str
    role: str
    status: str
    approval_status: str
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejected_by: Optional[int] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    disabled_at: Optional[datetime] = None
    suspended_at: Optional[datetime] = None
    last_login: Optional[datetime] = None
    is_active: bool
    email_verified: bool
    mobile_verified: bool
    publishing_permission: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    mobile_number: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None

class UserReject(BaseModel):
    rejection_reason: Optional[str] = None

class UserResetPassword(BaseModel):
    new_password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

# Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str
    status: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

# Instagram Account Schemas
class InstagramAccountCreate(BaseModel):
    instagram_username_or_email: str
    access_token: str
    facebook_page_id: Optional[str] = None

class InstagramAccountUpdate(BaseModel):
    access_token: Optional[str] = None
    facebook_page_id: Optional[str] = None
    group_name: Optional[str] = None
    group_id: Optional[int] = None

class InstagramAccountResponse(BaseModel):
    id: int
    user_id: int
    facebook_user_id: Optional[str] = None
    facebook_page_id: Optional[str] = None
    facebook_page_name: Optional[str] = None
    instagram_business_id: Optional[str] = None
    instagram_username: Optional[str] = None
    profile_picture: Optional[str] = None
    business_name: Optional[str] = None
    followers_count: int = 0
    token_expiry: Optional[datetime] = None
    status: str
    group_name: Optional[str] = None
    group_id: Optional[int] = None
    
    # Ownership fields
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    linked_by: Optional[str] = None
    linked_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    last_modified_by: Optional[str] = None
    last_modified_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TransferOwnerPayload(BaseModel):
    new_owner_id: int

# Post Schemas
class PostCreate(BaseModel):
    caption: Optional[str] = ""
    media_url: str
    media_type: str  # "IMAGE", "REELS"

class PostResponse(BaseModel):
    id: int
    user_id: int
    caption: Optional[str] = None
    media_url: str
    media_type: str
    created_at: datetime

    class Config:
        from_attributes = True

# Publishing Queue Schemas
class PublishRequest(BaseModel):
    caption: Optional[str] = ""
    account_ids: List[int]
    media_url: str
    media_type: str
    onedrive_share_url: Optional[str] = None
    direct_download_url: Optional[str] = None
    filename: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None

class PublishingQueueResponse(BaseModel):
    id: int
    post_id: int
    account_id: int
    status: str
    progress_percent: int
    current_step: Optional[str] = None
    elapsed_time: int
    retry_count: int
    created_at: datetime
    updated_at: datetime
    post: PostResponse
    account: InstagramAccountResponse

    class Config:
        from_attributes = True

# Publishing History Schemas
class PublishingHistoryResponse(BaseModel):
    id: int
    post_id: int
    account_id: int
    media_id: str
    published_time: datetime
    caption: Optional[str] = None
    media_url: Optional[str] = None
    username: str

    class Config:
        from_attributes = True

# Publishing Log Schemas
class PublishingLogResponse(BaseModel):
    id: int
    queue_id: int
    http_status: Optional[int] = None
    meta_error_code: Optional[str] = None
    subcode: Optional[str] = None
    message: Optional[str] = None
    fbtrace_id: Optional[str] = None
    request_url: Optional[str] = None
    request_body: Optional[str] = None
    response: Optional[str] = None
    timestamp: datetime
    retry_count: int

    class Config:
        from_attributes = True

# Audit Log Schemas
class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    description: str
    ip_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# AI Schemas
class OptimizeRequest(BaseModel):
    caption: str

class OptimizeResponse(BaseModel):
    optimized_caption: str

class HashtagResponse(BaseModel):
    hashtags: List[str]

class EmojiResponse(BaseModel):
    emojis: List[str]

class TranslateRequest(BaseModel):
    caption: str
    target_lang: str

class TranslateResponse(BaseModel):
    translated_caption: str

class QualityScoreResponse(BaseModel):
    score: int

class ValidateLinkRequest(BaseModel):
    url: str

class ValidateLinkResponse(BaseModel):
    valid: bool
    filename: str
    mime_type: str
    size: int
    direct_download_url: str
    media_type: str

class GroupCreate(BaseModel):
    name: str

class GroupUpdate(BaseModel):
    name: str

class GroupResponse(BaseModel):
    id: int
    user_id: int
    name: str
    account_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TokenUpdatePayload(BaseModel):
    access_token: str
    validate_token: bool = True
    account_ids: Optional[List[int]] = None

class MediaResponse(BaseModel):
    media_id: int = Field(alias="id")
    filename: str
    original_filename: Optional[str] = None
    stored_filename: Optional[str] = None
    media_type: str
    mime_type: Optional[str] = None
    file_size: int
    bucket_name: Optional[str] = "Karuppu"
    storage_path: Optional[str] = None
    public_url: str
    storage_url: str
    uploaded_by: Optional[str] = None
    uploaded_at: datetime

    class Config:
        from_attributes = True
        populate_by_name = True
