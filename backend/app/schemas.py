import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field

# User Schemas
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    mobile_number: str
    username: str
    password: str

class VerifyOTPRequest(BaseModel):
    username: str
    email_otp: str
    mobile_otp: str

class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    mobile_number: str
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
    email: Optional[EmailStr] = None
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
class InstagramAccountCreate(BaseModel):
    instagram_username: str
    access_token: str
    refresh_token: Optional[str] = None

class InstagramAccountResponse(BaseModel):
    id: int
    user_id: int
    instagram_username: str
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True

# Instagram Credential Update Request Schemas
class CredentialUpdateRequestCreate(BaseModel):
    instagram_account_id: Optional[int] = None
    requested_username: str
    requested_password: Optional[str] = None
    requested_access_token: str
    requested_refresh_token: Optional[str] = None
    reason: str

class CredentialUpdateRequestProcess(BaseModel):
    status: str  # "Approved", "Rejected"
    admin_comments: Optional[str] = None

class CredentialUpdateRequestResponse(BaseModel):
    id: int
    user_id: int
    instagram_account_id: Optional[int] = None
    requested_username: str
    status: str
    reason: str
    admin_comments: Optional[str] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True

# Post / Publishing Schemas
class PublishRequest(BaseModel):
    caption: Optional[str] = ""
    hashtags: Optional[str] = ""
    account_ids: List[int]
    media_path: str

class PostResponse(BaseModel):
    id: int
    user_id: int
    instagram_account_id: int
    instagram_username: Optional[str] = None
    media_path: str
    caption: Optional[str] = None
    hashtags: Optional[str] = None
    publish_status: str
    created_at: datetime.datetime

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
