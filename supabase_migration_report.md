# Supabase Storage Configuration & Placeholder Fix Report

**Date**: July 20, 2026  
**Bucket Name**: `Karuppu`  

---

## 1. Root Cause Analysis

### Identified Issue
When media files were uploaded, Python threw a DNS resolution error:
```
HTTPSConnectionPool(
    host='your-supabase-project.supabase.co',
    port=443
)
Failed to resolve 'your-supabase-project.supabase.co'
```

### Technical Cause
In `backend/app/config.py` at line 47:
```python
SUPABASE_URL: str = "https://your-supabase-project.supabase.co"
```
When `SUPABASE_URL` was not passed in Render environment variables, Pydantic's `BaseSettings` fell back to `https://your-supabase-project.supabase.co`. Attempting HTTP POST requests to `https://your-supabase-project.supabase.co/storage/v1/object/Karuppu/...` failed because `your-supabase-project.supabase.co` is a placeholder domain that does not exist in DNS.

---

## 2. Code Changes Made

### A. Config Cleanup (`backend/app/config.py`)
- Removed `https://your-supabase-project.supabase.co` default.
- Set `SUPABASE_URL: str = ""`.
- Retained default bucket `SUPABASE_STORAGE_BUCKET: str = "Karuppu"`.

### B. Pre-Flight Credential Validation (`backend/app/supabase_storage.py`)
Added pre-flight validation before executing HTTP requests:
```python
base_url = (settings.SUPABASE_URL or "").strip().rstrip('/')
supabase_key = (settings.SUPABASE_KEY or "").strip()

if not base_url or "your-supabase-project" in base_url or "placeholder" in base_url or not supabase_key:
    error_msg = (
        "Supabase Storage Unconfigured: SUPABASE_URL and SUPABASE_KEY environment variables are missing or invalid on Render. "
        "Please set SUPABASE_URL (e.g. https://xyz.supabase.co) and SUPABASE_KEY in your Render dashboard environment settings."
    )
    logger.error(f"[Supabase Storage Config Error] {error_msg}")
    raise Exception(error_msg)
```

### C. Environment Configuration (`.env`)
Added explicit Supabase environment keys:
```env
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_STORAGE_BUCKET=Karuppu
```

---

## 3. Required Environment Variables on Render

To enable cloud media uploads, configure these environment variables in your Render Web Service Dashboard:

| Key | Example Value | Description |
|---|---|---|
| `SUPABASE_URL` | `https://abcdefghijkl.supabase.co` | Your Supabase project URL |
| `SUPABASE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI...` | Your Supabase Service Role Key or Anon Key |
| `SUPABASE_STORAGE_BUCKET` | `Karuppu` | Storage bucket name |
