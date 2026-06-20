import os
import shutil
import uuid
import random
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, SessionLocal, get_db
from .models import User, InstagramAccount, CredentialUpdateRequest, Post, Log
from .schemas import (
    UserLogin, UserCreate, UserResponse, UserUpdate, ChangePasswordRequest,
    Token, TokenData,
    InstagramAccountCreate, InstagramAccountResponse,
    CredentialUpdateRequestCreate, CredentialUpdateRequestResponse, CredentialUpdateRequestProcess,
    PublishRequest, PostResponse,
    LogResponse
)
from .security import verify_password, get_password_hash, create_access_token, decode_access_token, encrypt_token, decrypt_token
from .tasks import publish_post_task

# Initialize FastAPI App
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend server for Instagram Publishing Management Platform with RBAC and Credential-Based Accounts.",
    version="3.0.0"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "http://127.0.0.1",
        "https://agentkaruppu.netlify.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Upload directory configuration
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")), name="static")

# OAuth2 schema for Swagger UI and token validation
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

# Startup database initialization & seeding
@app.on_event("startup")
def startup_db_setup():
    # Commented out drop_all to preserve existing user and admin access
    # Base.metadata.drop_all(bind=engine)
    
    # Check if we need to migrate users table columns (email and mobile_number) to nullable in SQLite
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        columns = {col["name"]: col for col in inspector.get_columns("users")}
        email_nullable = columns.get("email", {}).get("nullable", True)
        mobile_nullable = columns.get("mobile_number", {}).get("nullable", True)
        
        if not email_nullable or not mobile_nullable:
            # Only migrate if database is SQLite (standard local setup)
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("PRAGMA foreign_keys = OFF;"))
                        conn.execute(text("ALTER TABLE users RENAME TO users_old;"))
                    
                    # Recreate all tables (this creates 'users' with new nullable schema)
                    Base.metadata.create_all(bind=engine)
                    
                    with engine.begin() as conn:
                        conn.execute(text("""
                            INSERT INTO users (
                                id, full_name, email, mobile_number, username, password_hash, 
                                role, status, email_verified, mobile_verified, publishing_permission, 
                                created_at, updated_at
                            ) 
                            SELECT 
                                id, full_name, email, mobile_number, username, password_hash, 
                                role, status, email_verified, mobile_verified, publishing_permission, 
                                created_at, updated_at 
                            FROM users_old;
                        """))
                        conn.execute(text("DROP TABLE users_old;"))
                        conn.execute(text("PRAGMA foreign_keys = ON;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite users table migration failed: {e}")
                    Base.metadata.create_all(bind=engine)
            else:
                Base.metadata.create_all(bind=engine)
        else:
            Base.metadata.create_all(bind=engine)
    else:
        Base.metadata.create_all(bind=engine)
    
    # Check if we need to migrate posts table to add failure_reason column
    if "posts" in inspector.get_table_names():
        posts_cols = {col["name"]: col for col in inspector.get_columns("posts")}
        if "failure_reason" not in posts_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE posts ADD COLUMN failure_reason TEXT;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite posts table migration failed: {e}")

        # Check if we need to migrate posts table to add job_id, progress_percent, and updated_at columns
        if "job_id" not in posts_cols:
            try:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE posts ADD COLUMN job_id VARCHAR;"))
            except Exception as e:
                print(f"[Migration Warning] SQLite posts table job_id migration failed: {e}")
        if "progress_percent" not in posts_cols:
            try:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE posts ADD COLUMN progress_percent INTEGER DEFAULT 0 NOT NULL;"))
            except Exception as e:
                print(f"[Migration Warning] SQLite posts table progress_percent migration failed: {e}")
        if "updated_at" not in posts_cols:
            try:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE posts ADD COLUMN updated_at DATETIME;"))
            except Exception as e:
                print(f"[Migration Warning] SQLite posts table updated_at migration failed: {e}")
    
    # Check if we need to migrate instagram_accounts table to add new columns
    if "instagram_accounts" in inspector.get_table_names():
        ig_cols = {col["name"]: col for col in inspector.get_columns("instagram_accounts")}
        if "encrypted_access_token" not in ig_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE instagram_accounts ADD COLUMN encrypted_access_token TEXT;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite instagram_accounts encrypted_access_token migration failed: {e}")
        
        if "instagram_account_id" not in ig_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE instagram_accounts ADD COLUMN instagram_account_id VARCHAR;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite instagram_accounts instagram_account_id migration failed: {e}")
                    
        if "facebook_page_id" not in ig_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE instagram_accounts ADD COLUMN facebook_page_id VARCHAR;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite instagram_accounts facebook_page_id migration failed: {e}")
                    
        if "token_expiry_time" not in ig_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE instagram_accounts ADD COLUMN token_expiry_time DATETIME;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite instagram_accounts token_expiry_time migration failed: {e}")

    # Check if we need to migrate credential_update_requests table to add requested_access_token and facebook_page_id columns
    if "credential_update_requests" in inspector.get_table_names():
        req_cols = {col["name"]: col for col in inspector.get_columns("credential_update_requests")}
        if "requested_access_token" not in req_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE credential_update_requests ADD COLUMN requested_access_token TEXT;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite credential_update_requests requested_access_token migration failed: {e}")
                    
        if "facebook_page_id" not in req_cols:
            if settings.DATABASE_URL.startswith("sqlite"):
                try:
                    with engine.begin() as conn:
                        conn.execute(text("ALTER TABLE credential_update_requests ADD COLUMN facebook_page_id VARCHAR;"))
                except Exception as e:
                    print(f"[Migration Warning] SQLite credential_update_requests facebook_page_id migration failed: {e}")
    
    db = SessionLocal()
    try:
        # Seed the single Super Admin account
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
            
            # Log startup seed
            log = Log(
                action="SYSTEM_SEED",
                description="Database initialized. Super Admin seeded successfully.",
                ip_address="127.0.0.1"
            )
            db.add(log)
            db.commit()
    finally:
        db.close()

    # Initialize Git Sync Manager
    try:
        from .git_sync import GitSyncManager
        repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        GitSyncManager().init(repo_path)
        print(f"[Git Sync] Initialized on repository path: {repo_path}")
    except Exception as e:
        print(f"[Git Sync Warning] Failed to initialize: {e}")

# Helper for Audit Logging
def create_audit_log(db: Session, action: str, description: str, user_id: Optional[int] = None, ip_address: Optional[str] = None):
    log_entry = Log(
        user_id=user_id,
        action=action,
        description=description,
        ip_address=ip_address
    )
    db.add(log_entry)
    db.commit()

# Authentication Dependencies
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

# --- Git Synchronization Routes ---

@app.get("/git/status")
def get_git_status(current_user: User = Depends(get_current_user)):
    from .git_sync import GitSyncManager
    mgr = GitSyncManager()
    if not mgr.last_commit:
        commit_info, _ = mgr._run_cmd(["git", "log", "-n", "1", "--format=%s (%h)"])
        mgr.last_commit = commit_info
    
    return {
        "status": mgr.status,
        "last_sync": mgr.last_sync_time.isoformat() if mgr.last_sync_time else None,
        "last_commit": mgr.last_commit,
        "error": mgr.error_message,
        "uncommitted_changes": mgr.uncommitted_changes,
        "need_push": mgr.need_push
    }

@app.post("/git/sync")
def trigger_git_sync(current_user: User = Depends(get_current_user)):
    import threading
    from .git_sync import GitSyncManager
    mgr = GitSyncManager()
    if mgr.status == "SYNCING":
        raise HTTPException(status_code=400, detail="Sync already in progress")
    
    threading.Thread(target=mgr.perform_sync, daemon=True).start()
    return {"message": "Synchronization initiated"}

# --- Authentication & Registration Routes ---

@app.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    """Register a new user account. OTP verification is skipped (handled directly via status pending)."""
    
    # Strip and nullify empty string inputs
    email_val = user_data.email.strip() if user_data.email and user_data.email.strip() else None
    mobile_val = user_data.mobile_number.strip() if user_data.mobile_number and user_data.mobile_number.strip() else None

    # Validate that at least one of email or mobile number is provided
    if not email_val and not mobile_val:
        raise HTTPException(status_code=400, detail="Either email or mobile number must be provided.")

    if email_val and email_val.lower() == "agentkaruppuadmin@gmail.com":
        raise HTTPException(status_code=400, detail="Cannot register Super Admin email.")
        
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered.")
        
    if email_val:
        existing_email = db.query(User).filter(User.email == email_val).first()
        if existing_email:
            raise HTTPException(status_code=400, detail="Email address already registered.")
        
    if mobile_val:
        existing_mobile = db.query(User).filter(User.mobile_number == mobile_val).first()
        if existing_mobile:
            raise HTTPException(status_code=400, detail="Mobile number already registered.")

    # Create new User (email and mobile are auto-verified as OTP is removed)
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

    # Audit log
    create_audit_log(
        db=db,
        action="USER_SIGNUP",
        description=f"User registered: {new_user.username}. Account pending Super Admin approval.",
        user_id=new_user.id,
        ip_address=client_ip
    )

    return new_user

@app.post("/login", response_model=Token)
def login(login_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    """Authenticate credentials. OTP check is bypassed, but approval status is strictly verified."""
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

    # Check approval status
    if user.status == "Pending Approval":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending approval by the Super Admin."
        )
    elif user.status == "Rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your registration request was rejected by the Super Admin."
        )
    elif user.status == "Deactivated":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated."
        )

    # Success Log
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

# --- Profile Management Routes ---

@app.get("/profile", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    """Retrieve profile of the current logged-in user."""
    return current_user

@app.put("/profile", response_model=UserResponse)
def update_profile(profile_data: UserUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Update profile fields (Full Name, Email, Mobile). Validates duplicates."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    # Strip and nullify empty string inputs
    email_val = profile_data.email.strip() if profile_data.email and profile_data.email.strip() else None
    mobile_val = profile_data.mobile_number.strip() if profile_data.mobile_number and profile_data.mobile_number.strip() else None

    # Check that at least one remains populated
    final_email = email_val if profile_data.email is not None else current_user.email
    final_mobile = mobile_val if profile_data.mobile_number is not None else current_user.mobile_number

    if not final_email and not final_mobile:
        raise HTTPException(status_code=400, detail="Either email or mobile number must be provided.")

    if profile_data.email is not None:
        if email_val:
            existing = db.query(User).filter(User.email == email_val, User.id != current_user.id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Email address already in use.")
            current_user.email = email_val
        else:
            current_user.email = None

    if profile_data.mobile_number is not None:
        if mobile_val:
            existing = db.query(User).filter(User.mobile_number == mobile_val, User.id != current_user.id).first()
            if existing:
                raise HTTPException(status_code=400, detail="Mobile number already in use.")
            current_user.mobile_number = mobile_val
        else:
            current_user.mobile_number = None

    if profile_data.full_name:
        current_user.full_name = profile_data.full_name

    db.commit()
    db.refresh(current_user)

    create_audit_log(
        db=db,
        action="PROFILE_UPDATE",
        description=f"User {current_user.username} updated profile information.",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return current_user

@app.put("/profile/password")
def change_password(pass_data: ChangePasswordRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Change current user password."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not verify_password(pass_data.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect old password.")

    current_user.password_hash = get_password_hash(pass_data.new_password)
    db.commit()

    create_audit_log(
        db=db,
        action="PASSWORD_CHANGE",
        description=f"User {current_user.username} updated their account password.",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": "Password updated successfully."}

# --- Instagram Account Routes (Credential-Based) ---

@app.get("/accounts", response_model=List[InstagramAccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List connected Instagram accounts. Standard users see their own; Super Admin sees all."""
    if current_user.role == "Super Admin":
        accounts = db.query(InstagramAccount).order_by(InstagramAccount.id.asc()).all()
        res = []
        for acc in accounts:
            res.append({
                "id": acc.id,
                "user_id": acc.user_id,
                "instagram_username_or_email": acc.instagram_username_or_email,
                "status": acc.status,
                "last_login_status": acc.last_login_status,
                "last_publish_status": acc.last_publish_status,
                "decrypted_password": decrypt_token(acc.encrypted_password),
                "decrypted_access_token": decrypt_token(acc.encrypted_access_token) if acc.encrypted_access_token else None,
                "created_at": acc.created_at,
                "updated_at": acc.updated_at
            })
        return res
    else:
        accounts = db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).order_by(InstagramAccount.id.asc()).all()
        res = []
        for acc in accounts:
            res.append({
                "id": acc.id,
                "user_id": acc.user_id,
                "instagram_username_or_email": acc.instagram_username_or_email,
                "status": acc.status,
                "last_login_status": acc.last_login_status,
                "last_publish_status": acc.last_publish_status,
                "decrypted_password": None,
                "decrypted_access_token": None,
                "created_at": acc.created_at,
                "updated_at": acc.updated_at
            })
        return res

@app.post("/accounts", response_model=InstagramAccountResponse)
def create_account(account_data: InstagramAccountCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Add a new Instagram credential. The password is encrypted before saving."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    existing = db.query(InstagramAccount).filter(
        InstagramAccount.instagram_username_or_email == account_data.instagram_username_or_email,
        InstagramAccount.user_id == current_user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Account '{account_data.instagram_username_or_email}' already connected.")

    # Validate access token permissions and linked account using the Verification Agent
    from .instagram import InstagramClient
    verification_res = InstagramClient.verify_and_resolve_account(
        username=account_data.instagram_username_or_email,
        access_token=account_data.access_token,
        facebook_page_id=account_data.facebook_page_id
    )
    
    if verification_res["status"] == "rejected":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Access token validation failed: {verification_res['reason']}"
        )
        
    resolved_ig_id = verification_res["instagram_account_id"]
    resolved_page_id = verification_res["facebook_page_id"]
    resolved_username = verification_res["username"]
    resolved_expiry = verification_res["token_expiry_time"]

    # Check duplicate Instagram Account ID in database
    duplicate = db.query(InstagramAccount).filter(InstagramAccount.instagram_account_id == resolved_ig_id).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account already connected"
        )

    new_account = InstagramAccount(
        user_id=current_user.id,
        instagram_username_or_email=resolved_username,
        encrypted_password=encrypt_token(account_data.password),
        encrypted_access_token=encrypt_token(account_data.access_token),
        instagram_account_id=resolved_ig_id,
        facebook_page_id=resolved_page_id,
        token_expiry_time=resolved_expiry,
        status="ACTIVE",
        last_login_status="NEVER_LOGGED",
        last_publish_status="NEVER_PUBLISHED"
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_ADD",
        description=f"User {current_user.username} connected Instagram credentials for: {new_account.instagram_username_or_email}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return new_account

@app.put("/accounts/{account_id}", response_model=InstagramAccountResponse)
def admin_update_account(account_id: int, account_data: InstagramAccountCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Allow Super Admin to update Instagram username/email and passwords directly."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Instagram account not found.")

    # Validate access token before updating using the Verification Agent
    from .instagram import InstagramClient
    verification_res = InstagramClient.verify_and_resolve_account(
        username=account_data.instagram_username_or_email,
        access_token=account_data.access_token,
        facebook_page_id=account_data.facebook_page_id
    )
    
    if verification_res["status"] == "rejected":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Access token validation failed: {verification_res['reason']}"
        )
        
    resolved_ig_id = verification_res["instagram_account_id"]
    resolved_page_id = verification_res["facebook_page_id"]
    resolved_username = verification_res["username"]
    resolved_expiry = verification_res["token_expiry_time"]

    # Check duplicate Instagram Account ID in database (excluding the account currently being updated)
    duplicate = db.query(InstagramAccount).filter(
        InstagramAccount.instagram_account_id == resolved_ig_id,
        InstagramAccount.id != account_id
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account already connected"
        )

    account.instagram_username_or_email = resolved_username
    account.encrypted_password = encrypt_token(account_data.password)
    account.encrypted_access_token = encrypt_token(account_data.access_token)
    account.instagram_account_id = resolved_ig_id
    account.facebook_page_id = resolved_page_id
    account.token_expiry_time = resolved_expiry
    account.status = "ACTIVE"  # Reset
    account.last_login_status = "NEVER_LOGGED"
    account.last_publish_status = "NEVER_PUBLISHED"
    
    db.commit()
    db.refresh(account)

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_UPDATE",
        description=f"Super Admin updated Instagram credentials directly for account ID {account.id} ({account.instagram_username_or_email}).",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return account

@app.delete("/accounts/{account_id}")
def admin_delete_account(account_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Allow Super Admin to delete Instagram account credentials."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Instagram account not found.")

    username_email = account.instagram_username_or_email
    db.delete(account)
    db.commit()

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_DELETE",
        description=f"Super Admin deleted Instagram credentials for: {username_email} (ID: {account_id}).",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"Instagram credentials for {username_email} removed successfully."}

# --- Credential Update Request Routes ---

@app.post("/credential-requests", response_model=CredentialUpdateRequestResponse)
def create_credential_request(req_data: CredentialUpdateRequestCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Submit a request to update Instagram credentials. Bypasses direct updates for users."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    if req_data.instagram_account_id:
        acc = db.query(InstagramAccount).filter(
            InstagramAccount.id == req_data.instagram_account_id,
            InstagramAccount.user_id == current_user.id
        ).first()
        if not acc:
            raise HTTPException(status_code=404, detail="Instagram account not found.")

    # Validate access token using the Verification Agent if provided
    resolved_page_id = req_data.facebook_page_id
    if req_data.requested_access_token:
        from .instagram import InstagramClient
        verification_res = InstagramClient.verify_and_resolve_account(
            username=req_data.requested_username_or_email,
            access_token=req_data.requested_access_token,
            facebook_page_id=req_data.facebook_page_id
        )
        if verification_res["status"] == "rejected":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Access token validation failed: {verification_res['reason']}"
            )
            
        resolved_ig_id = verification_res["instagram_account_id"]
        resolved_page_id = verification_res["facebook_page_id"]

        # Check duplicate Instagram Account ID in database (excluding the current account being updated)
        duplicate = db.query(InstagramAccount).filter(
            InstagramAccount.instagram_account_id == resolved_ig_id,
            InstagramAccount.id != req_data.instagram_account_id
        ).first()
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account already connected"
            )

    new_request = CredentialUpdateRequest(
        user_id=current_user.id,
        instagram_account_id=req_data.instagram_account_id,
        requested_username_or_email=req_data.requested_username_or_email,
        requested_password=req_data.requested_password, # Plain text stored here for admin inspection
        requested_access_token=req_data.requested_access_token,
        facebook_page_id=resolved_page_id,
        reason=req_data.reason,
        status="Pending"
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    create_audit_log(
        db=db,
        action="CREDENTIAL_REQUEST_SUBMIT",
        description=f"User {current_user.username} submitted credential update request for: {new_request.requested_username_or_email}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return new_request

@app.get("/credential-requests", response_model=List[CredentialUpdateRequestResponse])
def get_credential_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Track credential requests. Standard users see their own; Super Admin views all."""
    if current_user.role == "Super Admin":
        return db.query(CredentialUpdateRequest).order_by(CredentialUpdateRequest.id.desc()).all()
    return db.query(CredentialUpdateRequest).filter(CredentialUpdateRequest.user_id == current_user.id).order_by(CredentialUpdateRequest.id.desc()).all()

@app.put("/credential-requests/{req_id}", response_model=CredentialUpdateRequestResponse)
def process_credential_request(req_id: int, process_data: CredentialUpdateRequestProcess, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Super Admin reviews, comments, and approves/rejects credential requests. Updates target account tokens upon approval."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    req = db.query(CredentialUpdateRequest).filter(CredentialUpdateRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")

    req.status = process_data.status
    req.admin_comments = process_data.admin_comments
    
    # If approved and linked to an account, automatically update the account credentials
    if process_data.status == "Approved" and req.instagram_account_id:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == req.instagram_account_id).first()
        if acc:
            # Validate requested access token if provided
            if req.requested_access_token:
                from .instagram import InstagramClient
                verification_res = InstagramClient.verify_and_resolve_account(
                    username=req.requested_username_or_email,
                    access_token=req.requested_access_token,
                    facebook_page_id=req.facebook_page_id
                )
                if verification_res["status"] == "rejected":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Access token validation failed: {verification_res['reason']}"
                    )
                
                resolved_ig_id = verification_res["instagram_account_id"]
                resolved_page_id = verification_res["facebook_page_id"]
                resolved_username = verification_res["username"]
                resolved_expiry = verification_res["token_expiry_time"]

                # Check duplicate Instagram Account ID in database (excluding the target account)
                duplicate = db.query(InstagramAccount).filter(
                    InstagramAccount.instagram_account_id == resolved_ig_id,
                    InstagramAccount.id != req.instagram_account_id
                ).first()
                if duplicate:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Account already connected"
                    )

                acc.instagram_username_or_email = resolved_username
                acc.instagram_account_id = resolved_ig_id
                acc.facebook_page_id = resolved_page_id
                acc.token_expiry_time = resolved_expiry
                acc.encrypted_access_token = encrypt_token(req.requested_access_token)
            else:
                acc.instagram_username_or_email = req.requested_username_or_email

            if req.requested_password:
                acc.encrypted_password = encrypt_token(req.requested_password)
            acc.status = "ACTIVE"  # Reset
            acc.last_login_status = "NEVER_LOGGED"
            acc.last_publish_status = "NEVER_PUBLISHED"
            db.commit()

    db.commit()
    db.refresh(req)

    create_audit_log(
        db=db,
        action=f"CREDENTIAL_REQUEST_{process_data.status.upper()}",
        description=f"Super Admin processed credential request ID {req_id} for {req.requested_username_or_email} -> {process_data.status}.",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return req

# --- Publishing & History Routes ---

@app.post("/upload-media")
def upload_media(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """Upload media file. Returns local storage path and public URL."""
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
        
    public_url = f"{settings.PUBLIC_URL_PREFIX.rstrip('/')}/{unique_filename}"
    return {
        "filename": unique_filename,
        "media_path": file_path,
        "public_url": public_url
    }

@app.post("/publish", status_code=status.HTTP_202_ACCEPTED)
def publish_post(pub_request: PublishRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Publish to one or more accounts. Creates a Post record per selected account and queues the job."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not current_user.publishing_permission:
        raise HTTPException(status_code=403, detail="Your publishing permissions have been revoked by the Super Admin.")

    if not pub_request.account_ids:
        raise HTTPException(status_code=400, detail="Must select at least one Instagram account.")

    # Validate media file exists
    if not os.path.exists(pub_request.media_path):
        fallback = os.path.join(UPLOAD_DIR, os.path.basename(pub_request.media_path))
        if os.path.exists(fallback):
            pub_request.media_path = fallback
        else:
            raise HTTPException(status_code=400, detail="Media file not found on server.")

    created_post_ids = []
    job_id = str(uuid.uuid4())
    
    import redis
    import json
    
    for acc_id in pub_request.account_ids:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == acc_id).first()
        if not acc:
            raise HTTPException(status_code=404, detail=f"Account ID {acc_id} does not exist.")
            
        new_post = Post(
            user_id=current_user.id,
            instagram_account_id=acc_id,
            media_path=pub_request.media_path,
            caption=pub_request.caption,
            hashtags=pub_request.hashtags,
            publish_status="Queued",
            progress_percent=10,
            job_id=job_id
        )
        db.add(new_post)
        db.commit()
        db.refresh(new_post)
        created_post_ids.append(new_post.id)

        # Broadcast initial progress to Redis
        try:
            r = redis.Redis.from_url(settings.REDIS_URL)
            payload = {
                "post_id": new_post.id,
                "job_id": new_post.job_id,
                "instagram_account_id": new_post.instagram_account_id,
                "status": "Queued",
                "progress_percent": 10,
                "failure_reason": None,
                "updated_at": new_post.created_at.isoformat()
            }
            r.publish("instagram_publish_progress", json.dumps(payload))
            r.close()
        except Exception as e:
            print(f"[Redis Warning] Failed to publish initial progress: {e}")

        # Trigger background execution for this specific post
        publish_post_task.delay(new_post.id)

    create_audit_log(
        db=db,
        action="PUBLISH_QUEUE",
        description=f"User {current_user.username} queued publication for post IDs: {created_post_ids} in job {job_id}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {
        "message": "Publishing started successfully. You can monitor real-time progress in the Publishing Progress panel.",
        "post_ids": created_post_ids,
        "job_id": job_id
    }

@app.get("/publish-history", response_model=List[PostResponse])
def get_publish_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve publishing history. Standard users see their own; Super Admin views all."""
    if current_user.role == "Super Admin":
        posts = db.query(Post).order_by(Post.created_at.desc()).all()
    else:
        posts = db.query(Post).filter(Post.user_id == current_user.id).order_by(Post.created_at.desc()).all()

    # Append instagram username/email dynamically
    res = []
    for p in posts:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == p.instagram_account_id).first()
        username = acc.instagram_username_or_email if acc else f"Unknown Account ({p.instagram_account_id})"
        
        res.append({
            "id": p.id,
            "user_id": p.user_id,
            "instagram_account_id": p.instagram_account_id,
            "instagram_username": username,
            "media_path": p.media_path,
            "caption": p.caption,
            "hashtags": p.hashtags,
            "publish_status": p.publish_status,
            "failure_reason": p.failure_reason,
            "job_id": p.job_id,
            "progress_percent": p.progress_percent,
            "created_at": p.created_at,
            "updated_at": p.updated_at
        })
    return res


@app.get("/publish-progress/stream")
async def publish_progress_stream(request: Request):
    """
    Server-Sent Events (SSE) streaming endpoint that broadcasts real-time 
    publishing progress events using Redis Pub/Sub.
    """
    import redis.asyncio as aioredis
    import json
    import asyncio
    from fastapi.responses import StreamingResponse

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


@app.post("/publish/{post_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_post(post_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Resets the status of a failed post to 'Queued' (10% progress),
    clears failure_reason, broadcasts the event to Redis, and re-queues Celery task.
    """
    import datetime
    import redis
    import json
    
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not current_user.publishing_permission:
        raise HTTPException(status_code=403, detail="Your publishing permissions have been revoked by the Super Admin.")

    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")

    if current_user.role != "Super Admin" and post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to retry this post.")

    # Reset post status and progress
    post.publish_status = "Queued"
    post.progress_percent = 10
    post.failure_reason = None
    post.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(post)

    # Broadcast initial progress to Redis
    try:
        r = redis.Redis.from_url(settings.REDIS_URL)
        payload = {
            "post_id": post.id,
            "job_id": post.job_id,
            "instagram_account_id": post.instagram_account_id,
            "status": "Queued",
            "progress_percent": 10,
            "failure_reason": None,
            "updated_at": post.updated_at.isoformat()
        }
        r.publish("instagram_publish_progress", json.dumps(payload))
        r.close()
    except Exception as e:
        print(f"[Redis Warning] Failed to publish retry progress: {e}")

    # Re-trigger background execution for this post
    publish_post_task.delay(post.id)

    create_audit_log(
        db=db,
        action="PUBLISH_RETRY",
        description=f"User {current_user.username} retried publication for post ID: {post.id} (Job ID: {post.job_id})",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {
        "message": "Publishing retried successfully. You can monitor progress in the panel.",
        "post_id": post.id,
        "job_id": post.job_id
    }

# --- Super Admin Management Routes ---

@app.get("/users", response_model=List[UserResponse])
def admin_get_users(db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """List all registered users. Super Admin only."""
    return db.query(User).filter(User.role != "Super Admin").order_by(User.id.asc()).all()

@app.post("/users/{user_id}/approve")
def admin_approve_user(user_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Approve a user registration request. Super Admin only."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.status = "Approved"
    db.commit()

    create_audit_log(
        db=db,
        action="USER_APPROVE",
        description=f"Super Admin approved registration request for user: {user.username}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"User {user.username} approved successfully."}

@app.post("/users/{user_id}/reject")
def admin_reject_user(user_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Reject a user registration request. Super Admin only."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    user.status = "Rejected"
    db.commit()

    create_audit_log(
        db=db,
        action="USER_REJECT",
        description=f"Super Admin rejected registration request for user: {user.username}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"User {user.username} rejected successfully."}

@app.put("/users/{user_id}/status")
def admin_set_user_status(user_id: int, status_data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Deactivate or Activate user accounts. Super Admin only."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    new_status = status_data.get("status")
    if new_status not in ["Approved", "Deactivated"]:
        raise HTTPException(status_code=400, detail="Invalid status option.")

    target_user.status = new_status
    db.commit()

    create_audit_log(
        db=db,
        action=f"USER_{new_status.upper()}",
        description=f"Super Admin changed user {target_user.username} status to {new_status}.",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"User {target_user.username} status updated to {new_status}."}

@app.put("/users/{user_id}/permissions")
def admin_toggle_permissions(user_id: int, perm_data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Grant or revoke publishing permissions. Super Admin only."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")

    grant = perm_data.get("publishing_permission", True)
    target_user.publishing_permission = grant
    db.commit()

    action_name = "GRANT_PUBLISH" if grant else "REVOKE_PUBLISH"
    create_audit_log(
        db=db,
        action=action_name,
        description=f"Super Admin set publishing permission for {target_user.username} to {grant}.",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"Publishing permissions for {target_user.username} updated."}

@app.get("/logs", response_model=List[LogResponse])
def get_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve audit logs. Standard users see their own; Super Admin views all."""
    if current_user.role == "Super Admin":
        logs = db.query(Log).order_by(Log.created_at.desc()).limit(200).all()
    else:
        logs = db.query(Log).filter(Log.user_id == current_user.id).order_by(Log.created_at.desc()).limit(100).all()

    # Hydrate usernames
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
    """Retrieve audit logs for a specific post. Standard users see their own; Super Admin views all."""
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    
    if current_user.role != "Super Admin" and post.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view these logs.")
        
    logs = db.query(Log).filter(
        (Log.description.like(f"%post {post_id}%")) | 
        (Log.description.like(f"%post ID: {post_id}%")) | 
        (Log.description.like(f"%post ID {post_id}%"))
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
