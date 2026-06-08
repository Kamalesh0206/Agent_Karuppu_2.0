from datetime import datetime, timedelta
from typing import Optional, Union, Any
import bcrypt
from jose import jwt, JWTError
from cryptography.fernet import Fernet
from .config import settings

# Initialize Fernet cipher
try:
    cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception as e:
    # Fallback key generation for resilience in environments with config issues
    # Note: In production, settings.ENCRYPTION_KEY must be a stable 32-byte base64-encoded key.
    import base64
    fallback_key = base64.urlsafe_b64encode(b"a_stable_32_byte_fallback_key_12")
    cipher_suite = Fernet(fallback_key)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    # Generate salt and hash using bcrypt directly
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None

def encrypt_token(token: str) -> str:
    """Encrypt a sensitive token using Fernet symmetric encryption."""
    if not token:
        return ""
    encrypted_bytes = cipher_suite.encrypt(token.encode())
    return encrypted_bytes.decode()

def decrypt_token(encrypted_token: str) -> str:
    """Decrypt an encrypted token using Fernet symmetric encryption."""
    if not encrypted_token:
        return ""
    decrypted_bytes = cipher_suite.decrypt(encrypted_token.encode())
    return decrypted_bytes.decode()
