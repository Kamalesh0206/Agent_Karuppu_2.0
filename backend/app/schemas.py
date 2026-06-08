import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

# User Schemas
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: Optional[str] = "user"  # admin, user

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

# Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

# Account Schemas
class AccountCreate(BaseModel):
    username: str
    access_token: str

class AccountUpdate(BaseModel):
    username: Optional[str] = None
    access_token: Optional[str] = None
    status: Optional[str] = None  # ACTIVE, INACTIVE

class AccountResponse(BaseModel):
    id: int
    username: str
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True

# Post Schemas
class PublishRequest(BaseModel):
    caption: str
    hashtags: str
    account_ids: List[int]
    media_path: str  # Path returned from /upload-media

class PostResponse(BaseModel):
    id: int
    media_path: str
    caption: Optional[str] = None
    hashtags: Optional[str] = None
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class PostAccountResponse(BaseModel):
    id: int
    post_id: int
    account_id: int
    account_username: str
    publish_status: str
    published_at: Optional[datetime.datetime] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True

class PostDetailResponse(BaseModel):
    id: int
    media_path: str
    caption: Optional[str] = None
    hashtags: Optional[str] = None
    created_at: datetime.datetime
    destinations: List[PostAccountResponse]

    class Config:
        from_attributes = True

# Log Schemas
class LogResponse(BaseModel):
    id: int
    action: str
    message: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True
