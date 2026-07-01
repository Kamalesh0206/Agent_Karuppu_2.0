import datetime
from typing import List, Optional
from pydantic import BaseModel

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
    email_verified: bool
    mobile_verified: bool
    publishing_permission: bool
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    mobile_number: Optional[str] = None

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
class InstagramAccountResponse(BaseModel):
    id: int
    user_id: int
    facebook_user_id: Optional[str] = None
    facebook_page_id: Optional[str] = None
    facebook_page_name: Optional[str] = None
    instagram_business_id: Optional[str] = None
    instagram_username: Optional[str] = None
    token_expiry: Optional[datetime.datetime] = None
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True

# Publishing Schemas
class PublishRequest(BaseModel):
    caption: Optional[str] = ""
    hashtags: Optional[str] = ""
    account_ids: List[int]
    media_path: str

class PublishingLogResponse(BaseModel):
    id: int
    user_id: int
    account_id: int
    instagram_username: Optional[str] = None
    media_type: str
    caption: Optional[str] = None
    hashtags: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    post_id: Optional[str] = None
    published_at: datetime.datetime
    created_at: datetime.datetime
    updated_at: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True

# Log Schemas
class LogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    description: str
    ip_address: Optional[str] = None
    created_at: datetime.datetime

    class Config:
        from_attributes = True
