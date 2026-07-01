import os
import shutil
import uuid
import datetime
import requests
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, SessionLocal, get_db
from .models import User, InstagramAccount, PublishingLog, Log
from .schemas import (
    UserLogin, UserCreate, UserResponse, UserUpdate, ChangePasswordRequest,
    Token, TokenData, InstagramAccountResponse,
    PublishRequest, PublishingLogResponse, LogResponse
)
from .security import (
    verify_password, get_password_hash, create_access_token, 
    decode_access_token, encrypt_token, decrypt_token
)
from .tasks import publish_post_task
from .s3 import upload_file_to_s3

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-ready Instagram Multi-Account Publishing Platform backend.",
    version="4.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "http://127.0.0.1"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")), name="static")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

@app.on_event("startup")
def startup_db_setup():
    Base.metadata.create_all(bind=engine)
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
                email_verified=True,
                mobile_verified=True,
                publishing_permission=True
            )
            db.add(admin_user)
            db.commit()
            
            db.add(Log(
                action="SYSTEM_SEED",
                description="Database initialized. Super Admin seeded successfully.",
                ip_address="127.0.0.1"
            ))
            db.commit()
    finally:
        db.close()

def create_audit_log(db: Session, action: str, description: str, user_id: Optional[int] = None, ip_address: Optional[str] = None):
    log_entry = Log(
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
        action="USER_SIGNUP",
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
            action="LOGIN_FAILED",
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
            detail="Your account is pending approval."
        )
    elif user.status == "Rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your registration request was rejected."
        )

    create_audit_log(
        db=db,
        action="LOGIN_SUCCESS",
        description=f"User {user.username} logged in successfully.",
        user_id=user.id,
        ip_address=client_ip
    )

    access_token = create_access_token(data={"username": user.username, "role": user.role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role,
        "status": user.status
    }

@app.get("/profile", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    return current_user

# --- Meta OAuth / Facebook Login Routes ---

@app.post("/auth/facebook/login")
def facebook_login_url(current_user: User = Depends(get_current_user)):
    """
    Generates and returns the URL to redirect the user to for Facebook Login.
    Encodes the current user's details inside the 'state' token for CSRF protection and context preservation.
    """
    state_token = create_access_token(data={"username": current_user.username}, expires_delta=datetime.timedelta(minutes=15))
    scopes = [
        "instagram_basic",
        "instagram_content_publish",
        "instagram_manage_comments",
        "instagram_manage_messages",
        "pages_show_list",
        "pages_read_engagement",
        "business_management"
    ]
    scopes_str = ",".join(scopes)
    
    # Check if app is in mock mode (no client ID)
    if not settings.FACEBOOK_CLIENT_ID:
        # Development Mock Login Redirect directly to Callback
        mock_callback_url = (
            f"/api/auth/facebook/callback?code=mock_code_{uuid.uuid4().hex[:8]}"
            f"&state={state_token}"
        )
        return {"url": mock_callback_url}
        
    oauth_url = (
        f"https://www.facebook.com/v25.0/dialog/oauth"
        f"?client_id={settings.FACEBOOK_CLIENT_ID}"
        f"&redirect_uri={settings.FACEBOOK_REDIRECT_URI}"
        f"&scope={scopes_str}"
        f"&response_type=code"
        f"&state={state_token}"
    )
    return {"url": oauth_url}

@app.get("/auth/facebook/callback")
def facebook_callback(code: str, state: str, db: Session = Depends(get_db)):
    """
    Exchange the authorization code for page access tokens and connected instagram business accounts.
    """
    try:
        payload = decode_access_token(state)
        username = payload.get("username")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid state token user")
        user_id = user.id
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid state token payload: {e}")

    # Detect if we should use mock authentication
    is_mock = not settings.FACEBOOK_CLIENT_ID or not settings.FACEBOOK_CLIENT_SECRET or code.startswith("mock")
    
    if is_mock:
        fb_user_id = f"mock_fb_{uuid.uuid4().hex[:6]}"
        facebook_page_id = f"mock_page_{uuid.uuid4().hex[:6]}"
        facebook_page_name = "Mock Agency Creative Feed"
        page_token = "mock_token_EAA_" + uuid.uuid4().hex
        instagram_business_id = f"mock_ig_biz_{uuid.uuid4().hex[:6]}"
        instagram_username = f"mock_{username}"
        
        acc = db.query(InstagramAccount).filter(
            InstagramAccount.instagram_business_id == instagram_business_id,
            InstagramAccount.user_id == user_id
        ).first()
        
        if not acc:
            acc = InstagramAccount(
                user_id=user_id,
                facebook_user_id=fb_user_id,
                facebook_page_id=facebook_page_id,
                facebook_page_name=facebook_page_name,
                page_access_token=encrypt_token(page_token),
                instagram_business_id=instagram_business_id,
                instagram_username=instagram_username,
                token_expiry=datetime.datetime.utcnow() + datetime.timedelta(days=60),
                status="ACTIVE"
            )
            db.add(acc)
        else:
            acc.facebook_user_id = fb_user_id
            acc.facebook_page_id = facebook_page_id
            acc.facebook_page_name = facebook_page_name
            acc.page_access_token = encrypt_token(page_token)
            acc.instagram_username = instagram_username
            acc.token_expiry = datetime.datetime.utcnow() + datetime.timedelta(days=60)
            acc.status = "ACTIVE"
            
        db.commit()
        return RedirectResponse(url=f"http://localhost:3000/accounts?status=success&username={instagram_username}")
        
    else:
        try:
            # 1. Exchange code for User Access Token
            token_url = "https://graph.facebook.com/v25.0/oauth/access_token"
            params = {
                "client_id": settings.FACEBOOK_CLIENT_ID,
                "client_secret": settings.FACEBOOK_CLIENT_SECRET,
                "redirect_uri": settings.FACEBOOK_REDIRECT_URI,
                "code": code
            }
            res = requests.get(token_url, params=params, timeout=15)
            if res.status_code != 200:
                raise Exception(f"Facebook OAuth token exchange failed: {res.text}")
            user_access_token = res.json().get("access_token")
            
            # 2. Retrieve Facebook User ID (GET /me)
            me_res = requests.get("https://graph.facebook.com/v25.0/me", params={"access_token": user_access_token}, timeout=15)
            if me_res.status_code != 200:
                raise Exception(f"Facebook /me retrieval failed: {me_res.text}")
            fb_user_id = me_res.json().get("id")
            
            # 3. Retrieve managed pages (GET /me/accounts)
            accounts_res = requests.get("https://graph.facebook.com/v25.0/me/accounts", params={"access_token": user_access_token}, timeout=15)
            if accounts_res.status_code != 200:
                raise Exception(f"Facebook /me/accounts retrieval failed: {accounts_res.text}")
            
            pages_data = accounts_res.json().get("data", [])
            if not pages_data:
                raise Exception("No Facebook Pages linked to this access token.")
                
            connected_names = []
            for page in pages_data:
                page_id = page.get("id")
                page_name = page.get("name")
                page_token = page.get("access_token") # Page Access Token
                
                # 4. Get instagram_business_account linked to the page
                page_url = f"https://graph.facebook.com/v25.0/{page_id}"
                page_detail = requests.get(page_url, params={"fields": "instagram_business_account", "access_token": page_token}, timeout=15)
                
                if page_detail.status_code == 200:
                    ig_account = page_detail.json().get("instagram_business_account")
                    if ig_account:
                        instagram_business_id = ig_account.get("id")
                        
                        # 5. Retrieve Instagram username
                        ig_url = f"https://graph.facebook.com/v25.0/{instagram_business_id}"
                        ig_res = requests.get(ig_url, params={"fields": "id,username", "access_token": page_token}, timeout=15)
                        if ig_res.status_code == 200:
                            instagram_username = ig_res.json().get("username")
                            
                            # Save/Update Account
                            acc = db.query(InstagramAccount).filter(
                                InstagramAccount.instagram_business_id == instagram_business_id,
                                InstagramAccount.user_id == user_id
                            ).first()
                            
                            if not acc:
                                acc = InstagramAccount(
                                    user_id=user_id,
                                    facebook_user_id=fb_user_id,
                                    facebook_page_id=page_id,
                                    facebook_page_name=page_name,
                                    page_access_token=encrypt_token(page_token),
                                    instagram_business_id=instagram_business_id,
                                    instagram_username=instagram_username,
                                    token_expiry=datetime.datetime.utcnow() + datetime.timedelta(days=60),
                                    status="ACTIVE"
                                )
                                db.add(acc)
                            else:
                                acc.facebook_user_id = fb_user_id
                                acc.facebook_page_id = page_id
                                acc.facebook_page_name = page_name
                                acc.page_access_token = encrypt_token(page_token)
                                acc.instagram_username = instagram_username
                                acc.token_expiry = datetime.datetime.utcnow() + datetime.timedelta(days=60)
                                acc.status = "ACTIVE"
                            
                            db.commit()
                            connected_names.append(instagram_username)
            
            if not connected_names:
                raise Exception("No Instagram Business Accounts could be resolved from your managed Facebook Pages.")
                
            return RedirectResponse(url=f"http://localhost:3000/accounts?status=success&username={','.join(connected_names)}")
        except Exception as ex:
            return RedirectResponse(url=f"http://localhost:3000/accounts?status=error&message={requests.utils.quote(str(ex))}")

# --- Instagram Connected Accounts CRUD ---

@app.get("/accounts", response_model=List[InstagramAccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "Super Admin":
        return db.query(InstagramAccount).order_by(InstagramAccount.id.asc()).all()
    else:
        return db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).order_by(InstagramAccount.id.asc()).all()

@app.delete("/accounts/{id}")
def delete_account(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    account = db.query(InstagramAccount).filter(InstagramAccount.id == id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Instagram account not found.")
        
    if current_user.role != "Super Admin" and account.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this account.")
        
    username = account.instagram_username
    db.delete(account)
    db.commit()
    
    create_audit_log(
        db=db,
        action="IG_ACCOUNT_DELETE",
        description=f"User {current_user.username} removed connected Instagram account: {username}",
        user_id=current_user.id
    )
    return {"message": f"Successfully disconnected Instagram account @{username}."}

# --- Publishing & History APIs ---

@app.post("/upload-media")
def upload_media(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    file_ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = [".jpg", ".jpeg", ".png", ".mp4", ".mov"]
    if file_ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Allowed: JPG, PNG, MP4, MOV."
        )

    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    # Upload to S3 compatible storage in production if configured
    public_url = upload_file_to_s3(file_path, unique_filename)
    
    return {
        "filename": unique_filename,
        "media_path": file_path,
        "public_url": public_url
    }

@app.post("/publish", status_code=status.HTTP_202_ACCEPTED)
def publish_post(pub_request: PublishRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not current_user.publishing_permission:
        raise HTTPException(status_code=403, detail="Your publishing permissions have been revoked.")

    if not pub_request.account_ids:
        raise HTTPException(status_code=400, detail="Must select at least one Instagram account.")

    # Validate media path exists locally or is a public URL
    if not (pub_request.media_path.startswith("http://") or pub_request.media_path.startswith("https://")):
        if not os.path.exists(pub_request.media_path):
            fallback = os.path.join(UPLOAD_DIR, os.path.basename(pub_request.media_path))
            if os.path.exists(fallback):
                pub_request.media_path = fallback
            else:
                raise HTTPException(status_code=400, detail="Media file not found on server.")

    # Determine media type
    video_extensions = [".mp4", ".mov", ".avi", ".mkv"]
    _, ext = os.path.splitext(pub_request.media_path.lower())
    media_type = "VIDEO" if ext in video_extensions else "IMAGE"

    created_log_ids = []
    for acc_id in pub_request.account_ids:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == acc_id).first()
        if not acc:
            raise HTTPException(status_code=404, detail=f"Account ID {acc_id} does not exist.")
            
        new_log = PublishingLog(
            user_id=current_user.id,
            account_id=acc_id,
            media_type=media_type,
            caption=pub_request.caption,
            hashtags=pub_request.hashtags,
            status="Queued",
            published_at=datetime.datetime.utcnow()
        )
        db.add(new_log)
        db.commit()
        db.refresh(new_log)
        created_log_ids.append(new_log.id)

        # Trigger background Celery execution
        publish_post_task.delay(new_log.id)

    create_audit_log(
        db=db,
        action="PUBLISH_QUEUE",
        description=f"User {current_user.username} queued publication for log IDs: {created_log_ids}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {
        "message": "Publishing started successfully.",
        "log_ids": created_log_ids
    }

@app.get("/history", response_model=List[PublishingLogResponse])
def get_publish_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "Super Admin":
        posts = db.query(PublishingLog).order_by(PublishingLog.created_at.desc()).all()
    else:
        posts = db.query(PublishingLog).filter(PublishingLog.user_id == current_user.id).order_by(PublishingLog.created_at.desc()).all()

    res = []
    for p in posts:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == p.account_id).first()
        username = acc.instagram_username if acc else f"Unknown Account ({p.account_id})"
        res.append({
            "id": p.id,
            "user_id": p.user_id,
            "account_id": p.account_id,
            "instagram_username": username,
            "media_type": p.media_type,
            "caption": p.caption,
            "hashtags": p.hashtags,
            "status": p.status,
            "error_message": p.error_message,
            "post_id": p.post_id,
            "published_at": p.published_at,
            "created_at": p.created_at,
            "updated_at": p.updated_at
        })
    return res

# Backward compatibility route for dashboard client frontend query
@app.get("/publish-history", response_model=List[PublishingLogResponse])
def get_publish_history_compat(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_publish_history(db, current_user)

@app.post("/publish/{post_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_post(post_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not current_user.publishing_permission:
        raise HTTPException(status_code=403, detail="Your publishing permissions have been revoked.")

    post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publishing log entry not found.")

    if current_user.role != "Super Admin" and post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to retry this post.")

    post.status = "Queued"
    post.error_message = None
    post.updated_at = datetime.datetime.utcnow()
    db.commit()

    publish_post_task.delay(post.id)

    create_audit_log(
        db=db,
        action="PUBLISH_RETRY",
        description=f"User {current_user.username} retried publication for log ID: {post.id}",
        user_id=current_user.id,
        ip_address=client_ip
    )
    return {
        "message": "Publishing retried successfully.",
        "post_id": post.id
    }

# --- Audit Logs APIs ---

@app.get("/logs", response_model=List[LogResponse])
def get_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "Super Admin":
        logs = db.query(Log).order_by(Log.created_at.desc()).limit(200).all()
    else:
        logs = db.query(Log).filter(Log.user_id == current_user.id).order_by(Log.created_at.desc()).limit(100).all()

    res = []
    for l in logs:
        username = None
        if l.user_id:
            usr = db.query(User).filter(User.id == l.user_id).first()
            username = usr.username if usr else f"Deleted User (ID: {l.user_id})"
        res.append({
            "id": l.id,
            "user_id": l.user_id,
            "username": username,
            "action": l.action,
            "description": l.description,
            "ip_address": l.ip_address,
            "created_at": l.created_at
        })
    return res

@app.get("/publish-history/{post_id}/logs", response_model=List[LogResponse])
def get_post_logs(post_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    post = db.query(PublishingLog).filter(PublishingLog.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publishing log not found.")
    
    if current_user.role != "Super Admin" and post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view these logs.")
        
    logs = db.query(Log).filter(
        (Log.description.like(f"%log {post_id}%")) | 
        (Log.description.like(f"%log ID: {post_id}%")) | 
        (Log.description.like(f"%log ID {post_id}%"))
    ).order_by(Log.created_at.asc()).all()

    res = []
    for l in logs:
        username = None
        if l.user_id:
            usr = db.query(User).filter(User.id == l.user_id).first()
            username = usr.username if usr else f"User ID: {l.user_id}"
        res.append({
            "id": l.id,
            "user_id": l.user_id,
            "username": username,
            "action": l.action,
            "description": l.description,
            "ip_address": l.ip_address,
            "created_at": l.created_at
        })
    return res

# --- Progress Streaming (SSE) ---

@app.get("/publish-progress/stream")
async def publish_progress_stream(request: Request):
    import redis.asyncio as aioredis
    import json
    import asyncio
    
    async def event_generator():
        r = await aioredis.from_url(settings.REDIS_URL)
        pubsub = r.pubsub()
        await pubsub.subscribe("instagram_publish_progress")
        try:
            while True:
                if await request.is_disconnected():
                    break
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is not None:
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode("utf-8")
                    yield f"data: {data}\n\n"
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            await pubsub.unsubscribe("instagram_publish_progress")
            await pubsub.close()
            await r.close()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# --- Super Admin Management Routes ---

@app.get("/users", response_model=List[UserResponse])
def admin_get_users(db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    return db.query(User).filter(User.role != "Super Admin").order_by(User.id.asc()).all()

@app.post("/users/{user_id}/approve")
def admin_approve_user(user_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.status = "Approved"
    db.commit()
    create_audit_log(db=db, action="USER_APPROVE", description=f"Super Admin approved user: {user.username}", user_id=current_user.id, ip_address=client_ip)
    return {"message": f"User {user.username} approved successfully."}

@app.post("/users/{user_id}/reject")
def admin_reject_user(user_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.status = "Rejected"
    db.commit()
    create_audit_log(db=db, action="USER_REJECT", description=f"Super Admin rejected user: {user.username}", user_id=current_user.id, ip_address=client_ip)
    return {"message": f"User {user.username} rejected successfully."}

@app.put("/users/{user_id}/status")
def admin_set_user_status(user_id: int, status_data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    new_status = status_data.get("status")
    if new_status not in ["Approved", "Deactivated"]:
        raise HTTPException(status_code=400, detail="Invalid status option.")
    target_user.status = new_status
    db.commit()
    create_audit_log(db=db, action=f"USER_{new_status.upper()}", description=f"Super Admin changed user {target_user.username} status to {new_status}.", user_id=current_user.id, ip_address=client_ip)
    return {"message": f"User {target_user.username} status updated to {new_status}."}

@app.put("/users/{user_id}/permissions")
def admin_toggle_permissions(user_id: int, perm_data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    client_ip = request.client.host if request.client else "127.0.0.1"
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    grant = perm_data.get("publishing_permission", True)
    target_user.publishing_permission = grant
    db.commit()
    action_name = "GRANT_PUBLISH" if grant else "REVOKE_PUBLISH"
    create_audit_log(db=db, action=action_name, description=f"Super Admin set publishing permission for {target_user.username} to {grant}.", user_id=current_user.id, ip_address=client_ip)
    return {"message": f"Publishing permissions for {target_user.username} updated."}
