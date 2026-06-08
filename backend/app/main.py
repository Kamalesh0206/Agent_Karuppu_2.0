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
    UserLogin, UserCreate, VerifyOTPRequest, UserResponse, UserUpdate, ChangePasswordRequest,
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
    description="Backend server for Instagram Publishing Management Platform with RBAC, OTP, and Credential Requests.",
    version="2.0.0"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    # Drop and recreate all tables to ensure the database schema matches our SQLAlchemy models exactly
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
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

# --- Authentication & Registration Routes ---

@app.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    """Register a new standard user account. Super Admin creation is blocked."""
    # Prevent duplicate username, email, mobile_number
    if user_data.email.lower() == "agentkaruppuadmin@gmail.com":
        raise HTTPException(status_code=400, detail="Cannot register Super Admin email.")
        
    existing_username = db.query(User).filter(User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already registered.")
        
    existing_email = db.query(User).filter(User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email address already registered.")
        
    existing_mobile = db.query(User).filter(User.mobile_number == user_data.mobile_number).first()
    if existing_mobile:
        raise HTTPException(status_code=400, detail="Mobile number already registered.")

    # Generate random 6-digit verification codes
    email_otp = f"{random.randint(100000, 999999)}"
    mobile_otp = f"{random.randint(100000, 999999)}"

    # Create new User
    new_user = User(
        full_name=user_data.full_name,
        email=user_data.email,
        mobile_number=user_data.mobile_number,
        username=user_data.username,
        password_hash=get_password_hash(user_data.password),
        role="User",
        status="Pending Approval",
        email_verified=False,
        mobile_verified=False,
        publishing_permission=True,
        email_otp=email_otp,
        mobile_otp=mobile_otp
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Print OTPs to console log for development testing convenience
    print("\n" + "="*50)
    print(f"VERIFICATION CODES GENERATED FOR: {new_user.username}")
    print(f"Email OTP:  {email_otp}")
    print(f"Mobile OTP: {mobile_otp}")
    print("="*50 + "\n")

    client_ip = request.client.host if request.client else "127.0.0.1"

    # Audit log
    create_audit_log(
        db=db,
        action="USER_SIGNUP",
        description=f"User registered: {new_user.username}. OTP codes generated. Email OTP: {email_otp}, Mobile OTP: {mobile_otp}",
        user_id=new_user.id,
        ip_address=client_ip
    )

    return new_user

@app.post("/verify-otp")
def verify_otp(verify_data: VerifyOTPRequest, request: Request, db: Session = Depends(get_db)):
    """Verify standard user's email and mobile OTP codes."""
    user = db.query(User).filter(User.username == verify_data.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if user.email_verified and user.mobile_verified:
        return {"message": "Account is already verified."}

    # Verify codes
    if user.email_otp != verify_data.email_otp or user.mobile_otp != verify_data.mobile_otp:
        raise HTTPException(status_code=400, detail="Invalid verification code(s).")

    # Mark verified
    user.email_verified = True
    user.mobile_verified = True
    user.email_otp = None
    user.mobile_otp = None
    db.commit()

    client_ip = request.client.host if request.client else "127.0.0.1"

    create_audit_log(
        db=db,
        action="USER_VERIFICATION",
        description=f"User {user.username} verified email and mobile OTPs successfully.",
        user_id=user.id,
        ip_address=client_ip
    )

    return {"message": "Verification successful. Your account is now pending approval by the Super Admin."}

@app.post("/login", response_model=Token)
def login(login_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    """Authenticate credentials. Restricts unverified or unapproved users from logging in."""
    user = db.query(User).filter(
        (User.username == login_data.username) | (User.email == login_data.username)
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

    # Check verification
    if not user.email_verified or not user.mobile_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account unverified. Please complete email and mobile verification."
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
    
    if profile_data.email:
        # Check duplicate email
        existing = db.query(User).filter(User.email == profile_data.email, User.id != current_user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email address already in use.")
        current_user.email = profile_data.email

    if profile_data.mobile_number:
        # Check duplicate mobile number
        existing = db.query(User).filter(User.mobile_number == profile_data.mobile_number, User.id != current_user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Mobile number already in use.")
        current_user.mobile_number = profile_data.mobile_number

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

# --- Instagram Account Routes ---

@app.get("/accounts", response_model=List[InstagramAccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List connected Instagram accounts. Standard users see their own; Super Admin sees all."""
    if current_user.role == "Super Admin":
        return db.query(InstagramAccount).order_by(InstagramAccount.id.asc()).all()
    return db.query(InstagramAccount).filter(InstagramAccount.user_id == current_user.id).order_by(InstagramAccount.id.asc()).all()

@app.post("/accounts", response_model=InstagramAccountResponse)
def create_account(account_data: InstagramAccountCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Add a new Instagram account. Tokens are encrypted prior to storage."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    # Duplication check
    existing = db.query(InstagramAccount).filter(
        InstagramAccount.instagram_username == account_data.instagram_username,
        InstagramAccount.user_id == current_user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Account @{account_data.instagram_username} already connected.")

    new_account = InstagramAccount(
        user_id=current_user.id,
        instagram_username=account_data.instagram_username,
        access_token=encrypt_token(account_data.access_token),
        refresh_token=encrypt_token(account_data.refresh_token) if account_data.refresh_token else None,
        status="ACTIVE"
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_ADD",
        description=f"User {current_user.username} connected Instagram account: @{new_account.instagram_username}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return new_account

@app.put("/accounts/{account_id}", response_model=InstagramAccountResponse)
def admin_update_account(account_id: int, account_data: InstagramAccountCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_super_admin)):
    """Allow Super Admin to update Instagram account details directly."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    account = db.query(InstagramAccount).filter(InstagramAccount.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Instagram account not found.")

    account.instagram_username = account_data.instagram_username
    account.access_token = encrypt_token(account_data.access_token)
    if account_data.refresh_token:
        account.refresh_token = encrypt_token(account_data.refresh_token)
    
    db.commit()
    db.refresh(account)

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_UPDATE",
        description=f"Super Admin updated Instagram account ID {account.id} (@{account.instagram_username}) directly.",
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

    username = account.instagram_username
    db.delete(account)
    db.commit()

    create_audit_log(
        db=db,
        action="IG_ACCOUNT_DELETE",
        description=f"Super Admin deleted Instagram account: @{username} (ID: {account_id}).",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {"message": f"Instagram account @{username} credentials removed successfully."}

# --- Credential Update Request Routes ---

@app.post("/credential-requests", response_model=CredentialUpdateRequestResponse)
def create_credential_request(req_data: CredentialUpdateRequestCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Submit a request to update Instagram credentials. Direct edits are blocked for standard users."""
    client_ip = request.client.host if request.client else "127.0.0.1"

    # If updating an existing account, check if it exists and belongs to the user
    if req_data.instagram_account_id:
        acc = db.query(InstagramAccount).filter(
            InstagramAccount.id == req_data.instagram_account_id,
            InstagramAccount.user_id == current_user.id
        ).first()
        if not acc:
            raise HTTPException(status_code=404, detail="Selected Instagram account not found.")

    new_request = CredentialUpdateRequest(
        user_id=current_user.id,
        instagram_account_id=req_data.instagram_account_id,
        requested_username=req_data.requested_username,
        requested_password=req_data.requested_password,
        requested_access_token=req_data.requested_access_token,
        requested_refresh_token=req_data.requested_refresh_token,
        reason=req_data.reason,
        status="Pending"
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    create_audit_log(
        db=db,
        action="CREDENTIAL_REQUEST_SUBMIT",
        description=f"User {current_user.username} submitted credential update request for @{new_request.requested_username}",
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
            acc.instagram_username = req.requested_username
            acc.access_token = encrypt_token(req.requested_access_token)
            if req.requested_refresh_token:
                acc.refresh_token = encrypt_token(req.requested_refresh_token)
            acc.status = "ACTIVE"  # Re-enable
            db.commit()

    db.commit()
    db.refresh(req)

    create_audit_log(
        db=db,
        action=f"CREDENTIAL_REQUEST_{process_data.status.upper()}",
        description=f"Super Admin processed credential request ID {req_id} for @{req.requested_username} -> {process_data.status}.",
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
    
    # Iterate and create a Post database row for each targeted account
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
            publish_status="Pending"
        )
        db.add(new_post)
        db.commit()
        db.refresh(new_post)
        created_post_ids.append(new_post.id)

        # Trigger background execution for this specific post
        publish_post_task.delay(new_post.id)

    create_audit_log(
        db=db,
        action="PUBLISH_QUEUE",
        description=f"User {current_user.username} queued publication for post IDs: {created_post_ids}",
        user_id=current_user.id,
        ip_address=client_ip
    )

    return {
        "message": "Publishing job(s) successfully queued.",
        "post_ids": created_post_ids
    }

@app.get("/publish-history", response_model=List[PostResponse])
def get_publish_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve publishing history. Standard users see their own; Super Admin views all."""
    if current_user.role == "Super Admin":
        posts = db.query(Post).order_by(Post.created_at.desc()).all()
    else:
        posts = db.query(Post).filter(Post.user_id == current_user.id).order_by(Post.created_at.desc()).all()

    # Append instagram username to responses dynamically for the frontend
    res = []
    for p in posts:
        acc = db.query(InstagramAccount).filter(InstagramAccount.id == p.instagram_account_id).first()
        username = acc.instagram_username if acc else f"Unknown Account ({p.instagram_account_id})"
        
        # Build schema response dict
        res.append({
            "id": p.id,
            "user_id": p.user_id,
            "instagram_account_id": p.instagram_account_id,
            "instagram_username": username,
            "media_path": p.media_path,
            "caption": p.caption,
            "hashtags": p.hashtags,
            "publish_status": p.publish_status,
            "created_at": p.created_at
        })
    return res

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

    # Hydrate usernames dynamically for the dashboard
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
