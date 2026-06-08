import os
import shutil
import uuid
from typing import List
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, SessionLocal, get_db
from .models import User, Account, Post, PostAccount, Log
from .schemas import (
    UserLogin, Token, UserResponse, UserCreate,
    AccountCreate, AccountUpdate, AccountResponse,
    PublishRequest, PostResponse, PostDetailResponse,
    PostAccountResponse, LogResponse
)
from .security import verify_password, get_password_hash, create_access_token, decode_access_token, encrypt_token
from .tasks import publish_post_task

# Initialize FastAPI App
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Backend server for managing multi-account Instagram publishing via CrewAI Agents.",
    version="1.0.0"
)

# CORS Configuration
# Adjust origins in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Upload directory configuration
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")

# Serve uploaded media statically
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")), name="static")

# OAuth2 schema for Swagger UI and token validation
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

# Startup database initialization & seeding
@app.on_event("startup")
def startup_db_setup():
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Seed default admin user if it doesn't exist
        admin = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
        if not admin:
            admin_user = User(
                username=settings.ADMIN_USERNAME,
                password_hash=get_password_hash(settings.ADMIN_PASSWORD),
                role="admin"
            )
            db.add(admin_user)
            db.commit()
            
            # Log startup seed
            log = Log(
                action="SYSTEM_SEED",
                message="Database initialized. Default admin account seeded."
            )
            db.add(log)
            db.commit()
    finally:
        db.close()

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
    return user

def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Admin privileges required."
        )
    return current_user

# --- Authentication Routes ---

@app.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user (admin or standard user) in the system."""
    # Check if username is already registered
    existing = db.query(User).filter(User.username == user_data.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered."
        )

    # Hash the password and create user object
    new_user = User(
        username=user_data.username,
        password_hash=get_password_hash(user_data.password),
        role=user_data.role or "user"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Add audit log
    log = Log(
        action="USER_SIGNUP",
        message=f"New user signed up: {new_user.username} with role: {new_user.role}"
    )
    db.add(log)
    db.commit()

    return new_user

@app.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    """Authenticate user credentials and return a signed JWT token."""
    user = db.query(User).filter(User.username == login_data.username).first()
    if not user or not verify_password(login_data.password, user.password_hash):
        # Register failed attempt
        log = Log(
            action="AUTH_FAIL",
            message=f"Failed login attempt for username: {login_data.username}"
        )
        db.add(log)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Register success log
    log = Log(
        action="AUTH_SUCCESS",
        message=f"User {user.username} logged in successfully."
    )
    db.add(log)
    db.commit()

    access_token = create_access_token(data={"username": user.username, "role": user.role})
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

# --- Instagram Account Routes ---

@app.post("/accounts", response_model=AccountResponse)
def create_account(account_data: AccountCreate, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """Add a new Instagram business account page token (Encrypted before storage)."""
    # Check if duplicate username
    existing = db.query(Account).filter(Account.username == account_data.username).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Account '{account_data.username}' already exists."
        )
    
    encrypted_token = encrypt_token(account_data.access_token)
    new_account = Account(
        username=account_data.username,
        access_token=encrypted_token,
        status="ACTIVE"
    )
    db.add(new_account)
    db.commit()
    db.refresh(new_account)
    
    # Audit log
    log = Log(
        action="CREATE_ACCOUNT",
        message=f"Admin {current_user.username} added account: {new_account.username}"
    )
    db.add(log)
    db.commit()
    
    return new_account

@app.get("/accounts", response_model=List[AccountResponse])
def get_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all registered Instagram accounts."""
    return db.query(Account).order_by(Account.id.asc()).all()

@app.put("/accounts/{account_id}", response_model=AccountResponse)
def update_account(
    account_id: int, 
    account_data: AccountUpdate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_admin_user)
):
    """Modify account username, access token, or active status."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    
    if account_data.username is not None:
        account.username = account_data.username
    if account_data.access_token is not None and account_data.access_token != "":
        account.access_token = encrypt_token(account_data.access_token)
    if account_data.status is not None:
        account.status = account_data.status
        
    db.commit()
    db.refresh(account)
    
    # Audit log
    log = Log(
        action="UPDATE_ACCOUNT",
        message=f"Admin {current_user.username} updated account {account.username} (ID: {account.id})."
    )
    db.add(log)
    db.commit()
    
    return account

@app.delete("/accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_admin_user)):
    """Remove an Instagram account from the database."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    
    username = account.username
    db.delete(account)
    db.commit()
    
    # Audit log
    log = Log(
        action="DELETE_ACCOUNT",
        message=f"Admin {current_user.username} deleted account {username} (ID: {account_id})."
    )
    db.add(log)
    db.commit()
    
    return {"message": f"Account {username} deleted successfully."}

# --- Media and Publishing Routes ---

@app.post("/upload-media")
def upload_media(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """
    Upload an image or video file. Saves it locally and returns the path 
    and constructed public URL.
    """
    # Validate extension
    file_ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = [".jpg", ".jpeg", ".png", ".mp4", ".mov"]
    if file_ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Allowed: JPG, PNG, MP4, MOV."
        )

    # Make unique filename
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
def publish_post(request: PublishRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Publish a post to multiple accounts simultaneously. 
    Inserts PENDING history rows and queues the job in Celery.
    """
    if not request.account_ids:
        raise HTTPException(status_code=400, detail="Must select at least one Instagram account.")

    # Validate file exists locally
    if not os.path.exists(request.media_path):
        # Check if it is a simple filename rather than absolute path
        fallback = os.path.join(UPLOAD_DIR, os.path.basename(request.media_path))
        if os.path.exists(fallback):
            request.media_path = fallback
        else:
            raise HTTPException(status_code=400, detail=f"Media file not found: {request.media_path}")

    # 1. Create the main Post record
    new_post = Post(
        media_path=request.media_path,
        caption=request.caption,
        hashtags=request.hashtags
    )
    db.add(new_post)
    db.commit()
    db.refresh(new_post)

    # 2. Add pending publishing status rows for each targeted account
    for acc_id in request.account_ids:
        # Verify account validity
        acc = db.query(Account).filter(Account.id == acc_id).first()
        if not acc:
            raise HTTPException(status_code=404, detail=f"Target account ID {acc_id} does not exist.")
            
        post_acc = PostAccount(
            post_id=new_post.id,
            account_id=acc_id,
            publish_status="PENDING"
        )
        db.add(post_acc)
        
    db.commit()

    # Log action
    log = Log(
        action="PUBLISH_QUEUE",
        message=f"Post ID {new_post.id} queued by user {current_user.username} for accounts: {request.account_ids}"
    )
    db.add(log)
    db.commit()

    # 3. Offload to Celery worker
    task = publish_post_task.delay(new_post.id, request.account_ids)
    
    return {
        "message": "Publishing job successfully queued.",
        "post_id": new_post.id,
        "task_id": task.id
    }

@app.get("/publish-history", response_model=List[PostDetailResponse])
def get_publish_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Retrieve history of all publications and their per-account statuses."""
    posts = db.query(Post).order_by(Post.created_at.desc()).all()
    
    detailed_history = []
    for p in posts:
        post_accounts = db.query(PostAccount).filter(PostAccount.post_id == p.id).all()
        destinations = []
        
        for pa in post_accounts:
            account = db.query(Account).filter(Account.id == pa.account_id).first()
            username = account.username if account else f"Unknown ({pa.account_id})"
            
            destinations.append(
                PostAccountResponse(
                    id=pa.id,
                    post_id=pa.post_id,
                    account_id=pa.account_id,
                    account_username=username,
                    publish_status=pa.publish_status,
                    published_at=pa.published_at,
                    error_message=pa.error_message
                )
            )
        
        detailed_history.append(
            PostDetailResponse(
                id=p.id,
                media_path=p.media_path,
                caption=p.caption,
                hashtags=p.hashtags,
                created_at=p.created_at,
                destinations=destinations
            )
        )
        
    return detailed_history

@app.get("/logs", response_model=List[LogResponse])
def get_logs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List operational and audit log logs."""
    return db.query(Log).order_by(Log.created_at.desc()).limit(100).all()
