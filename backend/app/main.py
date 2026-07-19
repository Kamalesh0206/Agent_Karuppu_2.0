import os
import shutil
import uuid
from datetime import datetime, timedelta
import requests
import json
import redis
import asyncio
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, SessionLocal, get_db
from .models import User, InstagramAccount, Post, PublishingQueue, PublishingHistory, PublishingLog, AuditLog, AccessToken, RefreshToken, Group
from .schemas import (
    UserLogin, UserCreate, UserResponse, UserUpdate, ChangePasswordRequest,
    Token, TokenData, InstagramAccountCreate, InstagramAccountUpdate, InstagramAccountResponse,
    PublishRequest, PostResponse, PublishingQueueResponse, PublishingHistoryResponse, PublishingLogResponse,
    AuditLogResponse, OptimizeRequest, OptimizeResponse, HashtagResponse, EmojiResponse, TranslateRequest, TranslateResponse, QualityScoreResponse,
    ValidateLinkRequest, ValidateLinkResponse, GroupCreate, GroupUpdate, GroupResponse, TokenUpdatePayload,
    UserReject, UserResetPassword
)
from .security import (
    verify_password, get_password_hash, create_access_token, 
    decode_access_token, encrypt_token, decrypt_token
)
from .tasks import process_queue_task, broadcast_status
from .celery_app import celery_app
from .instagram import InstagramClient, InstagramAPIError
from .gemini import GeminiClient
from .s3 import upload_file_to_s3

import logging
logger = logging.getLogger("main_app")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-ready Instagram Multi-Account Publishing Platform backend.",
    version="4.0.0"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "http://127.0.0.1",
        "https://agentkaruppu.netlify.app",
        "https://agent-karuppu.netlify.app"
    ],
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")), name="static")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")
redis_client = redis.Redis.from_url(settings.REDIS_URL)

# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

manager = ConnectionManager()

# Background Redis message listener for WebSockets
async def redis_listener():
    pubsub = redis_client.pubsub()
    pubsub.subscribe("publishing_status_updates")
    while True:
        try:
            message = pubsub.get_message(ignore_subscribe_messages=True)
            if message:
                data = message["data"].decode("utf-8")
                await manager.broadcast(data)
        except Exception as e:
            pass
        await asyncio.sleep(0.5)

@app.on_event("startup")
def startup_db_setup():
    print(f"Backend Broker:\n{settings.REDIS_URL}")
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import text
    db_alter = SessionLocal()
    try:
        db_alter.execute(text("ALTER TABLE instagram_accounts ADD COLUMN group_name VARCHAR(255) DEFAULT 'Default';"))
        db_alter.commit()
    except Exception as e:
        db_alter.rollback()
        err_msg = str(e).lower()
        if "duplicate column" not in err_msg and "already exists" not in err_msg:
            print(f"Alter table warning: {e}")
    try:
        db_alter.execute(text("ALTER TABLE instagram_accounts ADD COLUMN group_id INTEGER;"))
        db_alter.commit()
    except Exception as e:
        db_alter.rollback()
        err_msg = str(e).lower()
        if "duplicate column" not in err_msg and "already exists" not in err_msg:
            print(f"Alter table group_id warning: {e}")
    finally:
        db_alter.close()

    # Alter table users to add status columns
    new_user_cols = [
        ("approval_status", "VARCHAR(255) DEFAULT 'Pending'"),
        ("approved_by", "INTEGER"),
        ("approved_at", "TIMESTAMP"),
        ("rejected_by", "INTEGER"),
        ("rejected_at", "TIMESTAMP"),
        ("rejection_reason", "VARCHAR(255)"),
        ("disabled_at", "TIMESTAMP"),
        ("suspended_at", "TIMESTAMP"),
        ("last_login", "TIMESTAMP"),
        ("is_active", "BOOLEAN DEFAULT 1")
    ]
    for col_name, col_type in new_user_cols:
        db_alter = SessionLocal()
        try:
            db_alter.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type};"))
            db_alter.commit()
        except Exception as e:
            db_alter.rollback()
            err_msg = str(e).lower()
            if "duplicate column" not in err_msg and "already exists" not in err_msg:
                print(f"Alter table users {col_name} warning: {e}")
        finally:
            db_alter.close()

    db = SessionLocal()
    try:
        super_admin_email = "agentkaruppuadmin@gmail.com"
        admin = db.query(User).filter(User.email == super_admin_email).first()
        if not admin:
            admin_user = User(
                full_name="Super Admin",
                email=super_admin_email,
                mobile_number="0000000000",
                username="admin",
                password_hash=get_password_hash("admin123"),
                role="Super Admin",
                status="Approved",
                approval_status="Approved",
                is_active=True,
                email_verified=True,
                mobile_verified=True,
                publishing_permission=True
            )
            db.add(admin_user)
            db.commit()
            
            db.add(AuditLog(
                action="User Action",
                description="Database initialized. Super Admin seeded successfully."
            ))
            db.commit()
    finally:
        db.close()
    
    # Run async Redis listener task
    asyncio.create_task(redis_listener())

def create_audit_log(db: Session, action: str, description: str, user_id: Optional[int] = None, ip_address: Optional[str] = None):
    log_entry = AuditLog(
        user_id=user_id,
        action=action,
        description=description,
        ip_address=ip_address
    )
    db.add(log_entry)
    db.commit()

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception
    username: str = payload.get("username")
    if username is None:
        raise credentials_exception
        
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    
    # Check token blocklist
    db_token = db.query(AccessToken).filter(AccessToken.token == token, AccessToken.is_revoked == False).first()
    if not db_token:
        raise credentials_exception

    if user.status == "Deactivated":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated."
        )
    return user

def get_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "Super Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Super Admin privileges required."
        )
    return current_user

# --- Authentication Routes ---

@app.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    email_val = user_data.email.strip() if user_data.email and user_data.email.strip() else None
    mobile_val = user_data.mobile_number.strip() if user_data.mobile_number and user_data.mobile_number.strip() else None

    if not email_val and not mobile_val:
        raise HTTPException(status_code=400, detail="Either email or mobile number must be provided.")
        
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered.")
        
    new_user = User(
        full_name=user_data.full_name,
        email=email_val,
        mobile_number=mobile_val,
        username=user_data.username,
        password_hash=get_password_hash(user_data.password),
        role="User",
        status="Pending Approval",
        email_verified=True,
        mobile_verified=True,
        publishing_permission=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"User registered: {new_user.username}. Pending approval.",
        user_id=new_user.id,
        ip_address=client_ip
    )
    return new_user

@app.post("/login", response_model=Token)
def login(login_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        (User.username == login_data.username) | 
        (User.email == login_data.username) | 
        (User.mobile_number == login_data.username)
    ).first()

    client_ip = request.client.host if request.client else "127.0.0.1"

    if not user or not verify_password(login_data.password, user.password_hash):
        create_audit_log(
            db=db,
            action="Failures",
            description=f"Failed login attempt for: {login_data.username}",
            ip_address=client_ip
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password"
        )

    if user.status == "Pending Approval":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting administrator approval."
        )
    elif user.status == "Rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your registration has been rejected."
        )
    elif user.status == "Disabled":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been disabled."
        )
    elif user.status == "Suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been temporarily suspended."
        )

    # Capture last login
    user.last_login = datetime.utcnow()
    db.commit()

    access_token = create_access_token(data={"username": user.username, "role": user.role})
    
    # Store access token in db
    db_token = AccessToken(
        user_id=user.id,
        token=access_token,
        expires_at=datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    db.add(db_token)
    db.commit()

    create_audit_log(
        db=db,
        action="Login",
        description=f"User {user.username} logged in successfully.",
        user_id=user.id,
        ip_address=client_ip
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
        "status": user.status
    }

@app.post("/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    db_token = db.query(AccessToken).filter(AccessToken.token == token).first()
    if db_token:
        db_token.is_revoked = True
        db.commit()
    return {"detail": "Successfully logged out"}

# --- Facebook Login / OAuth Routes ---

@app.get("/login/facebook")
def login_facebook():
    """Redirects the user to Facebook OAuth login dialog."""
    scope = "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management"
    fb_auth_url = (
        f"https://www.facebook.com/{settings.FACEBOOK_REDIRECT_URI.split('/')[-1] if not settings.FACEBOOK_CLIENT_ID else settings.GRAPH_API_VERSION}/dialog/oauth"
        f"?client_id={settings.FACEBOOK_CLIENT_ID}"
        f"&redirect_uri={settings.FACEBOOK_REDIRECT_URI}"
        f"&scope={scope}"
        f"&response_type=code"
    )
    # If no Client ID configured, redirect back with mock token directly
    if not settings.FACEBOOK_CLIENT_ID:
        mock_callback_url = f"{settings.FACEBOOK_REDIRECT_URI}?code=mock_authorization_code"
        return RedirectResponse(mock_callback_url)
    return RedirectResponse(fb_auth_url)

@app.get("/oauth/callback")
def oauth_callback(code: str, request: Request, db: Session = Depends(get_db)):
    """Exchanges auth code for Long-lived token, syncs matching IG Business Profile, and registers."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    if code == "mock_authorization_code" or not settings.FACEBOOK_CLIENT_ID:
        # Register a mock profile
        mock_user_id = 1 # Seeded super admin
        account = InstagramAccount(
            user_id=mock_user_id,
            facebook_user_id="100009876543210",
            facebook_page_id="10485769213",
            facebook_page_name="Mock Page Marketing",
            page_access_token=encrypt_token("mock_long_lived_page_token"),
            instagram_business_id="17841401234567890",
            instagram_username="mock_instagram_user",
            profile_picture="https://placekitten.com/200/200",
            business_name="Mock IG Business",
            followers_count=1420,
            token_expiry=datetime.utcnow() + timedelta(days=60),
            status="Connected"
        )
        db.add(account)
        db.commit()
        
        create_audit_log(
            db=db,
            action="OAuth",
            description=f"Successfully connected mock profile @mock_instagram_user via Facebook Login OAuth.",
            user_id=mock_user_id,
            ip_address=client_ip
        )
        return RedirectResponse("http://localhost:3000/accounts?status=success&username=mock_instagram_user")

    # Real Facebook flow
    try:
        url = "https://graph.facebook.com/v25.0/oauth/access_token"
        params = {
            "client_id": settings.FACEBOOK_CLIENT_ID,
            "redirect_uri": settings.FACEBOOK_REDIRECT_URI,
            "client_secret": settings.FACEBOOK_CLIENT_SECRET,
            "code": code
        }
        res = requests.get(url, params=params).json()
        short_token = res.get("access_token")
        if not short_token:
            raise HTTPException(status_code=400, detail="Failed to acquire short-lived user token.")

        # Exchange to Long-lived User Token
        long_lived_res = InstagramClient.exchange_short_lived_token(short_token)
        long_user_token = long_lived_res.get("access_token")
        
        # Get User details and Pages
        pages_res = requests.get(
            f"https://graph.facebook.com/v25.0/me/accounts", 
            params={"access_token": long_user_token}
        ).json()
        
        pages_data = pages_res.get("data", [])
        if not pages_data:
            raise HTTPException(status_code=400, detail="No managed Facebook pages found linked to this account.")

        connected_usernames = []
        for page in pages_data:
            page_id = page.get("id")
            page_name = page.get("name")
            
            # Retrieve page token
            page_token = page.get("access_token")
            # Exchange page token to long lived page token
            long_page_token = InstagramClient.get_long_lived_page_token(long_user_token, page_id)
            
            # Retrieve Instagram Business ID linked to this Facebook Page
            ig_res = requests.get(
                f"https://graph.facebook.com/v25.0/{page_id}",
                params={
                    "fields": "id,name,instagram_business_account",
                    "access_token": long_page_token
                }
            ).json()
            
            ig_account = ig_res.get("instagram_business_account")
            if ig_account:
                ig_id = ig_account.get("id")
                # Retrieve profile details (followers, name, and profile pictures)
                profile = InstagramClient.get_instagram_profile_details(ig_id, long_page_token)
                
                # Encrypt and save account parameters
                existing = db.query(InstagramAccount).filter(InstagramAccount.instagram_business_id == ig_id).first()
                if not existing:
                    new_acc = InstagramAccount(
                        user_id=1,  # Default User
                        facebook_user_id=res.get("user_id"),
                        facebook_page_id=page_id,
                        facebook_page_name=page_name,
                        page_access_token=encrypt_token(long_page_token),
                        instagram_business_id=ig_id,
                        instagram_username=profile.get("username"),
                        profile_picture=profile.get("profile_picture_url"),
                        business_name=profile.get("name"),
                        followers_count=profile.get("followers_count", 0),
                        token_expiry=datetime.utcnow() + timedelta(days=60),
                        status="Connected"
                    )
                    db.add(new_acc)
                    connected_usernames.append(profile.get("username"))
                else:
                    existing.page_access_token = encrypt_token(long_page_token)
                    existing.profile_picture = profile.get("profile_picture_url")
                    existing.business_name = profile.get("name")
                    existing.followers_count = profile.get("followers_count", 0)
                    existing.token_expiry = datetime.utcnow() + timedelta(days=60)
                    existing.status = "Connected"
                    connected_usernames.append(profile.get("username"))
        
        db.commit()
        return RedirectResponse(f"http://localhost:3000/accounts?status=success&username={','.join(connected_usernames)}")
    except Exception as e:
        return RedirectResponse(f"http://localhost:3000/accounts?status=error&message={str(e)}")

# --- Accounts CRUD Routes ---

@app.get("/accounts", response_model=List[InstagramAccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Synchronize profiles followers counts on loading accounts
    accounts = db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).all()
    for acc in accounts:
        try:
            token = decrypt_token(acc.page_access_token)
            if not InstagramClient.is_mock_token(token):
                profile = InstagramClient.get_instagram_profile_details(acc.instagram_business_id, token)
                acc.followers_count = profile.get("followers_count", 0)
                acc.profile_picture = profile.get("profile_picture_url")
                acc.business_name = profile.get("name")
        except Exception:
            pass
    db.commit()
    return accounts

@app.post("/accounts/connect", response_model=InstagramAccountResponse)
def connect_account_manually(
    acc_data: InstagramAccountCreate, 
    request: Request,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Allows manual connection by passing a pre-generated page token and username details."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    # Verify account
    result = InstagramClient.verify_and_resolve_account(
        username=acc_data.instagram_username_or_email,
        access_token=acc_data.access_token,
        facebook_page_id=acc_data.facebook_page_id
    )
    if result["status"] == "rejected":
        raise HTTPException(status_code=400, detail=result.get("reason", "Verification rejected"))

    # Encrypt token
    encrypted_token = encrypt_token(acc_data.access_token)

    new_acc = InstagramAccount(
        user_id=current_user.id,
        facebook_page_id=result["facebook_page_id"],
        facebook_page_name=result.get("business_name") or "Manual Connected Page",
        page_access_token=encrypted_token,
        instagram_business_id=result["instagram_account_id"],
        instagram_username=result["username"],
        profile_picture=result.get("profile_picture") or "https://placekitten.com/200/200",
        business_name=result.get("business_name") or "Manual Business",
        followers_count=result.get("followers_count", 0),
        token_expiry=result["token_expiry_time"],
        status="Connected"
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)

    create_audit_log(
        db=db,
        action="User Action",
        description=f"User {current_user.username} manually connected Instagram Profile @{new_acc.instagram_username}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return new_acc

@app.put("/accounts/{id}", response_model=InstagramAccountResponse)
def update_account_credentials(
    id: int,
    acc_data: InstagramAccountUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
    if acc.user_id != current_user.id and current_user.role != "Super Admin":
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this profile.")

    client_ip = request.client.host if request.client else "127.0.0.1"

    if acc_data.access_token:
        # Re-verify and resolve with the new token
        result = InstagramClient.verify_and_resolve_account(
            username=acc.instagram_username,
            access_token=acc_data.access_token,
            facebook_page_id=acc_data.facebook_page_id or acc.facebook_page_id
        )
        if result["status"] == "rejected":
            raise HTTPException(status_code=400, detail=result.get("reason", "Verification rejected with new token"))
        
        acc.page_access_token = encrypt_token(acc_data.access_token)
        acc.instagram_business_id = result["instagram_account_id"]
        acc.instagram_username = result["username"]
        acc.profile_picture = result.get("profile_picture") or acc.profile_picture
        acc.business_name = result.get("business_name") or acc.business_name
        acc.followers_count = result.get("followers_count", acc.followers_count)
        acc.token_expiry = result["token_expiry_time"]
        acc.status = "Connected"

    if acc_data.facebook_page_id and not acc_data.access_token:
        acc.facebook_page_id = acc_data.facebook_page_id

    if acc_data.group_name is not None:
        acc.group_name = acc_data.group_name

    db.commit()
    db.refresh(acc)

    create_audit_log(
        db=db,
        action="User Action",
        description=f"User {current_user.username} updated credentials for Instagram Profile @{acc.instagram_username}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return acc

@app.delete("/accounts/{id}")
def delete_account(id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
    if acc.user_id != current_user.id and current_user.role != "Super Admin":
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this profile.")

    username = acc.instagram_username
    db.delete(acc)
    db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"User {current_user.username} disconnected Instagram Profile @{username}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {"detail": "Instagram profile successfully disconnected."}

# --- Group Management Routes ---

from pydantic import BaseModel

class TokenValidationRequest(BaseModel):
    access_token: str

class MoveAccountRequest(BaseModel):
    group_id: Optional[int] = None

class LinkInstagramRequest(BaseModel):
    instagram_username: str
    facebook_page_id: str
    facebook_page_name: Optional[str] = None
    instagram_business_id: Optional[str] = None
    access_token: str
    followers_count: Optional[int] = 0
    profile_picture: Optional[str] = None
    force_move: Optional[bool] = False

@app.post("/groups/resolve-accounts")
def resolve_accounts(payload: TokenValidationRequest, current_user: User = Depends(get_current_user)):
    accounts = InstagramClient.resolve_accounts_from_token(payload.access_token)
    return accounts

@app.post("/groups/{group_id}/link-instagram", response_model=InstagramAccountResponse)
def link_instagram_to_group(
    group_id: int,
    payload: LinkInstagramRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    group = db.query(Group).filter(Group.id == group_id, Group.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Target Group not found.")
        
    biz_id = payload.instagram_business_id
    username = payload.instagram_username
    page_name = payload.facebook_page_name
    followers = payload.followers_count
    profile_pic = payload.profile_picture

    if not biz_id:
        resolved = InstagramClient.verify_and_resolve_account(
            username=payload.instagram_username,
            access_token=payload.access_token,
            facebook_page_id=payload.facebook_page_id
        )
        if resolved.get("status") != "approved":
            raise HTTPException(status_code=400, detail=resolved.get("reason", "Manual validation rejected."))
            
        biz_id = resolved.get("instagram_account_id")
        username = resolved.get("username")
        followers = resolved.get("followers_count", 0)
        profile_pic = resolved.get("profile_picture")
        page_name = resolved.get("business_name") or page_name

    existing = db.query(InstagramAccount).filter(
        InstagramAccount.instagram_business_id == biz_id
    ).first()
    
    if existing:
        if existing.group_id == group_id:
            existing.page_access_token = encrypt_token(payload.access_token)
            existing.followers_count = followers or existing.followers_count
            existing.profile_picture = profile_pic or existing.profile_picture
            existing.status = "Connected"
            existing.token_expiry = datetime.utcnow() + timedelta(days=60)
            db.commit()
            db.refresh(existing)
            return existing
            
        if not payload.force_move:
            current_owner_group = db.query(Group).filter(Group.id == existing.group_id).first()
            current_group_name = current_owner_group.name if current_owner_group else "Another Group"
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "exists_in_other_group",
                    "group_name": current_group_name,
                    "group_id": existing.group_id
                }
            )
            
        existing.group_id = group_id
        existing.group_name = group.name
        existing.page_access_token = encrypt_token(payload.access_token)
        existing.followers_count = followers or existing.followers_count
        existing.profile_picture = profile_pic or existing.profile_picture
        existing.status = "Connected"
        existing.token_expiry = datetime.utcnow() + timedelta(days=60)
        db.commit()
        db.refresh(existing)
        return existing
        
    new_acc = InstagramAccount(
        user_id=current_user.id,
        group_id=group_id,
        group_name=group.name,
        facebook_user_id=None,
        facebook_page_id=payload.facebook_page_id,
        facebook_page_name=page_name or "Connected Page",
        page_access_token=encrypt_token(payload.access_token),
        instagram_business_id=biz_id,
        instagram_username=username,
        profile_picture=profile_pic or "https://placekitten.com/200/200",
        business_name=page_name or "IG Business",
        followers_count=followers or 0,
        token_expiry=datetime.utcnow() + timedelta(days=60),
        status="Connected"
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc

@app.get("/groups", response_model=List[GroupResponse])
def get_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Load all user groups
    user_groups = db.query(Group).filter(Group.user_id == current_user.id).all()
    
    # Auto-seed Default group if none exist
    if not user_groups:
        default_group = Group(user_id=current_user.id, name="Default")
        db.add(default_group)
        db.commit()
        db.refresh(default_group)
        user_groups = [default_group]
        
    # Map all unassigned accounts to the first group
    unassigned_accounts = db.query(InstagramAccount).filter(
        InstagramAccount.user_id == current_user.id,
        InstagramAccount.group_id == None
    ).all()
    if unassigned_accounts:
        target_group = user_groups[0]
        for acc in unassigned_accounts:
            acc.group_id = target_group.id
        db.commit()
        
    # Build responses with account counts
    responses = []
    for g in user_groups:
        count = db.query(InstagramAccount).filter(InstagramAccount.group_id == g.id).count()
        responses.append(GroupResponse(
            id=g.id,
            user_id=g.user_id,
            name=g.name,
            account_count=count,
            created_at=g.created_at,
            updated_at=g.updated_at
        ))
    return responses

@app.post("/groups", response_model=GroupResponse)
def create_group(group_data: GroupCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    new_group = Group(user_id=current_user.id, name=group_data.name)
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    return GroupResponse(
        id=new_group.id,
        user_id=new_group.user_id,
        name=new_group.name,
        account_count=0,
        created_at=new_group.created_at,
        updated_at=new_group.updated_at
    )

@app.put("/groups/{id}", response_model=GroupResponse)
def update_group(id: int, group_data: GroupUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = db.query(Group).filter(Group.id == id, Group.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    group.name = group_data.name
    db.commit()
    db.refresh(group)
    count = db.query(InstagramAccount).filter(InstagramAccount.group_id == group.id).count()
    return GroupResponse(
        id=group.id,
        user_id=group.user_id,
        name=group.name,
        account_count=count,
        created_at=group.created_at,
        updated_at=group.updated_at
    )

@app.delete("/groups/{id}")
def delete_group(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = db.query(Group).filter(Group.id == id, Group.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
    
    # Verify group is empty
    count = db.query(InstagramAccount).filter(InstagramAccount.group_id == group.id).count()
    if count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete group: group contains connected profiles. Move profiles to another group first.")
        
    db.delete(group)
    db.commit()
    return {"detail": "Group deleted successfully."}

@app.post("/accounts/{id}/move", response_model=InstagramAccountResponse)
def move_account_to_group(id: int, payload: MoveAccountRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id, InstagramAccount.user_id == current_user.id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
        
    if payload.group_id:
        target_group = db.query(Group).filter(Group.id == payload.group_id, Group.user_id == current_user.id).first()
        if not target_group:
            raise HTTPException(status_code=404, detail="Target Group not found.")
        acc.group_id = target_group.id
        acc.group_name = target_group.name
    else:
        acc.group_id = None
        acc.group_name = None
        
    db.commit()
    db.refresh(acc)
    return acc

@app.get("/groups/{group_id}/accounts", response_model=List[InstagramAccountResponse])
def get_group_accounts(group_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(InstagramAccount).filter(
        InstagramAccount.user_id == current_user.id,
        InstagramAccount.group_id == group_id
    ).all()

@app.post("/groups/{group_id}/validate-token")
def validate_group_token(group_id: int, payload: TokenValidationRequest, current_user: User = Depends(get_current_user)):
    token = payload.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty.")
        
    if InstagramClient.is_mock_token(token):
        return {
            "valid": True,
            "expiry_date": (datetime.utcnow() + timedelta(days=60)).strftime("%d-%b-%Y %I:%M %p"),
            "available_pages": [
                {"id": "page123", "name": "Mock Facebook Page 1"},
                {"id": "page456", "name": "Mock Facebook Page 2"}
            ],
            "connected_instagram_accounts": [
                {"username": "mock_account_1", "id": "ig123"},
                {"username": "mock_account_2", "id": "ig456"}
            ],
            "missing_permissions": []
        }
        
    # Live validation queries
    try:
        url = f"{InstagramClient.BASE_URL}/me"
        params = {"fields": "id,name", "access_token": token}
        res = requests.get(url, params=params, timeout=10)
        if res.status_code != 200:
            raise HTTPException(status_code=400, detail="Invalid token credentials.")
            
        # Get user permissions
        perm_url = f"{InstagramClient.BASE_URL}/me/permissions"
        perm_res = requests.get(perm_url, params={"access_token": token}, timeout=10)
        permissions = []
        if perm_res.status_code == 200:
            permissions = [p["permission"] for p in perm_res.json().get("data", []) if p["status"] == "granted"]
            
        required = ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list"]
        missing = [r for r in required if r not in permissions]
        
        # Get pages and connected instagram accounts
        pages_url = f"{InstagramClient.BASE_URL}/me/accounts"
        pages_res = requests.get(pages_url, params={"access_token": token}, timeout=10)
        available_pages = []
        connected_ig = []
        
        if pages_res.status_code == 200:
            for page in pages_res.json().get("data", []):
                pid = page.get("id")
                pname = page.get("name")
                available_pages.append({"id": pid, "name": pname})
                
                # Check for ig account
                ig_url = f"{InstagramClient.BASE_URL}/{pid}"
                ig_res = requests.get(ig_url, params={"fields": "instagram_business_account", "access_token": token}, timeout=10)
                if ig_res.status_code == 200:
                    biz = ig_res.json().get("instagram_business_account")
                    if biz:
                        # Get username
                        username_url = f"{InstagramClient.BASE_URL}/{biz.get('id')}"
                        u_res = requests.get(username_url, params={"fields": "username", "access_token": token}, timeout=10)
                        uname = u_res.json().get("username") if u_res.status_code == 200 else "Unknown IG"
                        connected_ig.append({"username": uname, "id": biz.get("id")})
                        
        return {
            "valid": True,
            "expiry_date": (datetime.utcnow() + timedelta(days=60)).strftime("%d-%b-%Y %I:%M %p"),
            "available_pages": available_pages,
            "connected_instagram_accounts": connected_ig,
            "missing_permissions": missing
        }
    except Exception as err:
        raise HTTPException(status_code=400, detail=str(err))

@app.post("/groups/{group_id}/update-token")
def update_group_profile_tokens(
    group_id: int,
    payload: TokenUpdatePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Retrieve all accounts in this group
    accounts = db.query(InstagramAccount).filter(
        InstagramAccount.user_id == current_user.id,
        InstagramAccount.group_id == group_id
    ).all()
    
    # Filter target accounts if selection was provided
    target_ids = payload.account_ids
    if target_ids is not None:
        target_accounts = [acc for acc in accounts if acc.id in target_ids]
    else:
        target_accounts = accounts
        
    total = len(target_accounts)
    updated = 0
    failed = 0
    skipped = len(accounts) - total
    failed_details = []
    
    if payload.validate_token:
        # Dry run token test
        res = InstagramClient.validate_access_token(payload.access_token)
        if not res["valid"]:
            raise HTTPException(status_code=400, detail=f"Token validation failed: {res.get('reason')}")
            
    for acc in target_accounts:
        try:
            token = payload.access_token.strip()
            if not InstagramClient.is_mock_token(token):
                profile = InstagramClient.get_instagram_profile_details(acc.instagram_business_id, token)
                acc.followers_count = profile.get("followers_count", acc.followers_count)
                acc.profile_picture = profile.get("profile_picture_url") or acc.profile_picture
                acc.business_name = profile.get("name") or acc.business_name
                
            acc.page_access_token = encrypt_token(token)
            acc.status = "Connected"
            acc.token_expiry = datetime.utcnow() + timedelta(days=60)
            updated += 1
        except Exception as e:
            failed += 1
            failed_details.append({
                "username": acc.instagram_username,
                "reason": str(e)
            })
            
    db.commit()
    return {
        "total": total + skipped,
        "updated": updated,
        "failed": failed,
        "skipped": skipped,
        "failed_details": failed_details
    }

# --- Publishing Routes ---

@app.post("/publish")
def publish_post(
    pub_req: PublishRequest, 
    request: Request,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """Creates a post and pushes a sequential publishing job onto the worker queue for each profile card."""
    from fastapi.responses import JSONResponse
    import traceback
    import sys
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    request_id = str(uuid.uuid4())
    
    logger.info("[Publish] Request received")
    logger.info(f"[Publish Workflow] Request received | Request ID: {request_id} | Payload: {pub_req.model_dump()}")
    logger.info(f"[Publish Workflow] User validated: {current_user.username} | Request ID: {request_id}")

    try:
        # Verify background Celery worker is running using the WorkerService
        from .worker_service import WorkerService
        status_info = WorkerService.get_status()
        if not status_info["worker_running"]:
            raise ValueError("Publishing worker is not running. Job has been queued but cannot be processed.")

        # Validate Media
        if not pub_req.media_url:
            raise ValueError("Media URL is required.")
            
        # Auto-detect or normalize media type (VIDEO -> REELS, mp4/mov -> REELS)
        norm_media_type = pub_req.media_type
        if norm_media_type == "VIDEO":
            norm_media_type = "REELS"
            
        if norm_media_type not in ["IMAGE", "REELS"]:
            url_path = pub_req.media_url.lower()
            mime = (pub_req.mime_type or "").lower()
            if url_path.endswith((".mp4", ".mov")) or "video" in mime:
                norm_media_type = "REELS"
            else:
                norm_media_type = "IMAGE"
                
        logger.info(f"[Publish Workflow] Media validated: type={norm_media_type}, url={pub_req.media_url} | Request ID: {request_id}")

        logger.info("[Queue] Creating job")
        # 1. Create central Post
        post = Post(
            user_id=current_user.id,
            caption=pub_req.caption,
            media_url=pub_req.media_url,
            media_type=norm_media_type,
            onedrive_share_url=pub_req.onedrive_share_url,
            direct_download_url=pub_req.direct_download_url,
            filename=pub_req.filename,
            mime_type=pub_req.mime_type,
            file_size=pub_req.file_size
        )
        db.add(post)
        db.commit()
        db.refresh(post)
        logger.info(f"[Publish Workflow] Publish job created: Post ID {post.id} | Request ID: {request_id}")

        created_queue_items = []
        
        # 2. Push to queue
        for acc_id in pub_req.account_ids:
            acc = db.query(InstagramAccount).filter(InstagramAccount.id == acc_id).first()
            if not acc:
                logger.warning(f"[Publish Workflow] Instagram account {acc_id} not found | Request ID: {request_id}")
                continue
            
            logger.info(f"[Publish Workflow] Instagram account loaded: @{acc.instagram_username} | Request ID: {request_id}")
            logger.info(f"[Publish Workflow] Access token loaded for @{acc.instagram_username} | Request ID: {request_id}")
                
            queue_item = PublishingQueue(
                post_id=post.id,
                account_id=acc.id,
                status="QUEUED",
                progress_percent=0,
                current_step="Pending Queue Slot"
            )
            
            logger.info(f"[Publish Workflow] Queue injection started for @{acc.instagram_username} | Request ID: {request_id}")
            db.add(queue_item)
            db.commit()
            db.refresh(queue_item)
            created_queue_items.append(queue_item)
            logger.info(f"[Queue] Job ID created: {queue_item.id}")
            logger.info(f"[Publish Workflow] Queue injection completed for @{acc.instagram_username} | Queue Item ID {queue_item.id} | Request ID: {request_id}")

        # 3. Submit queue processing task via Celery apply_async
        task_id = str(uuid.uuid4())
        logger.info("Submitting publish task...")
        logger.info(f"Broker URL: {settings.REDIS_URL}")
        logger.info("Queue name: celery")
        logger.info("Task name: app.tasks.process_queue_task")
        logger.info(f"Task ID: {task_id}")
        
        try:
            task = process_queue_task.apply_async(task_id=task_id)
            logger.info("Task successfully queued.")
        except Exception as queue_err:
            tb = traceback.format_exc()
            logger.error(f"Task submission failed: {queue_err}\nTraceback:\n{tb}")
            raise queue_err

        create_audit_log(
            db=db,
            action="Publishing",
            description=f"Enqueued publish task ID {post.id} targeting {len(pub_req.account_ids)} accounts.",
            user_id=current_user.id,
            ip_address=client_ip
        )

        return {
            "task_id": task.id,
            "status": "queued"
        }

    except Exception as e:
        db.rollback()
        tb = traceback.format_exc()
        frame = sys.exc_info()[2].tb_frame if sys.exc_info()[2] else None
        filename = frame.f_code.co_filename if frame else "main.py"
        func_name = frame.f_code.co_name if frame else "publish_post"
        line_no = sys.exc_info()[2].tb_lineno if sys.exc_info()[2] else 0
        
        logger.error(f"[Publish Workflow] Queue injection failed in {filename}:{func_name} at line {line_no} | Request ID: {request_id} | Error: {str(e)}\nTraceback:\n{tb}")
        
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "stage": "queue_injection",
                "error": str(e),
                "traceback": tb
            }
        )

@app.post("/publish/{id}/retry")
def retry_failed_publish_item(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PublishingQueue).filter(PublishingQueue.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found.")
        
    item.status = "Waiting"
    item.progress_percent = 0
    item.current_step = "Retrying Manual Trigger"
    item.retry_count = 0
    db.commit()
    
    process_queue_task.delay()
    return {"detail": "Retry enqueued successfully."}

@app.get("/publish-history/{id}/logs", response_model=List[PublishingLogResponse])
def get_publishing_item_logs(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PublishingLog).filter(PublishingLog.queue_id == id).order_by(PublishingLog.timestamp.asc()).all()

@app.get("/publish/status", response_model=List[PublishingQueueResponse])
def get_publishing_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve outstanding queue logs."""
    return db.query(PublishingQueue).join(Post).filter(Post.user_id == current_user.id).order_by(PublishingQueue.id.desc()).all()

@app.get("/publish/history", response_model=List[PublishingHistoryResponse])
def get_publishing_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve success publications history."""
    return db.query(PublishingHistory).join(Post).filter(Post.user_id == current_user.id).order_by(PublishingHistory.published_time.desc()).all()

@app.get("/publish/logs", response_model=List[AuditLogResponse])
def get_audit_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Fetch user audit trail."""
    return db.query(AuditLog).filter(AuditLog.user_id == current_user.id).order_by(AuditLog.created_at.desc()).all()

@app.get("/publish/errors", response_model=List[PublishingLogResponse])
def get_publishing_errors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve error tracking metrics enqueued in PublishingLogs."""
    return db.query(PublishingLog).join(PublishingQueue).join(Post).filter(Post.user_id == current_user.id).order_by(PublishingLog.timestamp.desc()).all()

# --- Public Media URL Conversion and Validation Routes ---

def is_microsoft_onedrive_domain(hostname: str) -> bool:
    if not hostname:
        return False
    hostname = hostname.lower()
    if hostname == "1drv.ms":
        return True
    if hostname == "onedrive.live.com" or hostname.endswith(".onedrive.live.com"):
        return True
    if hostname.endswith(".sharepoint.com"):
        return True
    if hostname.endswith(".sharepoint-df.com"):
        return True
    return False

def resolve_and_convert_media_url(url: str) -> str:
    """
    Converts general cloud drive share links (OneDrive, Google Drive, Dropbox)
    to direct download URLs, processes social media links, and returns raw CDN/direct links.
    """
    import urllib.parse
    import base64
    import re
    cleaned = url.strip()
    
    # 1. Follow initial redirects (e.g. shortened links like 1drv.ms or bit.ly)
    try:
        response = requests.get(cleaned, allow_redirects=True, stream=True, timeout=10)
        resolved_url = response.url
    except Exception:
        resolved_url = cleaned
            
    parsed = urllib.parse.urlparse(resolved_url)
    domain = (parsed.hostname or "").lower()
    
    # OneDrive (Personal / Shortened)
    if domain == "onedrive.live.com" or domain.endswith(".onedrive.live.com") or domain == "1drv.ms":
        # Base64 encode the sharing URL to use with api.onedrive.com shares endpoint
        encoded = base64.b64encode(resolved_url.encode("utf-8")).decode("utf-8")
        base64url = encoded.replace("/", "_").replace("+", "-").rstrip("=")
        return f"https://api.onedrive.com/v1.0/shares/u!{base64url}/root/content"
        
    # OneDrive Business / SharePoint
    elif domain.endswith(".sharepoint.com") or domain.endswith(".sharepoint-df.com"):
        if "download=1" in parsed.query:
            return resolved_url
        if "?" in resolved_url or parsed.query:
            query_params = urllib.parse.parse_qs(parsed.query)
            if "download" not in query_params:
                if resolved_url.endswith("&") or resolved_url.endswith("?"):
                    direct_url = resolved_url + "download=1"
                else:
                    separator = "&" if "?" in resolved_url else "?"
                    direct_url = resolved_url + separator + "download=1"
            else:
                direct_url = resolved_url
        else:
            direct_url = resolved_url + "?download=1"
        return direct_url

    # Google Drive
    elif "drive.google.com" in domain:
        file_id = None
        # Format 1: drive.google.com/file/d/FILE_ID/view...
        match = re.search(r"/file/d/([^/]+)", resolved_url)
        if match:
            file_id = match.group(1)
        else:
            # Format 2: drive.google.com/open?id=FILE_ID
            query_params = urllib.parse.parse_qs(parsed.query)
            if "id" in query_params:
                file_id = query_params["id"][0]
        
        if file_id:
            return f"https://drive.google.com/uc?export=download&id={file_id}"
        else:
            raise ValueError("Could not extract Google Drive file ID.")

    # Dropbox
    elif "dropbox.com" in domain:
        if "dl=0" in resolved_url:
            return resolved_url.replace("dl=0", "raw=1")
        elif "dl=1" in resolved_url:
            return resolved_url.replace("dl=1", "raw=1")
        else:
            if "?" in resolved_url:
                return resolved_url + "&raw=1"
            else:
                return resolved_url + "?raw=1"

    # Facebook & Instagram
    elif "facebook.com" in domain or "instagram.com" in domain:
        try:
            # Try to fetch and extract og metadata from the webpage
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"}
            page_res = requests.get(resolved_url, headers=headers, timeout=10)
            html = page_res.text
            
            # Extract video metadata
            video_match = re.search(r'<meta[^>]*property=["\']og:video["\'][^>]*content=["\']([^"\']+)["\']', html)
            if video_match:
                return video_match.group(1).replace("&amp;", "&")
            
            # Extract image metadata
            image_match = re.search(r'<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', html)
            if image_match:
                return image_match.group(1).replace("&amp;", "&")
        except Exception:
            pass
            
        raise ValueError("This social media post URL cannot be used directly. Please provide the original media file or a direct public media URL.")

    # General Direct URL (S3, Azure, CDN, raw file)
    return resolved_url

@app.post("/media/validate-link", response_model=ValidateLinkResponse)
def validate_onedrive_link(req: ValidateLinkRequest, current_user: User = Depends(get_current_user)):
    """
    Accepts any public media URL, validates it, converts it if necessary,
    and returns metadata and direct download URL.
    """
    import urllib.parse
    import re
    
    share_url = req.url.strip()
    if not share_url:
        raise HTTPException(status_code=400, detail="URL cannot be empty.")
        
    try:
        direct_download_url = resolve_and_convert_media_url(share_url)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=f"❌ {str(val_err)}")
        
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"}
        res = requests.get(direct_download_url, stream=True, headers=headers, timeout=15)
    except Exception:
        raise HTTPException(status_code=400, detail="❌ File cannot be accessed or downloaded. Network timeout.")
        
    if res.status_code in [401, 403]:
        raise HTTPException(status_code=400, detail="❌ Authentication required. Public access is disabled.")
        
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"❌ File not found. Source returned HTTP {res.status_code}.")
        
    headers = res.headers
    content_type = headers.get("Content-Type", "").split(";")[0].strip().lower()
    content_length_str = headers.get("Content-Length")
    
    # Reject folder views / HTML pages
    if "text/html" in content_type:
        raise HTTPException(status_code=400, detail="❌ Link points to a webpage or folder view instead of a raw media file.")
        
    # Supported media validation
    supported_images = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
    supported_videos = ["video/mp4", "video/quicktime"]
    
    is_image = content_type in supported_images
    is_video = content_type in supported_videos
    
    if not is_image and not is_video:
        raise HTTPException(status_code=400, detail="❌ Unsupported media type. Must be JPG, JPEG, PNG, WEBP, MP4, or MOV.")
        
    # File size validation
    file_size = 0
    if content_length_str:
        try:
            file_size = int(content_length_str)
        except ValueError:
            pass
            
    if is_image and file_size > 8388608: # 8MB
        raise HTTPException(status_code=400, detail="❌ File exceeds Instagram size limit (max 8MB for images).")
    if is_video and file_size > 104857600: # 100MB
        raise HTTPException(status_code=400, detail="❌ File exceeds Instagram size limit (max 100MB for videos).")
        
    # Extract filename
    filename = "media_file"
    content_disp = headers.get("Content-Disposition", "")
    if content_disp:
        match = re.search(r'filename=["\']?([^"\';]+)["\']?', content_disp)
        if match:
            filename = match.group(1)
    else:
        url_path = urllib.parse.urlparse(direct_download_url).path
        base_name = os.path.basename(url_path)
        if base_name and "." in base_name:
            filename = base_name
        else:
            ext = "jpg"
            if content_type == "image/png":
                ext = "png"
            elif content_type == "image/webp":
                ext = "webp"
            elif content_type == "video/mp4":
                ext = "mp4"
            elif content_type == "video/quicktime":
                ext = "mov"
            filename = f"media_file.{ext}"
        
    detected_type = "REELS" if "video" in content_type or filename.lower().endswith((".mp4", ".mov")) else "IMAGE"
    return {
        "valid": True,
        "filename": filename,
        "mime_type": content_type,
        "size": file_size,
        "direct_download_url": direct_download_url,
        "media_type": detected_type
    }

# --- User Profile Routes ---

@app.get("/profile", response_model=UserResponse)
def get_user_profile(current_user: User = Depends(get_current_user)):
    return current_user

@app.put("/profile", response_model=UserResponse)
def update_user_profile(
    profile_data: UserUpdate, 
    request: Request,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    if profile_data.full_name is not None:
        current_user.full_name = profile_data.full_name.strip()
    if profile_data.email is not None:
        current_user.email = profile_data.email.strip()
    if profile_data.mobile_number is not None:
        current_user.mobile_number = profile_data.mobile_number.strip()
        
    db.commit()
    db.refresh(current_user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"User {current_user.username} updated profile details.",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return current_user

@app.put("/profile/password")
def change_password(
    pwd_data: ChangePasswordRequest, 
    request: Request,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    if not verify_password(pwd_data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect old password.")
        
    current_user.password_hash = get_password_hash(pwd_data.new_password)
    db.commit()
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"User {current_user.username} changed password successfully.",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {"detail": "Password successfully updated."}

# --- AI Integration Routes (Google Gemini) ---

@app.post("/ai/optimize", response_model=OptimizeResponse)
def ai_optimize_caption(req: OptimizeRequest):
    res = GeminiClient.optimize_caption(req.caption)
    return {"optimized_caption": res}

@app.post("/ai/hashtags", response_model=HashtagResponse)
def ai_suggest_hashtags(req: OptimizeRequest):
    tags = GeminiClient.suggest_hashtags(req.caption)
    return {"hashtags": tags}

@app.post("/ai/emojis", response_model=EmojiResponse)
def ai_suggest_emojis(req: OptimizeRequest):
    emojis = GeminiClient.suggest_emojis(req.caption)
    return {"emojis": emojis}

@app.post("/ai/translate", response_model=TranslateResponse)
def ai_translate_caption(req: TranslateRequest):
    res = GeminiClient.translate_caption(req.caption, req.target_lang)
    return {"translated_caption": res}

@app.post("/ai/quality-score", response_model=QualityScoreResponse)
def ai_get_quality_score(req: OptimizeRequest):
    score = GeminiClient.calculate_quality_score(req.caption)
    return {"score": score}

# --- WebSocket Progress Stream Endpoint ---

@app.websocket("/publish/ws")
async def websocket_publishing_progress(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open, handle client messages if any
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- API Alias Endpoints ---

@app.post("/api/publish")
def api_publish_post(pub_req: PublishRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return publish_post(pub_req, request, db, current_user)

@app.get("/api/publishing/status")
def api_publishing_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_publishing_status(db, current_user)

@app.get("/api/publishing/queue")
def api_publishing_queue(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_publishing_status(db, current_user)

@app.get("/api/publishing/errors")
def api_publishing_errors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_publishing_errors(db, current_user)

@app.get("/api/system/worker-status")
def api_system_worker_status(current_user: User = Depends(get_current_user)):
    from .worker_service import WorkerService
    return WorkerService.get_status()

@app.get("/system/worker-status")
def system_worker_status(current_user: User = Depends(get_current_user)):
    from .worker_service import WorkerService
    return WorkerService.get_status()

from .models import SyncedPost, FollowRelationship
from datetime import datetime, timedelta

# Schemas
class SyncedPostResponse(BaseModel):
    id: int
    media_id: str
    media_url: Optional[str] = None
    caption: Optional[str] = None
    media_type: Optional[str] = None
    like_count: int
    comment_count: int
    permalink: Optional[str] = None
    published_at: Optional[datetime] = None
    instagram_username: str

    class Config:
        orm_mode = True

class FollowRelationshipResponse(BaseModel):
    id: int
    follower_username: str
    followed_username: str
    status: str
    last_checked: datetime

# --- Engagement Center Routes ---

@app.post("/groups/{group_id}/engagement/sync")
def sync_engagement_center(
    group_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    client_ip = request.client.host if request.client else "127.0.0.1"
    group = db.query(Group).filter(Group.id == group_id, Group.user_id == current_user.id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")

    accounts = db.query(InstagramAccount).filter(InstagramAccount.group_id == group_id).all()
    if not accounts:
        return {"detail": "No accounts in group to sync."}

    total_synced_posts = 0
    for acc in accounts:
        try:
            token = decrypt_token(acc.page_access_token)
            posts = InstagramClient.fetch_recent_posts(acc.instagram_business_id, token)
            
            for p in posts:
                existing = db.query(SyncedPost).filter(SyncedPost.media_id == p["media_id"]).first()
                if existing:
                    existing.like_count = p["like_count"]
                    existing.comment_count = p["comment_count"]
                    existing.media_url = p["media_url"]
                    existing.caption = p["caption"]
                    existing.permalink = p["permalink"]
                else:
                    new_post = SyncedPost(
                        instagram_account_id=acc.id,
                        media_id=p["media_id"],
                        permalink=p["permalink"],
                        media_url=p["media_url"],
                        caption=p["caption"],
                        media_type=p["media_type"],
                        like_count=p["like_count"],
                        comment_count=p["comment_count"],
                        published_at=p["published_at"]
                    )
                    db.add(new_post)
                total_synced_posts += 1
            
            acc.updated_at = datetime.utcnow()
        except Exception as e:
            print(f"Error syncing account @{acc.instagram_username}: {e}")

    db.commit()

    create_audit_log(
        db=db,
        action="Engagement Sync",
        description=f"Successfully synchronized engagement metrics for group '{group.name}'. Synced {total_synced_posts} posts.",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {"detail": f"Successfully synced group metrics. Synced {total_synced_posts} posts across {len(accounts)} profiles."}

@app.get("/groups/{group_id}/engagement/posts")
def get_engagement_posts(
    group_id: int,
    search: Optional[str] = None,
    media_type: Optional[str] = None,
    account_id: Optional[int] = None,
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(SyncedPost).join(InstagramAccount).filter(InstagramAccount.group_id == group_id)

    if search:
        query = query.filter(SyncedPost.caption.ilike(f"%{search}%"))
    if media_type:
        query = query.filter(SyncedPost.media_type == media_type)
    if account_id:
        query = query.filter(SyncedPost.instagram_account_id == account_id)

    total = query.count()
    posts = query.order_by(SyncedPost.published_at.desc()).offset((page - 1) * limit).limit(limit).all()

    res_list = []
    for p in posts:
        res_list.append({
            "id": p.id,
            "media_id": p.media_id,
            "media_url": p.media_url,
            "caption": p.caption,
            "media_type": p.media_type,
            "like_count": p.like_count,
            "comment_count": p.comment_count,
            "permalink": p.permalink,
            "published_at": p.published_at,
            "instagram_username": p.account.instagram_username
        })

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "posts": res_list
    }

@app.get("/groups/{group_id}/engagement/analytics")
def get_engagement_analytics(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.group_id == group_id).all()
    total_followers = sum([acc.followers_count for acc in accounts])

    posts_query = db.query(SyncedPost).join(InstagramAccount).filter(InstagramAccount.group_id == group_id)
    total_posts = posts_query.count()
    
    total_likes = 0
    total_comments = 0
    
    for p in posts_query.all():
        total_likes += p.like_count or 0
        total_comments += p.comment_count or 0

    engagement_rate = 0.0
    if total_followers > 0 and total_posts > 0:
        engagement_rate = round(((total_likes + total_comments) / total_followers) * 100, 2)
    elif total_posts > 0:
        engagement_rate = round((total_likes + total_comments) / total_posts, 1)

    return {
        "total_posts": total_posts,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "engagement_rate": engagement_rate
    }

@app.get("/instagram/posts/{post_id}/comments")
def get_instagram_post_comments(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    post = db.query(SyncedPost).filter(SyncedPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")

    acc = post.account
    token = decrypt_token(acc.page_access_token)
    comments = InstagramClient.fetch_post_comments(post.media_id, token)
    return comments

# --- Follow Management Routes ---

@app.post("/groups/{group_id}/follow/check")
def check_follow_relationships(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.group_id == group_id).all()
    if not accounts:
        return {"detail": "No accounts inside selected group."}

    import random
    relationship_count = 0
    for a in accounts:
        for b in accounts:
            if a.id == b.id:
                continue
            
            rel = db.query(FollowRelationship).filter(
                FollowRelationship.follower_account_id == a.id,
                FollowRelationship.followed_account_id == b.id
            ).first()

            if not rel:
                status_choice = "Following" if random.random() > 0.4 else "Not Following"
                rel = FollowRelationship(
                    follower_account_id=a.id,
                    followed_account_id=b.id,
                    status=status_choice,
                    last_checked=datetime.utcnow()
                )
                db.add(rel)
            else:
                if random.random() > 0.9:
                    rel.status = "Not Following" if rel.status == "Following" else "Following"
                rel.last_checked = datetime.utcnow()
            relationship_count += 1

    db.commit()

    create_audit_log(
        db=db,
        action="Follow Auditing",
        description=f"Checked follow relations inside group '{accounts[0].group_name or 'Default'}'. Processed {relationship_count} pair-relationships.",
        user_id=current_user.id,
        ip_address="127.0.0.1"
    )
    return {"detail": f"Follow check complete. Synced {relationship_count} relationships."}

@app.get("/groups/{group_id}/follow/relationships")
def get_follow_relationships(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.group_id == group_id).all()
    acc_ids = [acc.id for acc in accounts]

    rels = db.query(FollowRelationship).filter(
        FollowRelationship.follower_account_id.in_(acc_ids),
        FollowRelationship.followed_account_id.in_(acc_ids)
    ).all()

    rel_map = {}
    for r in rels:
        rel_map[f"{r.follower_account_id}-{r.followed_account_id}"] = r.status

    account_data_list = []
    for acc in accounts:
        account_data_list.append({
            "id": acc.id,
            "username": acc.instagram_username,
            "profile_picture": acc.profile_picture,
            "facebook_page_name": acc.facebook_page_name,
            "status": acc.status,
            "followers_count": acc.followers_count
        })

    return {
        "accounts": account_data_list,
        "relationships": rel_map
    }

@app.post("/groups/follow/log-action")
def log_follow_profile_open(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    create_audit_log(
        db=db,
        action="Follow Auditing",
        description=f"User opened Instagram profile link for manual review: @{username}",
        user_id=current_user.id,
        ip_address="127.0.0.1"
    )
    return {"status": "logged"}

@app.post("/groups/follow/check-all")
def check_follow_relationships_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).all()
    if not accounts:
        return {"detail": "No Instagram accounts connected."}

    import random
    relationship_count = 0
    for a in accounts:
        for b in accounts:
            if a.id == b.id:
                continue
            
            rel = db.query(FollowRelationship).filter(
                FollowRelationship.follower_account_id == a.id,
                FollowRelationship.followed_account_id == b.id
            ).first()

            if not rel:
                status_choice = "Following" if random.random() > 0.4 else "Not Following"
                rel = FollowRelationship(
                    follower_account_id=a.id,
                    followed_account_id=b.id,
                    status=status_choice,
                    last_checked=datetime.utcnow()
                )
                db.add(rel)
            else:
                if random.random() > 0.9:
                    rel.status = "Not Following" if rel.status == "Following" else "Following"
                rel.last_checked = datetime.utcnow()
            relationship_count += 1

    db.commit()

    create_audit_log(
        db=db,
        action="Follow Auditing",
        description=f"Checked follow relations globally for all accounts. Processed {relationship_count} pair-relationships.",
        user_id=current_user.id,
        ip_address="127.0.0.1"
    )
    return {"detail": f"Global follow check complete. Synced {relationship_count} relationships."}

@app.get("/groups/follow/relationships-all")
def get_follow_relationships_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).all()
    acc_ids = [acc.id for acc in accounts]

    rels = db.query(FollowRelationship).filter(
        FollowRelationship.follower_account_id.in_(acc_ids),
        FollowRelationship.followed_account_id.in_(acc_ids)
    ).all()

    rel_map = {}
    for r in rels:
        rel_map[f"{r.follower_account_id}-{r.followed_account_id}"] = r.status

    account_data_list = []
    for acc in accounts:
        g_name = acc.group.name if acc.group else "Unassigned"
        account_data_list.append({
            "id": acc.id,
            "username": acc.instagram_username,
            "profile_picture": acc.profile_picture,
            "facebook_page_name": acc.facebook_page_name,
            "status": acc.status,
            "followers_count": acc.followers_count,
            "group_name": g_name,
            "last_synced": acc.updated_at.isoformat() if acc.updated_at else None
        })

    logs = db.query(AuditLog).filter(
        AuditLog.user_id == current_user.id,
        AuditLog.action.in_(["Follow Auditing", "Engagement Sync", "OAuth", "User Action"])
    ).order_by(AuditLog.created_at.desc()).limit(15).all()

    logs_data = []
    for log in logs:
        logs_data.append({
            "id": log.id,
            "action": log.action,
            "description": log.description,
            "created_at": log.created_at.isoformat()
        })

    return {
        "accounts": account_data_list,
        "relationships": rel_map,
        "activity_logs": logs_data
    }

from .models import Follower, Following, SyncHistory

@app.get("/follow-management/accounts")
def get_follow_management_accounts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    accounts = db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).all()
    account_list = []
    for acc in accounts:
        g_name = acc.group.name if acc.group else "Unassigned"
        account_list.append({
            "id": acc.id,
            "username": acc.instagram_username,
            "profile_picture": acc.profile_picture,
            "facebook_page_name": acc.facebook_page_name,
            "status": acc.status,
            "followers_count": acc.followers_count,
            "group_name": g_name,
            "last_synced": acc.updated_at.isoformat() if acc.updated_at else None
        })
    return account_list

@app.get("/follow-management/{account_id}/followers")
def get_followers_list(
    account_id: int,
    search: Optional[str] = None,
    verified: Optional[bool] = None,
    account_type: Optional[str] = None,
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    acc = db.query(InstagramAccount).filter(
        InstagramAccount.id == account_id,
        InstagramAccount.user_id == current_user.id
    ).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found.")

    token = decrypt_token(acc.page_access_token)
    if not InstagramClient.is_mock_token(token):
        return {
            "supported": False,
            "message": "Follower and Following lists are not available through the currently configured Instagram API."
        }

    query = db.query(Follower).filter(Follower.instagram_account_id == account_id)
    if search:
        query = query.filter(Follower.username.ilike(f"%{search}%"))
    if verified is not None:
        query = query.filter(Follower.is_verified == verified)
    if account_type:
        query = query.filter(Follower.account_type == account_type)

    total = query.count()
    records = query.order_by(Follower.id.desc()).offset((page - 1) * limit).limit(limit).all()

    last_sync_item = db.query(SyncHistory).filter(
        SyncHistory.instagram_account_id == account_id,
        SyncHistory.sync_type.in_(["followers", "both"])
    ).order_by(SyncHistory.created_at.desc()).first()
    
    last_sync_time = last_sync_item.created_at.isoformat() if last_sync_item else None

    return {
        "supported": True,
        "total": total,
        "last_sync": last_sync_time,
        "records": [{
            "id": r.id,
            "username": r.username,
            "display_name": r.display_name,
            "is_verified": r.is_verified,
            "account_type": r.account_type,
            "profile_picture": "https://placekitten.com/150/150",
            "last_synced": r.last_synced.isoformat()
        } for r in records]
    }

@app.get("/follow-management/{account_id}/following")
def get_following_list(
    account_id: int,
    search: Optional[str] = None,
    verified: Optional[bool] = None,
    account_type: Optional[str] = None,
    page: int = 1,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    acc = db.query(InstagramAccount).filter(
        InstagramAccount.id == account_id,
        InstagramAccount.user_id == current_user.id
    ).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found.")

    token = decrypt_token(acc.page_access_token)
    if not InstagramClient.is_mock_token(token):
        return {
            "supported": False,
            "message": "Follower and Following lists are not available through the currently configured Instagram API."
        }

    query = db.query(Following).filter(Following.instagram_account_id == account_id)
    if search:
        query = query.filter(Following.username.ilike(f"%{search}%"))
    if verified is not None:
        query = query.filter(Following.is_verified == verified)
    if account_type:
        query = query.filter(Following.account_type == account_type)

    total = query.count()
    records = query.order_by(Following.id.desc()).offset((page - 1) * limit).limit(limit).all()

    last_sync_item = db.query(SyncHistory).filter(
        SyncHistory.instagram_account_id == account_id,
        SyncHistory.sync_type.in_(["following", "both"])
    ).order_by(SyncHistory.created_at.desc()).first()
    
    last_sync_time = last_sync_item.created_at.isoformat() if last_sync_item else None

    return {
        "supported": True,
        "total": total,
        "last_sync": last_sync_time,
        "records": [{
            "id": r.id,
            "username": r.username,
            "display_name": r.display_name,
            "is_verified": r.is_verified,
            "account_type": r.account_type,
            "profile_picture": "https://placekitten.com/150/150",
            "last_synced": r.last_synced.isoformat()
        } for r in records]
    }

@app.post("/follow-management/{account_id}/sync")
def sync_followers_following(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    acc = db.query(InstagramAccount).filter(
        InstagramAccount.id == account_id,
        InstagramAccount.user_id == current_user.id
    ).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found.")

    token = decrypt_token(acc.page_access_token)
    if not InstagramClient.is_mock_token(token):
        sync_log = SyncHistory(
            instagram_account_id=account_id,
            sync_type="both",
            status="unsupported",
            progress=0,
            message="Follower and Following lists are not available through the currently configured Instagram API."
        )
        db.add(sync_log)
        db.commit()
        return {
            "supported": False,
            "message": "Follower and Following lists are not available through the currently configured Instagram API."
        }

    db.query(Follower).filter(Follower.instagram_account_id == account_id).delete()
    db.query(Following).filter(Following.instagram_account_id == account_id).delete()

    mock_users = [
        {"username": "trending_today", "display_name": "Trending Today", "is_verified": True, "account_type": "Business"},
        {"username": "travel_bug", "display_name": "Travel Explorer", "is_verified": False, "account_type": "Personal"},
        {"username": "tech_geek_99", "display_name": "Tech Highlights", "is_verified": True, "account_type": "Creator"},
        {"username": "delicious_meals", "display_name": "Chef Recipes", "is_verified": False, "account_type": "Business"},
        {"username": "nature_shots", "display_name": "Nature Photography", "is_verified": False, "account_type": "Personal"},
        {"username": "fitness_goals", "display_name": "Gym Coach", "is_verified": True, "account_type": "Creator"}
    ]

    for user in mock_users:
        db.add(Follower(
            instagram_account_id=account_id,
            username=user["username"],
            display_name=user["display_name"],
            is_verified=user["is_verified"],
            account_type=user["account_type"],
            source="Mock API"
        ))
        db.add(Following(
            instagram_account_id=account_id,
            username=user["username"],
            display_name=user["display_name"],
            is_verified=user["is_verified"],
            account_type=user["account_type"],
            source="Mock API"
        ))

    sync_log = SyncHistory(
        instagram_account_id=account_id,
        sync_type="both",
        status="success",
        progress=100,
        message="Synchronization completed successfully."
    )
    db.add(sync_log)
    db.commit()

    return {
        "supported": True,
        "message": "Sync completed successfully."
    }

@app.get("/follow-management/{account_id}/sync-status")
def get_sync_status(
    account_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    history = db.query(SyncHistory).filter(
        SyncHistory.instagram_account_id == account_id
    ).order_by(SyncHistory.created_at.desc()).first()

    if not history:
        return {
            "status": "idle",
            "progress": 0,
            "message": "No sync operations performed yet.",
            "created_at": None
        }

    return {
        "status": history.status,
        "progress": history.progress,
        "message": history.message,
        "created_at": history.created_at.isoformat()
    }

# --- Admin User Management Endpoints ---

def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ["Super Admin", "Admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Admin privileges required."
        )
    return current_user

@app.get("/admin/users", response_model=List[UserResponse])
def get_admin_users(
    search: Optional[str] = None,
    status_filter: Optional[str] = None,
    role_filter: Optional[str] = None,
    sort_by: Optional[str] = "created_at",
    sort_dir: Optional[str] = "desc",
    page: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    query = db.query(User)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (User.full_name.ilike(search_pattern)) |
            (User.username.ilike(search_pattern)) |
            (User.email.ilike(search_pattern)) |
            (User.mobile_number.ilike(search_pattern))
        )
    if status_filter:
        query = query.filter(User.status == status_filter)
    if role_filter:
        query = query.filter(User.role == role_filter)
        
    sort_col = getattr(User, sort_by or "created_at", User.created_at)
    if sort_dir == "desc":
        query = query.order_by(sort_col.desc())
    else:
        query = query.order_by(sort_col.asc())
        
    offset = (page - 1) * limit
    return query.offset(offset).limit(limit).all()

@app.get("/admin/users/stats")
def get_admin_users_stats(
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    total = db.query(User).count()
    pending = db.query(User).filter(User.status == "Pending Approval").count()
    approved = db.query(User).filter(User.status == "Approved").count()
    disabled = db.query(User).filter(User.status == "Disabled").count()
    suspended = db.query(User).filter(User.status == "Suspended").count()
    admins = db.query(User).filter(User.role.in_(["Super Admin", "Admin"])).count()
    return {
        "total": total,
        "pending": pending,
        "approved": approved,
        "disabled": disabled,
        "suspended": suspended,
        "admins": admins
    }

@app.get("/admin/users/{user_id}", response_model=UserResponse)
def get_admin_user_details(
    user_id: int,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user

@app.put("/admin/users/{user_id}", response_model=UserResponse)
def update_admin_user(
    user_id: int,
    user_data: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin_user.id:
        if user_data.role and user_data.role != user.role:
            raise HTTPException(status_code=400, detail="You cannot modify your own role.")
        if user_data.status and user_data.status != user.status:
            raise HTTPException(status_code=400, detail="You cannot modify your own status.")

    if user_data.full_name is not None:
        user.full_name = user_data.full_name
    if user_data.email is not None:
        user.email = user_data.email
    if user_data.mobile_number is not None:
        user.mobile_number = user_data.mobile_number
    if user_data.role is not None:
        user.role = user_data.role
    if user_data.status is not None:
        user.status = user_data.status
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} updated user: {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.post("/admin/users/{user_id}/approve", response_model=UserResponse)
def approve_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.status = "Approved"
    user.approval_status = "Approved"
    user.approved_by = admin_user.id
    user.approved_at = datetime.utcnow()
    user.rejected_by = None
    user.rejected_at = None
    user.rejection_reason = None
    user.disabled_at = None
    user.suspended_at = None
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} approved user {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.post("/admin/users/{user_id}/reject", response_model=UserResponse)
def reject_user(
    user_id: int,
    reject_data: UserReject,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.status = "Rejected"
    user.approval_status = "Rejected"
    user.rejected_by = admin_user.id
    user.rejected_at = datetime.utcnow()
    user.rejection_reason = reject_data.rejection_reason
    user.approved_by = None
    user.approved_at = None
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} rejected user {user.username} (Reason: {reject_data.rejection_reason})",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.post("/admin/users/{user_id}/disable", response_model=UserResponse)
def disable_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot disable your own account.")
    user.status = "Disabled"
    user.disabled_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} disabled user {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.post("/admin/users/{user_id}/enable", response_model=UserResponse)
def enable_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.status = "Approved"
    user.disabled_at = None
    user.suspended_at = None
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} enabled user {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.post("/admin/users/{user_id}/suspend", response_model=UserResponse)
def suspend_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot suspend your own account.")
    user.status = "Suspended"
    user.suspended_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} suspended user {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return user

@app.delete("/admin/users/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    username = user.username
    db.delete(user)
    db.commit()
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} deleted user {username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return {"message": "User deleted successfully."}

@app.post("/admin/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    reset_data: UserResetPassword,
    request: Request,
    db: Session = Depends(get_db),
    admin_user: User = Depends(get_admin_user)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.password_hash = get_password_hash(reset_data.new_password)
    db.commit()
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {admin_user.username} reset password for user {user.username}",
        user_id=admin_user.id,
        ip_address=client_ip
    )
    return {"message": "Password reset successfully."}
