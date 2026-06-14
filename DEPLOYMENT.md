# Deployment and Setup Guide

This guide details launching the **Agent Karuppu** platform locally using Docker Compose, configuring Facebook Page and Instagram Graph API integrations, and using development settings for testing.

---

## 1. Quick Start (Local Docker Orchestration)

To spin up all services (PostgreSQL, Redis, FastAPI Backend, Celery Worker, React Dashboard), perform the following:

### Step A: Clone and Configure Environment
Copy the configuration template to a live environment file:
```bash
cp .env.example .env
```
Open `.env` and fill in:
- `OPENAI_API_KEY`: Required for CrewAI optimization and validations.
- `ENCRYPTION_KEY`: A 32-byte url-safe base64 key for encrypting Instagram tokens. Generate one using:
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```

### Step B: Launch Containers
Run docker-compose to build and start the cluster:
```bash
docker-compose up --build
```

### Step C: Access Dashboard Interfaces
- **React Frontend**: [http://localhost:3000](http://localhost:3000)
- **FastAPI API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Postgres Database**: `localhost:5432` (User: `postgres`, Password: `postgres`, DB: `agent_karuppu`)
- **Redis Queue Console**: `localhost:6379`

### Step D: Login
Use the default administrator credentials seeded automatically on startup:
- **Username**: `admin`
- **Password**: `admin123`

---

## 2. Instagram Graph API Setup Configuration

To publish posts to live Instagram accounts, you must configure a Facebook App:

### Requirements:
1. **Instagram Account**: Must be an **Instagram Professional Account** (Business or Creator type).
2. **Facebook Page**: Must be linked to the Instagram Professional Account (via Page Settings -> Linked Accounts).
3. **Facebook Developer App**: Create an App of type **Business** on the [Facebook Developer Portal](https://developers.facebook.com/).

### Permissions Needed:
Your Facebook App must request and be granted these permissions:
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`

### Acquiring Access Tokens:
1. Go to the **Graph API Explorer** in the Meta Developer Console.
2. Select your App.
3. Select **User Token**, add the permissions above, and click **Generate Access Token**.
4. In production, exchange this temporary token for a **Long-Lived User Access Token** (60 days) or a **Long-Lived Page Access Token** (never expires) using Meta's access token endpoints.
5. Provide this Token to the Publisher application in the "IG Accounts" panel.

---

## 3. Development / Mock Testing Mode

If you do not have a Meta Developer App, or want to test the full loop without live API calls, you can use **Mock Mode**:

1. Log in to the dashboard at [http://localhost:3000](http://localhost:3000).
2. Click **IG Accounts** in the sidebar.
3. Click **Add IG Account**.
4. Enter any username (e.g. `mock_creative_feed`).
5. In the **Facebook Page Access Token** field, enter a token starting with `mock_` (e.g., `mock_token_12345`).
6. Click **Save Account**.
7. Go back to the **Dashboard** panel.
8. Upload a test image/video, write a caption, select your mock account, and click **Publish**.
9. The backend will bypass live Graph API connections, simulate the two-step media container publishing, write logs to the DB, and complete the publication successfully.

---

## 4. Production Considerations

When deploying this system to production, configure the following:

- **Tokens Encryption Key**: Never commit or share your `ENCRYPTION_KEY`. Ensure it is set securely in your production environment config.
- **Media Hosting (S3 / Cloud Storage)**: The Instagram Graph API requires media to be fetched from a public URL. In production, change the FastAPI media saver to upload directly to Amazon S3 or Google Cloud Storage, and update `PUBLIC_URL_PREFIX` to point to your bucket endpoint.
- **SSL / HTTPS**: Facebook Graph API requires HTTPS urls for media downloads. Setup a Let's Encrypt SSL certificate or cloud load balancer (like AWS ALB or Cloudflare CDN).
- **Celery Worker Scaling**: For high throughput, scale up the number of Celery worker processes by running:
  ```bash
  docker-compose up --scale celery_worker=3 -d
  ```
- **JWT Secret**: Change `JWT_SECRET_KEY` to a random, long hexadecimal string.
