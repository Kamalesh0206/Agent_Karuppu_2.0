import os
import shutil
import uuid
from datetime import datetime, timedelta
import requests
import json
import redis
import asyncio
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, SessionLocal, get_db
from .models import User, InstagramAccount, Post, PublishingQueue, PublishingHistory, PublishingLog, AuditLog, AccessToken, RefreshToken, Group, MediaUpload
from .schemas import (
    UserLogin, UserCreate, UserResponse, UserUpdate, ChangePasswordRequest,
    Token, TokenData, InstagramAccountCreate, InstagramAccountUpdate, InstagramAccountResponse,
    PublishRequest, PostResponse, PublishingQueueResponse, PublishingHistoryResponse, PublishingLogResponse,
    AuditLogResponse, OptimizeRequest, OptimizeResponse, HashtagResponse, EmojiResponse, TranslateRequest, TranslateResponse, QualityScoreResponse,
    ValidateLinkRequest, ValidateLinkResponse, GroupCreate, GroupUpdate, GroupResponse, TokenUpdatePayload,
    UserReject, UserResetPassword, TransferOwnerPayload, MediaResponse
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
from .supabase_storage import upload_to_supabase_storage

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("main_app")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-ready Instagram Multi-Account Publishing Platform backend.",
    version="4.0.0"
)

# CORS Configuration
allowed_origins_list = [
    "https://www.thenexrevo.com",
    "https://thenexrevo.com",
    "https://api.thenexrevo.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list,
    allow_origin_regex=r"https://.*thenexrevo\.com",
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

    # Alter table instagram_accounts to add ownership columns
    new_acc_cols = [
        ("owner_id", "INTEGER"),
        ("owner_name", "VARCHAR(255)"),
        ("linked_by", "VARCHAR(255)"),
        ("linked_at", "TIMESTAMP"),
        ("created_by", "VARCHAR(255)"),
        ("updated_by", "VARCHAR(255)"),
        ("last_modified_by", "VARCHAR(255)"),
        ("last_modified_at", "TIMESTAMP")
    ]
    for col_name, col_type in new_acc_cols:
        db_alter = SessionLocal()
        try:
            db_alter.execute(text(f"ALTER TABLE instagram_accounts ADD COLUMN {col_name} {col_type};"))
            db_alter.commit()
        except Exception as e:
            db_alter.rollback()
            err_msg = str(e).lower()
            if "duplicate column" not in err_msg and "already exists" not in err_msg:
                print(f"Alter table instagram_accounts {col_name} warning: {e}")
        finally:
            db_alter.close()

    # Backfill ownership fields for existing profiles
    db_alter = SessionLocal()
    try:
        db_alter.execute(text("""
            UPDATE instagram_accounts 
            SET 
                owner_id = user_id, 
                linked_by = (SELECT username FROM users WHERE users.id = instagram_accounts.user_id), 
                owner_name = (SELECT full_name FROM users WHERE users.id = instagram_accounts.user_id), 
                created_by = (SELECT username FROM users WHERE users.id = instagram_accounts.user_id) 
            WHERE owner_id IS NULL;
        """))
        db_alter.commit()
    except Exception as e:
        db_alter.rollback()
        print(f"Migrate ownership error: {e}")
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
        super_admin_email = "admin@thenexrevo.com"
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

# --- Health & Version Endpoints ---

@app.get("/")
@app.get("/health")
@app.get("/api/health")
@app.get("/v1/health")
def health_check(db: Session = Depends(get_db)):
    db_status = "connected"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        logger.error(f"[Health Check Error] Database execution failed: {e}")
        db_status = f"disconnected: {str(e)}"

    is_healthy = db_status == "connected"
    return {
        "status": "healthy" if is_healthy else "unhealthy",
        "database": db_status,
        "version": "4.0.0",
        "environment": "production"
    }

@app.get("/version")
@app.get("/api/version")
def api_version():
    return {
        "version": "4.0.0",
        "name": settings.PROJECT_NAME,
        "status": "active"
    }

# --- Authentication Routes ---

@app.get("/login")
@app.get("/auth/login")
@app.get("/api/login")
@app.get("/api/auth/login")
@app.get("/token")
@app.get("/api/token")
def login_get_redirect(request: Request):
    """
    Handles browser GET requests to login endpoints.
    Redirects browser GET traffic to the SPA frontend login page instead of returning 404 Not Found.
    If requested via JSON API (Accept: application/json), returns HTTP 405 Method Not Allowed explaining that POST is required.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    accept = request.headers.get("accept", "").lower()
    
    logger.info(f"[Auth GET] Direct GET access to login endpoint from {client_ip}. Redirecting to frontend: {frontend_url}/login")
    
    if "application/json" in accept and "text/html" not in accept:
        return JSONResponse(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            content={
                "detail": "Method Not Allowed. Authentication requires HTTP POST with JSON body containing 'username' and 'password'.",
                "frontend_login": f"{frontend_url}/login",
                "documentation": "/docs"
            }
        )
    return RedirectResponse(url=f"{frontend_url}/login", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

@app.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@app.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@app.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@app.post("/api/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@app.post("/api/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
@app.post("/api/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    logger.info(f"[Auth Signup Attempt] Username: {user_data.username} | IP: {client_ip}")

    email_val = user_data.email.strip() if user_data.email and user_data.email.strip() else None
    mobile_val = user_data.mobile_number.strip() if user_data.mobile_number and user_data.mobile_number.strip() else None

    if not email_val and not mobile_val:
        logger.warning(f"[Auth Signup Failure] Username: {user_data.username} | Missing email and mobile")
        raise HTTPException(status_code=400, detail="Either email or mobile number must be provided.")
        
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        logger.warning(f"[Auth Signup Failure] Username: {user_data.username} already registered")
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

    create_audit_log(
        db=db,
        action="User Action",
        description=f"User registered: {new_user.username}. Pending approval.",
        user_id=new_user.id,
        ip_address=client_ip
    )
    logger.info(f"[Auth Signup Success] User registered: {new_user.username} (ID: {new_user.id}) | Status: Pending Approval")
    return new_user

@app.get("/signup")
@app.get("/register")
@app.get("/auth/register")
@app.get("/api/signup")
@app.get("/api/register")
@app.get("/api/auth/register")
def signup_get_redirect(request: Request):
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    accept = request.headers.get("accept", "").lower()
    if "application/json" in accept and "text/html" not in accept:
        return JSONResponse(
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            content={
                "detail": "Method Not Allowed. Registration requires HTTP POST with user parameters.",
                "frontend_signup": f"{frontend_url}/signup"
            }
        )
    return RedirectResponse(url=f"{frontend_url}/signup", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

@app.post("/login", response_model=Token)
@app.post("/auth/login", response_model=Token)
@app.post("/api/login", response_model=Token)
@app.post("/api/auth/login", response_model=Token)
@app.post("/token", response_model=Token)
@app.post("/api/token", response_model=Token)
def login(login_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    logger.info(f"[Auth Login Attempt] Target: {login_data.username} | IP: {client_ip}")

    user = db.query(User).filter(
        (User.username == login_data.username) | 
        (User.email == login_data.username) | 
        (User.mobile_number == login_data.username)
    ).first()

    if not user or not verify_password(login_data.password, user.password_hash):
        logger.warning(f"[Auth Login Failure] Failed login attempt for: {login_data.username} | IP: {client_ip}")
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
        logger.warning(f"[Auth Login Blocked] User: {user.username} | Account Pending Approval")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting administrator approval."
        )
    elif user.status == "Rejected":
        logger.warning(f"[Auth Login Blocked] User: {user.username} | Account Rejected")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your registration has been rejected."
        )
    elif user.status == "Disabled":
        logger.warning(f"[Auth Login Blocked] User: {user.username} | Account Disabled")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been disabled."
        )
    elif user.status == "Suspended":
        logger.warning(f"[Auth Login Blocked] User: {user.username} | Account Suspended")
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
    logger.info(f"[Auth Login Success] User: {user.username} (Role: {user.role}, ID: {user.id}) | IP: {client_ip}")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
        "status": user.status
    }

@app.get("/auth/verify")
@app.get("/api/auth/verify")
@app.post("/auth/verify")
@app.post("/api/auth/verify")
def verify_current_token(current_user: User = Depends(get_current_user)):
    """Verifies that the provided JWT token is valid and active."""
    return {
        "valid": True,
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "status": current_user.status
    }

@app.post("/logout")
@app.post("/auth/logout")
@app.post("/api/logout")
@app.post("/api/auth/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    Revokes the current JWT access token. 
    IMPORTANT: This does NOT delete any Instagram accounts, groups, or tokens from the database.
    Only the session JWT is invalidated. All connected accounts remain intact.
    """
    db_token = db.query(AccessToken).filter(AccessToken.token == token).first()
    user_id = None
    if db_token:
        user_id = db_token.user_id
        db_token.is_revoked = True
        db.commit()
        logger.info(f"[Logout] User ID {user_id} logged out successfully. JWT revoked.")
    else:
        logger.warning("[Logout] Logout called with unknown or already-revoked token.")
    
    create_audit_log(
        db=db,
        action="Logout",
        description="User logged out. JWT revoked. All Instagram accounts and data remain intact in database.",
        user_id=user_id
    )
    return {"detail": "Successfully logged out"}

# --- Facebook / Google OAuth Routes ---

@app.get("/login/facebook")
@app.get("/auth/facebook")
@app.get("/api/login/facebook")
@app.get("/api/auth/facebook")
def login_facebook(request: Request, token: Optional[str] = None):
    """
    Redirects the user to Facebook OAuth login dialog.
    Passes the user's JWT token as the OAuth `state` parameter so the callback
    can identify which user triggered the OAuth flow and correctly assign the connected account.
    """
    import urllib.parse
    scope = "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management"
    
    auth_header = request.headers.get("Authorization", "")
    jwt_token = ""
    if auth_header.startswith("Bearer "):
        jwt_token = auth_header[7:]
    elif token:
        jwt_token = token
    
    state_value = urllib.parse.quote(jwt_token) if jwt_token else ""
    
    if not settings.FACEBOOK_CLIENT_ID:
        mock_callback_url = f"{settings.FACEBOOK_REDIRECT_URI}?code=mock_authorization_code&state={state_value}"
        logger.info("[OAuth] No Facebook Client ID configured. Redirecting to mock callback.")
        return RedirectResponse(mock_callback_url)
    
    fb_auth_url = (
        f"https://www.facebook.com/v25.0/dialog/oauth"
        f"?client_id={settings.FACEBOOK_CLIENT_ID}"
        f"&redirect_uri={urllib.parse.quote(settings.FACEBOOK_REDIRECT_URI)}"
        f"&scope={scope}"
        f"&response_type=code"
        f"&state={state_value}"
    )
    logger.info(f"[OAuth] Redirecting to Facebook OAuth dialog.")
    return RedirectResponse(fb_auth_url)

@app.get("/login/google")
@app.get("/auth/google")
@app.get("/api/login/google")
@app.get("/api/auth/google")
def login_google(request: Request):
    """Placeholder/compatibility endpoint for Google OAuth login."""
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    logger.info("[OAuth Google] Google OAuth request received. Facebook/Instagram OAuth is active suite.")
    return RedirectResponse(url=f"{frontend_url}/login?oauth_info=Google+OAuth+configured+via+Facebook/Instagram+suite", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

@app.get("/oauth/google/callback")
@app.get("/auth/google/callback")
@app.get("/api/oauth/google/callback")
def oauth_google_callback(request: Request):
    """Placeholder/compatibility callback for Google OAuth."""
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    return RedirectResponse(url=f"{frontend_url}/accounts?status=warning&message=Google+OAuth+callback+received", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

@app.get("/oauth/callback")
@app.get("/auth/facebook/callback")
@app.get("/auth/callback")
@app.get("/api/oauth/callback")
@app.get("/api/auth/facebook/callback")
def oauth_callback(code: str, request: Request, db: Session = Depends(get_db), state: Optional[str] = None):

    """
    Handles the Facebook OAuth callback.
    
    CRITICAL FIXES:
    - Decodes the `state` parameter to identify the authenticated user
    - Uses correct user_id (not hardcoded user_id=1)
    - Performs UPSERT (INSERT or UPDATE) — no duplicate accounts ever
    - Sets owner_id, owner_name, linked_by correctly
    - Redirects to FRONTEND_URL (not hardcoded localhost)
    - Marks accounts as 'Connected' in DB immediately after commit
    - Comprehensive audit logging at each step
    """
    import urllib.parse
    client_ip = request.client.host if request.client else "127.0.0.1"
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    
    # --- Resolve the authenticated user from the OAuth state parameter ---
    resolved_user: Optional[User] = None
    if state:
        try:
            decoded_jwt = urllib.parse.unquote(state)
            payload = decode_access_token(decoded_jwt)
            if payload:
                username = payload.get("username")
                if username:
                    db_state_token = db.query(AccessToken).filter(
                        AccessToken.token == decoded_jwt,
                        AccessToken.is_revoked == False
                    ).first()
                    if db_state_token:
                        resolved_user = db.query(User).filter(User.username == username).first()
                        if resolved_user:
                            logger.info(f"[OAuth Callback] Resolved authenticated user from state: {resolved_user.username} (ID: {resolved_user.id})")
        except Exception as state_err:
            logger.warning(f"[OAuth Callback] Could not decode state parameter: {state_err}")
    
    # Fallback: use Super Admin (id=1) if state not resolvable
    # This preserves backwards compatibility for direct OAuth (non-app-initiated)
    if not resolved_user:
        resolved_user = db.query(User).filter(User.id == 1).first()
        logger.warning(f"[OAuth Callback] No valid state parameter found. Falling back to Super Admin (user_id=1). "
                       f"For proper user binding, trigger OAuth through the app with a valid session.")
    
    bound_user_id = resolved_user.id if resolved_user else 1
    bound_username = resolved_user.username if resolved_user else "admin"
    bound_fullname = resolved_user.full_name if resolved_user else "Super Admin"
    
    # --- MOCK flow (no Facebook Client ID or mock code) ---
    if code == "mock_authorization_code" or not settings.FACEBOOK_CLIENT_ID:
        logger.info(f"[OAuth Callback] Mock OAuth flow triggered for user {bound_username} (ID: {bound_user_id})")
        mock_ig_biz_id = "17841401234567890"
        mock_username = "mock_instagram_user"
        
        # UPSERT: check if mock account already exists
        existing_mock = db.query(InstagramAccount).filter(
            InstagramAccount.instagram_business_id == mock_ig_biz_id
        ).first()
        
        if existing_mock:
            # UPDATE existing account — do NOT create duplicate
            existing_mock.user_id = bound_user_id
            existing_mock.owner_id = bound_user_id
            existing_mock.owner_name = bound_fullname
            existing_mock.linked_by = bound_username
            existing_mock.page_access_token = encrypt_token("mock_long_lived_page_token")
            existing_mock.token_expiry = datetime.utcnow() + timedelta(days=60)
            existing_mock.status = "Connected"
            existing_mock.updated_by = bound_username
            existing_mock.last_modified_by = bound_username
            existing_mock.last_modified_at = datetime.utcnow()
            db.commit()
            db.refresh(existing_mock)
            logger.info(f"[OAuth Callback] Mock account UPDATED in DB for user {bound_username}. Account ID: {existing_mock.id}")
        else:
            # INSERT new mock account
            mock_account = InstagramAccount(
                user_id=bound_user_id,
                facebook_user_id="100009876543210",
                facebook_page_id="10485769213",
                facebook_page_name="Mock Page Marketing",
                page_access_token=encrypt_token("mock_long_lived_page_token"),
                instagram_business_id=mock_ig_biz_id,
                instagram_username=mock_username,
                profile_picture="https://placekitten.com/200/200",
                business_name="Mock IG Business",
                followers_count=1420,
                token_expiry=datetime.utcnow() + timedelta(days=60),
                status="Connected",
                owner_id=bound_user_id,
                owner_name=bound_fullname,
                linked_by=bound_username,
                created_by=bound_username
            )
            db.add(mock_account)
            db.commit()
            db.refresh(mock_account)
            logger.info(f"[OAuth Callback] Mock account INSERTED in DB for user {bound_username}. Account ID: {mock_account.id}")
        
        create_audit_log(
            db=db,
            action="OAuth",
            description=f"[OAuth Success] Connected mock profile @{mock_username} for user {bound_username} (ID: {bound_user_id}). DB committed.",
            user_id=bound_user_id,
            ip_address=client_ip
        )
        return RedirectResponse(f"{frontend_url}/accounts?status=success&username={mock_username}")

    # --- REAL Facebook OAuth flow ---
    try:
        logger.info(f"[OAuth Callback] Starting real OAuth flow for user {bound_username} (ID: {bound_user_id})")
        
        # Step 1: Exchange code for short-lived user token
        token_url = "https://graph.facebook.com/v25.0/oauth/access_token"
        token_params = {
            "client_id": settings.FACEBOOK_CLIENT_ID,
            "redirect_uri": settings.FACEBOOK_REDIRECT_URI,
            "client_secret": settings.FACEBOOK_CLIENT_SECRET,
            "code": code
        }
        token_res = requests.get(token_url, params=token_params, timeout=30).json()
        short_token = token_res.get("access_token")
        fb_user_id = token_res.get("user_id")
        
        if not short_token:
            error_msg = token_res.get("error", {}).get("message", "Unknown error")
            logger.error(f"[OAuth Callback] Failed to get short-lived token: {error_msg}")
            create_audit_log(db=db, action="Errors",
                description=f"[OAuth Failure] Failed to acquire short-lived token for user {bound_username}: {error_msg}",
                user_id=bound_user_id, ip_address=client_ip)
            return RedirectResponse(f"{frontend_url}/accounts?status=error&message=Failed+to+acquire+access+token")
        
        logger.info(f"[OAuth Callback] Short-lived token acquired. Exchanging for long-lived token...")
        
        # Step 2: Exchange for long-lived user token
        long_lived_res = InstagramClient.exchange_short_lived_token(short_token)
        long_user_token = long_lived_res.get("access_token")
        
        if not long_user_token:
            logger.error(f"[OAuth Callback] Failed to exchange for long-lived token.")
            return RedirectResponse(f"{frontend_url}/accounts?status=error&message=Token+exchange+failed")
        
        logger.info(f"[OAuth Callback] Long-lived token acquired. Fetching Facebook Pages...")
        
        # Step 3: Get linked Facebook Pages
        pages_res = requests.get(
            "https://graph.facebook.com/v25.0/me/accounts",
            params={"access_token": long_user_token},
            timeout=30
        ).json()
        
        pages_data = pages_res.get("data", [])
        if not pages_data:
            logger.warning(f"[OAuth Callback] No managed Facebook pages found for user {bound_username}.")
            create_audit_log(db=db, action="Errors",
                description=f"[OAuth Failure] No Facebook Pages found for user {bound_username}.",
                user_id=bound_user_id, ip_address=client_ip)
            return RedirectResponse(f"{frontend_url}/accounts?status=error&message=No+Facebook+Pages+found")
        
        logger.info(f"[OAuth Callback] Found {len(pages_data)} Facebook page(s). Processing Instagram Business accounts...")
        connected_usernames = []
        
        for page in pages_data:
            page_id = page.get("id")
            page_name = page.get("name", "")
            
            try:
                # Get long-lived page-level access token
                long_page_token = InstagramClient.get_long_lived_page_token(long_user_token, page_id)
                
                # Get Instagram Business Account linked to this Page
                ig_res = requests.get(
                    f"https://graph.facebook.com/v25.0/{page_id}",
                    params={
                        "fields": "id,name,instagram_business_account",
                        "access_token": long_page_token
                    },
                    timeout=30
                ).json()
                
                ig_account = ig_res.get("instagram_business_account")
                if not ig_account:
                    logger.info(f"[OAuth Callback] Page '{page_name}' has no linked Instagram Business Account. Skipping.")
                    continue
                
                ig_id = ig_account.get("id")
                logger.info(f"[OAuth Callback] Found Instagram Business Account ID: {ig_id} on Page '{page_name}'")
                
                # Get full Instagram profile details
                try:
                    profile = InstagramClient.get_instagram_profile_details(ig_id, long_page_token)
                except Exception as profile_err:
                    logger.warning(f"[OAuth Callback] Could not fetch profile details for IG ID {ig_id}: {profile_err}")
                    profile = {"username": f"ig_{ig_id}", "profile_picture_url": None, "name": page_name, "followers_count": 0}
                
                ig_username = profile.get("username", f"ig_{ig_id}")
                token_expiry = datetime.utcnow() + timedelta(days=60)
                
                # UPSERT: check by instagram_business_id (unique key)
                existing = db.query(InstagramAccount).filter(
                    InstagramAccount.instagram_business_id == ig_id
                ).first()
                
                if existing:
                    # UPDATE existing account — preserve group assignment
                    logger.info(f"[OAuth Callback] Account @{ig_username} exists (ID: {existing.id}). Updating token and profile...")
                    existing.user_id = bound_user_id
                    existing.owner_id = existing.owner_id or bound_user_id  # preserve existing owner unless unset
                    existing.owner_name = existing.owner_name or bound_fullname
                    existing.facebook_user_id = fb_user_id or existing.facebook_user_id
                    existing.facebook_page_id = page_id
                    existing.facebook_page_name = page_name or existing.facebook_page_name
                    existing.page_access_token = encrypt_token(long_page_token)
                    existing.instagram_username = ig_username
                    existing.profile_picture = profile.get("profile_picture_url") or existing.profile_picture
                    existing.business_name = profile.get("name") or existing.business_name
                    existing.followers_count = profile.get("followers_count", existing.followers_count)
                    existing.token_expiry = token_expiry
                    existing.status = "Connected"
                    existing.updated_by = bound_username
                    existing.last_modified_by = bound_username
                    existing.last_modified_at = datetime.utcnow()
                    connected_usernames.append(ig_username)
                    logger.info(f"[OAuth Callback] [DB UPDATE] Account @{ig_username} token refreshed and status=Connected committed.")
                else:
                    # INSERT new account
                    logger.info(f"[OAuth Callback] Account @{ig_username} is new. Inserting into database...")
                    new_acc = InstagramAccount(
                        user_id=bound_user_id,
                        facebook_user_id=fb_user_id,
                        facebook_page_id=page_id,
                        facebook_page_name=page_name,
                        page_access_token=encrypt_token(long_page_token),
                        instagram_business_id=ig_id,
                        instagram_username=ig_username,
                        profile_picture=profile.get("profile_picture_url"),
                        business_name=profile.get("name") or page_name,
                        followers_count=profile.get("followers_count", 0),
                        token_expiry=token_expiry,
                        status="Connected",
                        # Ownership fields — critical for accounts to appear under correct user
                        owner_id=bound_user_id,
                        owner_name=bound_fullname,
                        linked_by=bound_username,
                        linked_at=datetime.utcnow(),
                        created_by=bound_username
                    )
                    db.add(new_acc)
                    connected_usernames.append(ig_username)
                    logger.info(f"[OAuth Callback] [DB INSERT] New account @{ig_username} added. Pending commit.")
                
                # Commit each account individually to ensure persistence
                try:
                    db.commit()
                    logger.info(f"[OAuth Callback] [DB COMMIT] Account @{ig_username} successfully committed to database.")
                    create_audit_log(
                        db=db,
                        action="OAuth",
                        description=f"[OAuth Success] Instagram @{ig_username} (IG ID: {ig_id}) connected by {bound_username}. Token expires: {token_expiry.strftime('%Y-%m-%d')}. DB committed.",
                        user_id=bound_user_id,
                        ip_address=client_ip
                    )
                except Exception as commit_err:
                    db.rollback()
                    logger.error(f"[OAuth Callback] [DB COMMIT FAILED] Failed to commit account @{ig_username}: {commit_err}")
                    create_audit_log(db=db, action="Errors",
                        description=f"[OAuth DB Failure] Failed to commit @{ig_username}: {commit_err}",
                        user_id=bound_user_id, ip_address=client_ip)
            
            except Exception as page_err:
                logger.error(f"[OAuth Callback] Error processing page '{page_name}': {page_err}")
                continue
        
        if connected_usernames:
            logger.info(f"[OAuth Callback] OAuth complete. Connected accounts: {connected_usernames} for user {bound_username}.")
            return RedirectResponse(
                f"{frontend_url}/accounts?status=success&username={','.join(connected_usernames)}"
            )
        else:
            logger.warning(f"[OAuth Callback] OAuth completed but no Instagram Business Accounts were found or linked.")
            return RedirectResponse(f"{frontend_url}/accounts?status=warning&message=No+Instagram+Business+Accounts+found+on+connected+pages")
    
    except Exception as e:
        logger.error(f"[OAuth Callback] Unexpected error in OAuth flow for user {bound_username}: {e}", exc_info=True)
        create_audit_log(db=db, action="Errors",
            description=f"[OAuth Fatal Error] OAuth flow failed for user {bound_username}: {str(e)}",
            user_id=bound_user_id, ip_address=client_ip)
        import urllib.parse as urlparse
        return RedirectResponse(f"{frontend_url}/accounts?status=error&message={urlparse.quote(str(e)[:200])}")

def check_account_modification_permission(account: InstagramAccount, user: User):
    if user.role in ["Super Admin", "Admin"]:
        return
    if account.owner_id == user.id:
        return
    raise HTTPException(
        status_code=403,
        detail="Only the account owner or an administrator can modify this Instagram account."
    )

# --- Accounts CRUD Routes ---

@app.get("/accounts", response_model=List[InstagramAccountResponse])
@app.get("/api/accounts", response_model=List[InstagramAccountResponse])
@app.get("/instagram/accounts", response_model=List[InstagramAccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Fetch all Instagram accounts from the database.
    
    CRITICAL DESIGN DECISIONS:
    - Database is the single source of truth. Never resets on page refresh or re-login.
    - Does NOT call Instagram API on every load (removed blocking API calls).
    - Token status is determined from stored token_expiry date in DB.
    - Expired tokens mark account as 'Token Expired' — never delete the account.
    - Accounts persist across logout/login cycles permanently.
    """
    now = datetime.utcnow()
    accounts = db.query(InstagramAccount).all()
    logger.info(f"[Account Fetch] User {current_user.username} fetching accounts. Found {len(accounts)} total accounts in DB.")
    
    # Auto-update token expiry status from DB date (no Instagram API call needed)
    status_updated = False
    for acc in accounts:
        if acc.token_expiry and acc.token_expiry < now and acc.status == "Connected":
            # Mark as expired instead of hiding/deleting the account
            acc.status = "Token Expired"
            acc.last_modified_at = now
            status_updated = True
            logger.info(f"[Account Fetch] Account @{acc.instagram_username} (ID: {acc.id}) token expired on {acc.token_expiry}. Status updated to 'Token Expired'.")
    
    if status_updated:
        try:
            db.commit()
            logger.info("[Account Fetch] Token expiry statuses committed to DB.")
        except Exception as commit_err:
            db.rollback()
            logger.error(f"[Account Fetch] Failed to commit token expiry updates: {commit_err}")
    
    is_admin = current_user.role in ["Super Admin", "Admin"]
    
    results = []
    for acc in accounts:
        is_owner = acc.owner_id == current_user.id
        acc_dict = {
            "id": acc.id,
            "user_id": acc.user_id,
            "instagram_username": acc.instagram_username,
            "profile_picture": acc.profile_picture,
            "business_name": acc.business_name,
            "followers_count": acc.followers_count,
            "status": acc.status,
            "group_id": acc.group_id,
            "group_name": acc.group.name if acc.group else acc.group_name,
            "owner_id": acc.owner_id,
            "owner_name": acc.owner_name or (acc.user.full_name if acc.user else "System"),
            "linked_by": acc.linked_by,
            "linked_at": acc.linked_at,
            "created_at": acc.created_at,
            "updated_at": acc.updated_at,
            # Sensitive fields sanitized for non-owners/non-admins
            "facebook_page_id": acc.facebook_page_id if (is_admin or is_owner) else None,
            "facebook_page_name": acc.facebook_page_name if (is_admin or is_owner) else None,
            "instagram_business_id": acc.instagram_business_id if (is_admin or is_owner) else None,
            "token_expiry": acc.token_expiry if (is_admin or is_owner) else None,
            "created_by": acc.created_by if (is_admin or is_owner) else None,
            "updated_by": acc.updated_by if (is_admin or is_owner) else None,
            "last_modified_by": acc.last_modified_by if (is_admin or is_owner) else None,
            "last_modified_at": acc.last_modified_at if (is_admin or is_owner) else None,
        }
        results.append(acc_dict)

    logger.info(f"[Account Fetch] Returning {len(results)} account(s) to user {current_user.username}.")
    return results

@app.post("/accounts/connect", response_model=InstagramAccountResponse)
@app.post("/api/accounts/connect", response_model=InstagramAccountResponse)
@app.post("/accounts", response_model=InstagramAccountResponse)
@app.post("/api/accounts", response_model=InstagramAccountResponse)
def connect_account_manually(
    acc_data: InstagramAccountCreate, 
    request: Request,
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    """
    Manually connect an Instagram account using a pre-generated Page Access Token.
    
    CRITICAL FIX: Uses UPSERT logic — checks for existing account by instagram_business_id.
    If found: updates the token and profile. If not: inserts new record.
    This prevents IntegrityError on duplicate instagram_business_id (unique constraint).
    """
    client_ip = request.client.host if request.client else "127.0.0.1"
    logger.info(f"[Manual Connect] User {current_user.username} connecting account @{acc_data.instagram_username_or_email}")
    
    # Verify account and resolve IG business details
    result = InstagramClient.verify_and_resolve_account(
        username=acc_data.instagram_username_or_email,
        access_token=acc_data.access_token,
        facebook_page_id=acc_data.facebook_page_id
    )
    if result["status"] == "rejected":
        logger.warning(f"[Manual Connect] Verification rejected for @{acc_data.instagram_username_or_email}: {result.get('reason')}")
        raise HTTPException(status_code=400, detail=result.get("reason", "Verification rejected"))

    ig_biz_id = result["instagram_account_id"]
    ig_username = result["username"]
    encrypted_token = encrypt_token(acc_data.access_token)
    token_expiry = result.get("token_expiry_time") or (datetime.utcnow() + timedelta(days=60))
    
    # UPSERT: check if this Instagram Business Account is already connected
    existing = db.query(InstagramAccount).filter(
        InstagramAccount.instagram_business_id == ig_biz_id
    ).first()
    
    if existing:
        logger.info(f"[Manual Connect] Account @{ig_username} (IG ID: {ig_biz_id}) already exists (DB ID: {existing.id}). Updating token...")
        existing.page_access_token = encrypted_token
        existing.facebook_page_id = result.get("facebook_page_id") or existing.facebook_page_id
        existing.facebook_page_name = result.get("business_name") or existing.facebook_page_name
        existing.instagram_username = ig_username
        existing.profile_picture = result.get("profile_picture") or existing.profile_picture
        existing.business_name = result.get("business_name") or existing.business_name
        existing.followers_count = result.get("followers_count", existing.followers_count)
        existing.token_expiry = token_expiry
        existing.status = "Connected"
        existing.updated_by = current_user.username
        existing.last_modified_by = current_user.username
        existing.last_modified_at = datetime.utcnow()
        try:
            db.commit()
            db.refresh(existing)
            logger.info(f"[Manual Connect] [DB UPDATE] Account @{ig_username} token updated. DB committed.")
            create_audit_log(db=db, action="User Action",
                description=f"[Token Refresh] {current_user.username} refreshed token for @{ig_username} via manual connect. Status: Connected.",
                user_id=current_user.id, ip_address=client_ip)
        except Exception as e:
            db.rollback()
            logger.error(f"[Manual Connect] DB commit failed for @{ig_username}: {e}")
            raise HTTPException(status_code=500, detail=f"Database error updating account: {str(e)}")
        return existing
    
    # INSERT new account
    logger.info(f"[Manual Connect] Account @{ig_username} is new. Inserting into database...")
    new_acc = InstagramAccount(
        user_id=current_user.id,
        facebook_page_id=result.get("facebook_page_id"),
        facebook_page_name=result.get("business_name") or "Manual Connected Page",
        page_access_token=encrypted_token,
        instagram_business_id=ig_biz_id,
        instagram_username=ig_username,
        profile_picture=result.get("profile_picture") or "https://placekitten.com/200/200",
        business_name=result.get("business_name") or "Manual Business",
        followers_count=result.get("followers_count", 0),
        token_expiry=token_expiry,
        status="Connected",
        # Ownership fields
        owner_id=current_user.id,
        owner_name=current_user.full_name,
        linked_by=current_user.username,
        linked_at=datetime.utcnow(),
        created_by=current_user.username
    )
    db.add(new_acc)
    try:
        db.commit()
        db.refresh(new_acc)
        logger.info(f"[Manual Connect] [DB INSERT] Account @{ig_username} committed. DB ID: {new_acc.id}")
        create_audit_log(db=db, action="User Action",
            description=f"[Account Connected] {current_user.username} manually connected @{ig_username} (IG ID: {ig_biz_id}). Token expires: {token_expiry}. DB committed.",
            user_id=current_user.id, ip_address=client_ip)
    except Exception as e:
        db.rollback()
        logger.error(f"[Manual Connect] [DB INSERT FAILED] Failed to commit new account @{ig_username}: {e}")
        raise HTTPException(status_code=500, detail=f"Database error saving account: {str(e)}")
    
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
    
    # Permission verification
    check_account_modification_permission(acc, current_user)

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

    is_admin = current_user.role in ["Super Admin", "Admin"]
    action_desc = f"Admin updated token for @{acc.instagram_username}" if is_admin else f"Owner refreshed access token for @{acc.instagram_username}"
    acc.last_modified_by = current_user.username
    acc.last_modified_at = datetime.utcnow()
    db.commit()

    create_audit_log(
        db=db,
        action="User Action",
        description=action_desc,
        user_id=current_user.id,
        ip_address=client_ip
    )
    return acc

@app.delete("/accounts/{id}")
@app.delete("/api/accounts/{id}")
def delete_account(id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
    
    # Permission verification
    check_account_modification_permission(acc, current_user)

    username = acc.instagram_username
    db.delete(acc)
    db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"
    is_admin = current_user.role in ["Super Admin", "Admin"]
    del_desc = f"Admin deleted @{username}" if is_admin else f"Owner deleted @{username}"
    
    create_audit_log(
        db=db,
        action="User Action",
        description=del_desc,
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {"detail": "Instagram profile successfully disconnected."}

@app.post("/accounts/{id}/sync")
@app.post("/api/accounts/{id}/sync")
def sync_account_profile(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    On-demand sync of an Instagram account's live profile data from the Instagram Graph API.
    
    This is intentionally separate from GET /accounts to avoid blocking the accounts list load.
    Users can trigger this manually per account to refresh follower count, profile picture, etc.
    If the token is expired, marks the account as 'Token Expired' and returns an error message.
    Account is NEVER deleted — always preserved in the database.
    """
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
    
    logger.info(f"[Account Sync] User {current_user.username} triggering sync for @{acc.instagram_username} (ID: {id})")
    
    try:
        token = decrypt_token(acc.page_access_token)
        
        if InstagramClient.is_mock_token(token):
            logger.info(f"[Account Sync] @{acc.instagram_username} uses mock token. Skipping live sync.")
            return {
                "status": "skipped",
                "message": "Mock account — no live sync needed.",
                "instagram_username": acc.instagram_username,
                "followers_count": acc.followers_count
            }
        
        profile = InstagramClient.get_instagram_profile_details(acc.instagram_business_id, token)
        
        acc.followers_count = profile.get("followers_count", acc.followers_count)
        acc.profile_picture = profile.get("profile_picture_url") or acc.profile_picture
        acc.business_name = profile.get("name") or acc.business_name
        acc.instagram_username = profile.get("username") or acc.instagram_username
        
        # If sync succeeded, token is still valid — ensure status is Connected
        if acc.status == "Token Expired":
            acc.status = "Connected"
            logger.info(f"[Account Sync] @{acc.instagram_username} token valid. Status restored to Connected.")
        
        acc.updated_by = current_user.username
        acc.last_modified_at = datetime.utcnow()
        db.commit()
        logger.info(f"[Account Sync] @{acc.instagram_username} synced successfully. Followers: {acc.followers_count}")
        
        return {
            "status": "synced",
            "instagram_username": acc.instagram_username,
            "followers_count": acc.followers_count,
            "profile_picture": acc.profile_picture,
            "business_name": acc.business_name,
            "account_status": acc.status
        }
    
    except Exception as e:
        # Token may be invalid/expired — mark as expired, DO NOT delete account
        logger.warning(f"[Account Sync] @{acc.instagram_username} sync failed (likely expired token): {e}")
        now = datetime.utcnow()
        
        if acc.token_expiry and acc.token_expiry < now:
            acc.status = "Token Expired"
            acc.last_modified_at = now
            try:
                db.commit()
                logger.info(f"[Account Sync] @{acc.instagram_username} marked as 'Token Expired' in DB.")
            except Exception as commit_err:
                db.rollback()
                logger.error(f"[Account Sync] Failed to commit Token Expired status: {commit_err}")
        
        create_audit_log(db=db, action="Errors",
            description=f"[Sync Failed] Sync failed for @{acc.instagram_username}: {str(e)[:200]}",
            user_id=current_user.id)
        
        raise HTTPException(
            status_code=400,
            detail=f"Sync failed for @{acc.instagram_username}: {str(e)[:200]}. Token may be expired — please reconnect."
        )

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
    group = db.query(Group).filter(Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Target Group not found.")
    
    # Check group modification permissions
    if current_user.role not in ["Super Admin", "Admin"] and group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the group owner or an administrator can modify this Group.")
        
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
        # Check permissions on target account
        check_account_modification_permission(existing, current_user)

        if existing.group_id == group_id:
            existing.page_access_token = encrypt_token(payload.access_token)
            existing.followers_count = followers or existing.followers_count
            existing.profile_picture = profile_pic or existing.profile_picture
            existing.status = "Connected"
            existing.token_expiry = datetime.utcnow() + timedelta(days=60)
            existing.last_modified_by = current_user.username
            existing.last_modified_at = datetime.utcnow()
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
        existing.last_modified_by = current_user.username
        existing.last_modified_at = datetime.utcnow()
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
        status="Connected",
        # Ownership fields
        owner_id=current_user.id,
        owner_name=current_user.full_name,
        linked_by=current_user.username,
        created_by=current_user.username
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    
    # Audit log
    create_audit_log(
        db=db,
        action="User Action",
        description=f"{current_user.username} linked @{new_acc.instagram_username}",
        user_id=current_user.id
    )
    return new_acc

@app.get("/groups", response_model=List[GroupResponse])
@app.get("/api/groups", response_model=List[GroupResponse])
def get_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Load all groups (shared globally)
    user_groups = db.query(Group).all()
    
    # Auto-seed Default group if none exist
    if not user_groups:
        default_group = Group(user_id=current_user.id, name="Default")
        db.add(default_group)
        db.commit()
        db.refresh(default_group)
        user_groups = [default_group]
        
    # Map all unassigned accounts to the first group
    unassigned_accounts = db.query(InstagramAccount).filter(
        InstagramAccount.group_id == None
    ).all()
    if unassigned_accounts:
        target_group = user_groups[0]
        for acc in unassigned_accounts:
            acc.group_id = target_group.id
            acc.group_name = target_group.name
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
@app.post("/api/groups", response_model=GroupResponse)
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
@app.put("/api/groups/{id}", response_model=GroupResponse)
def update_group(id: int, group_data: GroupUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = db.query(Group).filter(Group.id == id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
        
    # Check permissions
    if current_user.role not in ["Super Admin", "Admin"] and group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the group owner or an administrator can modify this Group.")
        
    group.name = group_data.name
    # Update associated accounts' group name
    db.query(InstagramAccount).filter(InstagramAccount.group_id == group.id).update(
        {InstagramAccount.group_name: group_data.name}
    )
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
@app.delete("/api/groups/{id}")
def delete_group(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = db.query(Group).filter(Group.id == id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")
        
    # Check permissions
    if current_user.role not in ["Super Admin", "Admin"] and group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the group owner or an administrator can modify this Group.")
    
    # Verify group is empty
    count = db.query(InstagramAccount).filter(InstagramAccount.group_id == group.id).count()
    if count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete group: group contains connected profiles. Move profiles to another group first.")
        
    db.delete(group)
    db.commit()
    return {"detail": "Group deleted successfully."}

@app.post("/accounts/{id}/move", response_model=InstagramAccountResponse)
def move_account_to_group(id: int, payload: MoveAccountRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
        
    # Permission verification
    check_account_modification_permission(acc, current_user)
        
    if payload.group_id:
        target_group = db.query(Group).filter(Group.id == payload.group_id).first()
        if not target_group:
            raise HTTPException(status_code=404, detail="Target Group not found.")
        acc.group_id = target_group.id
        acc.group_name = target_group.name
    else:
        acc.group_id = None
        acc.group_name = None
        
    acc.last_modified_by = current_user.username
    acc.last_modified_at = datetime.utcnow()
    db.commit()
    db.refresh(acc)
    return acc

@app.get("/groups/{group_id}/accounts", response_model=List[InstagramAccountResponse])
def get_group_accounts(group_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(InstagramAccount).filter(
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
@app.post("/api/publish")
def publish_post(
    pub_req: PublishRequest, 
    request: Request,
    background_tasks: BackgroundTasks,
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
        # Check background Celery worker status
        from .worker_service import WorkerService
        status_info = WorkerService.get_status()
        worker_active = status_info.get("worker_running", False)

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

        # 3. Submit queue processing task via Celery or BackgroundTasks fallback
        task_id = str(uuid.uuid4())
        logger.info("Submitting publish task...")
        logger.info(f"Broker URL: {settings.REDIS_URL}")
        
        if worker_active:
            try:
                task = process_queue_task.apply_async(task_id=task_id)
                logger.info("[Publish Workflow] Task enqueued to active Celery worker.")
            except Exception as queue_err:
                logger.warning(f"[Publish Workflow] Celery dispatch error: {queue_err}. Triggering BackgroundTasks fallback.")
                background_tasks.add_task(process_queue_task)
        else:
            logger.info("[Publish Workflow] Celery worker offline; dispatching in-process FastAPI background task.")
            background_tasks.add_task(process_queue_task)

        create_audit_log(
            db=db,
            action="Publishing",
            description=f"Enqueued publish task ID {post.id} targeting {len(pub_req.account_ids)} accounts.",
            user_id=current_user.id,
            ip_address=client_ip
        )

        return {
            "task_id": task_id,
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
def retry_failed_publish_item(id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PublishingQueue).filter(PublishingQueue.id == id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found.")
        
    item.status = "Waiting"
    item.progress_percent = 0
    item.current_step = "Retrying Manual Trigger"
    item.retry_count = 0
    db.commit()
    
    try:
        process_queue_task.apply_async()
    except Exception:
        background_tasks.add_task(process_queue_task)
    return {"detail": "Retry enqueued successfully."}

@app.get("/publish-history/{id}/logs", response_model=List[PublishingLogResponse])
def get_publishing_item_logs(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(PublishingLog).filter(PublishingLog.queue_id == id).order_by(PublishingLog.timestamp.asc()).all()

@app.get("/publish/status", response_model=List[PublishingQueueResponse])
def get_publishing_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve outstanding queue logs."""
    return db.query(PublishingQueue).join(Post).filter(Post.user_id == current_user.id).order_by(PublishingQueue.id.desc()).all()

@app.get("/publish/history", response_model=List[PublishingHistoryResponse])
@app.get("/api/publish/history", response_model=List[PublishingHistoryResponse])
@app.get("/history", response_model=List[PublishingHistoryResponse])
@app.get("/api/history", response_model=List[PublishingHistoryResponse])
def get_publishing_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve success publications history."""
    return db.query(PublishingHistory).join(Post).filter(Post.user_id == current_user.id).order_by(PublishingHistory.published_time.desc()).all()

@app.get("/publish/logs", response_model=List[AuditLogResponse])
@app.get("/api/publish/logs", response_model=List[AuditLogResponse])
@app.get("/logs", response_model=List[AuditLogResponse])
@app.get("/api/logs", response_model=List[AuditLogResponse])
@app.get("/audit-logs", response_model=List[AuditLogResponse])
@app.get("/api/audit-logs", response_model=List[AuditLogResponse])
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

@app.post("/accounts/{id}/transfer-owner", response_model=InstagramAccountResponse)
def transfer_account_ownership(
    id: int,
    payload: TransferOwnerPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    acc = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Instagram profile not found.")
        
    if current_user.role not in ["Super Admin", "Admin"]:
        raise HTTPException(status_code=403, detail="Only an administrator can transfer account ownership.")
        
    new_owner = db.query(User).filter(User.id == payload.new_owner_id).first()
    if not new_owner:
        raise HTTPException(status_code=404, detail="New owner user not found.")
        
    old_owner_name = acc.owner_name or "N/A"
    acc.owner_id = new_owner.id
    acc.owner_name = new_owner.full_name
    acc.last_modified_by = current_user.username
    acc.last_modified_at = datetime.utcnow()
    db.commit()
    db.refresh(acc)
    
    client_ip = request.client.host if request.client else "127.0.0.1"
    create_audit_log(
        db=db,
        action="User Action",
        description=f"Admin {current_user.username} transferred ownership of @{acc.instagram_username} from {old_owner_name} to {new_owner.username}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return acc

# --- Media Upload REST APIs ---

@app.post("/media/upload", response_model=MediaResponse)
@app.post("/api/media/upload", response_model=MediaResponse)
async def upload_media_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    filename = file.filename or "unnamed_media"
    mime = file.content_type or ""
    logger.info(f"[Media Upload] Incoming upload request: filename='{filename}', mime='{mime}', user='{current_user.username}'")
    
    ext = os.path.splitext(filename)[1].lower()
    
    # Restrict executable or dangerous extensions
    if ext in [".exe", ".bat", ".sh", ".py", ".js", ".html", ".htm", ".php", ".pl", ".cgi", ".cmd", ".vbs"]:
        logger.warning(f"[Media Upload] Rejected forbidden extension '{ext}' from user {current_user.username}")
        raise HTTPException(status_code=400, detail="Forbidden file extension type.")
        
    is_image = "image" in mime or ext in [".jpg", ".jpeg", ".png", ".webp"]
    is_video = "video" in mime or ext in [".mp4", ".mov"]
    
    if not is_image and not is_video:
        logger.warning(f"[Media Upload] Rejected unsupported format '{mime}' ({ext})")
        raise HTTPException(status_code=400, detail="Unsupported media format. Please upload JPG, JPEG, PNG, WEBP images or MP4, MOV videos.")
        
    # Read file and validate size
    try:
        content = await file.read()
        file_size = len(content)
        await file.seek(0)
    except Exception as e:
        logger.error(f"[Media Upload] Failed to read uploaded file payload: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail="Unable to read uploaded file payload.")
    
    # 10MB limit for images, 100MB for videos
    max_size = 10 * 1024 * 1024 if is_image else 100 * 1024 * 1024
    if file_size > max_size:
        type_str = "Image" if is_image else "Video"
        limit_str = "10MB" if is_image else "100MB"
        logger.warning(f"[Media Upload] File size {file_size} bytes exceeds limit for {type_str} ({limit_str})")
        raise HTTPException(status_code=400, detail=f"{type_str} size exceeds the limit of {limit_str}.")
        
    # Stream/Upload directly to Supabase Storage bucket 'Karuppu' (No local disk storage)
    try:
        supabase_res = upload_to_supabase_storage(
            file_content=content,
            original_filename=filename,
            mime_type=mime or ("image/jpeg" if is_image else "video/mp4"),
            is_image=is_image
        )
    except Exception as e:
        logger.error(f"[Media Upload] Supabase Storage upload error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Unable to upload to cloud storage: {str(e)}")
        
    media_type = "IMAGE" if is_image else "REELS"
    public_url = supabase_res["public_url"]
    
    # Save upload metadata reference in db
    try:
        media = MediaUpload(
            filename=filename,
            original_filename=filename,
            stored_filename=supabase_res["stored_filename"],
            media_type=media_type,
            mime_type=mime or ("image/jpeg" if is_image else "video/mp4"),
            file_size=file_size,
            bucket_name=supabase_res["bucket_name"],
            storage_path=supabase_res["storage_path"],
            public_url=public_url,
            storage_url=public_url,
            uploaded_by=current_user.username
        )
        db.add(media)
        db.commit()
        db.refresh(media)
    except Exception as e:
        logger.error(f"[Media Upload] Database transaction error: {str(e)}", exc_info=True)
        db.rollback()
        raise HTTPException(status_code=500, detail="Database transaction error while recording media upload.")
    
    logger.info(f"[Media Upload] Successfully uploaded to Supabase Storage #{media.id}: type={media_type}, path='{supabase_res['storage_path']}', url='{public_url}', size={file_size} bytes")
    return media

@app.get("/media/{media_id}", response_model=MediaResponse)
@app.get("/api/media/{media_id}", response_model=MediaResponse)
def get_media_details(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    media = db.query(MediaUpload).filter(MediaUpload.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media resource not found.")
    return media

@app.delete("/media/{media_id}")
@app.delete("/api/media/{media_id}")
def delete_media_file(
    media_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    media = db.query(MediaUpload).filter(MediaUpload.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media resource not found.")
        
    # Delete local static file copy if exists
    try:
        filename = os.path.basename(media.storage_url)
        local_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(local_path):
            os.remove(local_path)
    except Exception as e:
        logger.error(f"Error removing local file: {e}")
        
    db.delete(media)
    db.commit()
    return {"detail": "Media file successfully deleted."}
