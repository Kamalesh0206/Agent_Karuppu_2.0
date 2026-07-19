import time
import os
import requests
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional
from .config import settings
from .database import SessionLocal
from .models import PublishingLog, AuditLog

logger = logging.getLogger("instagram_client")

class InstagramAPIError(Exception):
    """Custom exception for Instagram Graph API failures."""
    def __init__(self, message, status_code=None, fb_error_code=None, error_subcode=None, fbtrace_id=None, raw_response=None):
        super().__init__(message)
        self.status_code = status_code
        self.fb_error_code = fb_error_code
        self.error_subcode = error_subcode
        self.fbtrace_id = fbtrace_id
        self.raw_response = raw_response

class InstagramClient:
    GRAPH_API_VERSION = "v25.0"
    BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"

    @classmethod
    def _requests_retry_session(
        cls,
        retries=3,
        backoff_factor=1.5,
        status_forcelist=(500, 502, 503, 504),
        session=None,
    ):
        session = session or requests.Session()
        from urllib3.util import Retry
        from requests.adapters import HTTPAdapter
        retry = Retry(
            total=retries,
            read=retries,
            connect=retries,
            backoff_factor=backoff_factor,
            status_forcelist=status_forcelist,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount('http://', adapter)
        session.mount('https://', adapter)
        return session

    @classmethod
    def _log_request(
        cls,
        method: str,
        url: str,
        params: dict = None,
        json_data: dict = None,
        response: requests.Response = None,
        error: Exception = None,
        duration: float = 0.0,
        username: str = None,
        queue_id: int = None,
        retry_count: int = 0
    ):
        # Mask access token for security logs
        masked_params = {}
        if params:
            for k, v in params.items():
                if k == "access_token" and isinstance(v, str):
                    masked_params[k] = v[:6] + "..." if len(v) > 6 else "..."
                else:
                    masked_params[k] = v
        
        masked_json = {}
        if json_data:
            for k, v in json_data.items():
                if k == "access_token" and isinstance(v, str):
                    masked_json[k] = v[:6] + "..." if len(v) > 6 else "..."
                else:
                    masked_json[k] = v

        payload = masked_params or masked_json
        api_version = cls.GRAPH_API_VERSION
        
        log_msg = (
            f"[Instagram API Request]\n"
            f"  Graph API Version: {api_version}\n"
            f"  Method: {method.upper()}\n"
            f"  URL: {url}\n"
            f"  Request Payload (Excluding Token): {json.dumps(payload)}\n"
        )
        
        resp_text = None
        status_code = None
        fbtrace_id = None
        fb_code = None
        subcode = None
        msg = None
        container_id = None
        pub_status = "PENDING"

        if response is not None:
            status_code = response.status_code
            fbtrace_id = response.headers.get("x-fb-trace-id")
            
            try:
                resp_payload = response.json()
                resp_text = json.dumps(resp_payload)
                if response.status_code == 200:
                    pub_status = "SUCCESS"
                    container_id = resp_payload.get("id")
                else:
                    pub_status = "FAILED"
                    
                if "error" in resp_payload:
                    err_info = resp_payload["error"]
                    fb_code = str(err_info.get("code"))
                    subcode = str(err_info.get("error_subcode"))
                    msg = err_info.get("message")
            except Exception:
                resp_text = response.text
                resp_payload = response.text
                pub_status = "FAILED" if response.status_code != 200 else "SUCCESS"
            
            log_msg += (
                f"[Instagram API Response]\n"
                f"  Publishing Status: {pub_status}\n"
                f"  HTTP Status Code: {response.status_code}\n"
            )
            if container_id:
                log_msg += f"  Container/Media ID returned by Meta: {container_id}\n"
            if response.status_code != 200:
                log_msg += f"  Full Meta Error Response: {resp_text}\n"
            else:
                log_msg += f"  Response Payload: {resp_text}\n"
            
        if error is not None:
            log_msg += f"\n[Instagram API Error] Details: {str(error)}\n"
            msg = str(error)
        
        logger.info(log_msg)

        # Write attempt log to database if queue_id is supplied
        if queue_id:
            db = SessionLocal()
            try:
                db_log = PublishingLog(
                    queue_id=queue_id,
                    http_status=status_code,
                    meta_error_code=fb_code,
                    subcode=subcode,
                    message=msg,
                    fbtrace_id=fbtrace_id,
                    request_url=url,
                    request_body=json.dumps({"params": masked_params, "json": masked_json}),
                    response=resp_text,
                    timestamp=datetime.utcnow(),
                    retry_count=retry_count
                )
                db.add(db_log)
                db.commit()
            except Exception as db_err:
                logger.error(f"Failed to save detailed publishing log to database: {db_err}")
            finally:
                db.close()

    @classmethod
    def is_mock_token(cls, token: str) -> bool:
        if not token:
            return True
        token = token.strip()
        if token.startswith("mock_") or token == "development_token" or token.startswith("mock"):
            return True
        return False

    @classmethod
    def exchange_short_lived_token(cls, short_lived_token: str) -> dict:
        """
        Exchange a short-lived user access token for a long-lived user access token.
        """
        if cls.is_mock_token(short_lived_token):
            return {
                "access_token": "mock_long_lived_user_token",
                "expires_in": 5184000  # 60 days
            }

        url = f"{cls.BASE_URL}/oauth/access_token"
        params = {
            "grant_type": "fb_exchange_token",
            "client_id": settings.FACEBOOK_CLIENT_ID,
            "client_secret": settings.FACEBOOK_CLIENT_SECRET,
            "fb_exchange_token": short_lived_token
        }
        
        session = cls._requests_retry_session()
        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                err_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Token exchange failed: {err_data.get('message')}",
                    status_code=response.status_code,
                    fb_error_code=err_data.get("code"),
                    fbtrace_id=response.headers.get("x-fb-trace-id"),
                    raw_response=response.text
                )
            return response.json()
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error during long-lived token exchange: {str(e)}")

    @classmethod
    def get_long_lived_page_token(cls, long_lived_user_token: str, facebook_page_id: str) -> str:
        """
        Get a long-lived Page Access Token using the long-lived User Access Token.
        """
        if cls.is_mock_token(long_lived_user_token):
            return "mock_long_lived_page_token"

        url = f"{cls.BASE_URL}/{facebook_page_id}"
        params = {
            "fields": "access_token",
            "access_token": long_lived_user_token
        }
        session = cls._requests_retry_session()
        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                err_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Page token fetch failed: {err_data.get('message')}",
                    status_code=response.status_code,
                    fb_error_code=err_data.get("code"),
                    fbtrace_id=response.headers.get("x-fb-trace-id"),
                    raw_response=response.text
                )
            return response.json().get("access_token")
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error during page token retrieve: {str(e)}")

    @classmethod
    def get_instagram_profile_details(cls, instagram_business_id: str, access_token: str) -> dict:
        """
        Fetch Instagram Business profile details (name, username, profile picture, followers count).
        """
        if cls.is_mock_token(access_token):
            return {
                "username": "mock_instagram_user",
                "name": "Mock IG Business",
                "profile_picture_url": "https://placekitten.com/200/200",
                "followers_count": 1420
            }

        url = f"{cls.BASE_URL}/{instagram_business_id}"
        params = {
            "fields": "id,username,name,profile_picture_url,followers_count",
            "access_token": access_token
        }
        session = cls._requests_retry_session()
        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                err_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Profile fetch failed: {err_data.get('message')}",
                    status_code=response.status_code,
                    fb_error_code=err_data.get("code"),
                    fbtrace_id=response.headers.get("x-fb-trace-id"),
                    raw_response=response.text
                )
            data = response.json()
            return {
                "username": data.get("username"),
                "name": data.get("name"),
                "profile_picture_url": data.get("profile_picture_url"),
                "followers_count": data.get("followers_count", 0)
            }
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error fetching profile details: {str(e)}")

    @classmethod
    def verify_token_permissions(cls, access_token: str):
        if cls.is_mock_token(access_token):
            return

        url = f"{cls.BASE_URL}/me/permissions"
        params = {"access_token": access_token}
        session = cls._requests_retry_session()
        
        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                error_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Permissions check failed: {error_data.get('message')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    fbtrace_id=response.headers.get("x-fb-trace-id"),
                    raw_response=response.text
                )
            
            data = response.json().get("data", [])
            granted = {item.get("permission") for item in data if item.get("status") == "granted"}
            required = ["instagram_basic", "instagram_content_publish", "pages_show_list"]
            missing = [p for p in required if p not in granted]
            
            if missing:
                raise InstagramAPIError(f"Missing required permissions: {', '.join(missing)}")
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error during permissions check: {str(e)}")

    @classmethod
    def create_media_container(
        cls, 
        instagram_business_id: str, 
        media_url: str, 
        caption: str, 
        access_token: str, 
        is_video: bool = False,
        username: str = None,
        queue_id: int = None,
        retry_count: int = 0
    ) -> str:
        if cls.is_mock_token(access_token):
            return "18061733975707439"

        url = f"{cls.BASE_URL}/{instagram_business_id}/media"
        params = {
            "caption": caption,
            "access_token": access_token
        }
        if is_video:
            params["media_type"] = "REELS"
            params["video_url"] = media_url
        else:
            params["image_url"] = media_url

        session = cls._requests_retry_session(retries=0)
        start_time = time.time()
        try:
            cls._log_request("POST", url, params=params, username=username, queue_id=queue_id, retry_count=retry_count)
            response = session.post(url, params=params, timeout=20)
            duration = time.time() - start_time
            cls._log_request("POST", url, params=params, response=response, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            
            if response.status_code == 200:
                return response.json().get("id")
                
            error_data = response.json().get("error", {})
            raise InstagramAPIError(
                error_data.get("message", "Container creation failed"),
                status_code=response.status_code,
                fb_error_code=error_data.get("code"),
                error_subcode=error_data.get("error_subcode"),
                fbtrace_id=response.headers.get("x-fb-trace-id"),
                raw_response=response.text
            )
        except requests.exceptions.RequestException as e:
            duration = time.time() - start_time
            cls._log_request("POST", url, params=params, error=e, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            raise InstagramAPIError(f"Network error during media container creation: {str(e)}")

    @classmethod
    def check_container_status(cls, container_id: str, access_token: str, username: str = None, queue_id: int = None, retry_count: int = 0) -> dict:
        if cls.is_mock_token(access_token):
            return {"status_code": "FINISHED"}

        url = f"{cls.BASE_URL}/{container_id}"
        params = {
            "fields": "status_code",
            "access_token": access_token
        }
        session = cls._requests_retry_session(retries=0)
        start_time = time.time()
        try:
            cls._log_request("GET", url, params=params, username=username, queue_id=queue_id, retry_count=retry_count)
            response = session.get(url, params=params, timeout=10)
            duration = time.time() - start_time
            cls._log_request("GET", url, params=params, response=response, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            
            if response.status_code == 200:
                return response.json()
                
            error_data = response.json().get("error", {})
            raise InstagramAPIError(
                error_data.get("message", "Check container status failed"),
                status_code=response.status_code,
                fb_error_code=error_data.get("code"),
                error_subcode=error_data.get("error_subcode"),
                fbtrace_id=response.headers.get("x-fb-trace-id"),
                raw_response=response.text
            )
        except requests.exceptions.RequestException as e:
            duration = time.time() - start_time
            cls._log_request("GET", url, params=params, error=e, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            raise InstagramAPIError(f"Network error checking container status: {str(e)}")

    @classmethod
    def wait_for_container_processing(cls, container_id: str, access_token: str, timeout: int = 60, interval: int = 2, username: str = None, queue_id: int = None, retry_count: int = 0):
        if cls.is_mock_token(access_token):
            time.sleep(1)
            return

        elapsed = 0
        url = f"{cls.BASE_URL}/{container_id}"
        while elapsed < timeout:
            status_info = cls.check_container_status(container_id, access_token, username=username, queue_id=queue_id, retry_count=retry_count)
            status_code = status_info.get("status_code")
            logger.info(f"Media container {container_id} status: {status_code}")

            if status_code in ["FINISHED", "PUBLISHED"]:
                return
            elif status_code in ["ERROR", "EXPIRED"]:
                error_msg = "Unknown container processing error."
                try:
                    err_params = {
                        "fields": "error_message",
                        "access_token": access_token
                    }
                    err_res = cls._requests_retry_session(retries=0).get(url, params=err_params, timeout=5)
                    if err_res.status_code == 200:
                        error_msg = err_res.json().get("error_message", error_msg)
                except Exception:
                    pass
                raise InstagramAPIError(f"Media container processing failed: {error_msg}")

            time.sleep(interval)
            elapsed += interval

            time.sleep(interval)
            elapsed += interval

        raise InstagramAPIError("Media container processing timed out on Instagram servers.")

    @classmethod
    def publish_media_container(
        cls, 
        instagram_business_id: str, 
        creation_id: str, 
        access_token: str, 
        username: str = None,
        queue_id: int = None,
        retry_count: int = 0
    ) -> str:
        if cls.is_mock_token(access_token):
            return "17874299352621972"

        url = f"{cls.BASE_URL}/{instagram_business_id}/media_publish"
        params = {
            "creation_id": creation_id,
            "access_token": access_token
        }
        session = cls._requests_retry_session(retries=0)
        start_time = time.time()
        try:
            cls._log_request("POST", url, params=params, username=username, queue_id=queue_id, retry_count=retry_count)
            response = session.post(url, params=params, timeout=20)
            duration = time.time() - start_time
            cls._log_request("POST", url, params=params, response=response, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            
            if response.status_code == 200:
                return response.json().get("id")
                
            error_data = response.json().get("error", {})
            raise InstagramAPIError(
                error_data.get("message", "Container publication failed"),
                status_code=response.status_code,
                fb_error_code=error_data.get("code"),
                error_subcode=error_data.get("error_subcode"),
                fbtrace_id=response.headers.get("x-fb-trace-id"),
                raw_response=response.text
            )
        except requests.exceptions.RequestException as e:
            duration = time.time() - start_time
            cls._log_request("POST", url, params=params, error=e, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            raise InstagramAPIError(f"Network error during container publishing: {str(e)}")

    @classmethod
    def verify_published_post(cls, media_id: str, access_token: str, username: str = None, queue_id: int = None, retry_count: int = 0) -> bool:
        if cls.is_mock_token(access_token):
            return True

        url = f"{cls.BASE_URL}/{media_id}"
        params = {
            "fields": "id,ig_id,media_type,timestamp,permalink",
            "access_token": access_token
        }
        session = cls._requests_retry_session(retries=0)
        start_time = time.time()
        try:
            cls._log_request("GET", url, params=params, username=username, queue_id=queue_id, retry_count=retry_count)
            response = session.get(url, params=params, timeout=15)
            duration = time.time() - start_time
            cls._log_request("GET", url, params=params, response=response, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)

            if response.status_code == 200:
                data = response.json()
                if data.get("id") == media_id:
                    return True
            
            error_data = response.json().get("error", {})
            raise InstagramAPIError(
                error_data.get("message", "Post verification failed"),
                status_code=response.status_code,
                fb_error_code=error_data.get("code"),
                fbtrace_id=response.headers.get("x-fb-trace-id"),
                raw_response=response.text
            )
        except requests.exceptions.RequestException as e:
            duration = time.time() - start_time
            cls._log_request("GET", url, params=params, error=e, duration=duration, username=username, queue_id=queue_id, retry_count=retry_count)
            raise InstagramAPIError(f"Network error verifying published post: {str(e)}")

    @classmethod
    def verify_and_resolve_account(cls, username: str, access_token: str, facebook_page_id: str = None) -> dict:
        if cls.is_mock_token(access_token):
            return {
                "status": "verified",
                "instagram_account_id": "17841451223163815",
                "username": username,
                "account_type": "business",
                "token_status": "valid",
                "facebook_page_id": facebook_page_id or "1233050003216359",
                "token_expiry_time": datetime.utcnow() + timedelta(days=60),
                "profile_picture": "https://placekitten.com/200/200",
                "business_name": "Mock Business Name",
                "followers_count": 5280
            }

        try:
            session = cls._requests_retry_session()
            resolved_page_id = facebook_page_id

            # Step 1: Validate/resolve Facebook Page ID.
            if not resolved_page_id:
                pages_url = f"{cls.BASE_URL}/me/accounts"
                cls._log_request("GET", pages_url, params={"access_token": access_token})
                response = session.get(pages_url, params={"access_token": access_token}, timeout=15)
                cls._log_request("GET", pages_url, params={"access_token": access_token}, response=response)
                
                if response.status_code == 200:
                    pages_data = response.json().get("data", [])
                    if pages_data:
                        resolved_page_id = pages_data[0].get("id")
                
                if not resolved_page_id:
                    return {"status": "rejected", "reason": "Invalid or expired Page Access Token."}

            # Step 2: GET /{page-id}?fields=id,name,instagram_business_account
            page_url = f"{cls.BASE_URL}/{resolved_page_id}"
            params = {
                "fields": "id,name,instagram_business_account",
                "access_token": access_token
            }
            cls._log_request("GET", page_url, params=params)
            page_response = session.get(page_url, params=params, timeout=15)
            cls._log_request("GET", page_url, params=params, response=page_response)

            if page_response.status_code != 200:
                err_data = page_response.json().get("error", {})
                return {"status": "rejected", "reason": "Invalid or expired Page Access Token."}

            page_data = page_response.json()
            ig_account = page_data.get("instagram_business_account")
            if not ig_account:
                return {"status": "rejected", "reason": "This Facebook Page is not linked to an Instagram Business Account."}

            ig_business_id = ig_account.get("id")

            # Step 3: GET /{ig_business_id}?fields=id,username,name,profile_picture_url,followers_count
            details = cls.get_instagram_profile_details(ig_business_id, access_token)
            api_username = details.get("username")

            if not api_username:
                return {"status": "rejected", "reason": "Unable to fetch Instagram username from Graph API."}

            # Step 4: Validate Username (ignore case, trim spaces)
            if username.lower().strip() != api_username.lower().strip():
                return {"status": "rejected", "reason": "The supplied Instagram username does not belong to this Facebook Page."}

            # Step 5: Return verification success details
            return {
                "status": "verified",
                "instagram_account_id": ig_business_id,
                "username": api_username,
                "account_type": "business",
                "token_status": "valid",
                "facebook_page_id": resolved_page_id,
                "token_expiry_time": datetime.utcnow() + timedelta(days=60),
                "profile_picture": details.get("profile_picture_url"),
                "business_name": details.get("name") or page_data.get("name") or "Instagram Business",
                "followers_count": details.get("followers_count", 0)
            }
        except Exception as e:
            import traceback
            import sys
            tb = traceback.format_exc()
            frame = sys.exc_info()[2].tb_frame
            filename = frame.f_code.co_filename
            func_name = frame.f_code.co_name
            line_no = sys.exc_info()[2].tb_lineno
            logger.error(f"Verification error in {filename}:{func_name} at line {line_no}: {str(e)}\nTraceback:\n{tb}")
            return {"status": "rejected", "reason": f"Verification error: {str(e)}"}

    @classmethod
    def validate_access_token(cls, token: str) -> dict:
        if cls.is_mock_token(token):
            return {"valid": True, "type": "User/Page", "name": "Mock Account"}
            
        url = f"{cls.BASE_URL}/me"
        params = {
            "fields": "id,name",
            "access_token": token
        }
        try:
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return {"valid": True, "id": data.get("id"), "name": data.get("name")}
            else:
                err = response.json().get("error", {}).get("message", "Invalid Token")
                return {"valid": False, "reason": err}
        except Exception as e:
            return {"valid": False, "reason": str(e)}

    @classmethod
    def resolve_accounts_from_token(cls, token: str) -> list:
        if cls.is_mock_token(token):
            return [
                {
                    "instagram_business_id": "17841401234567890",
                    "username": "mock_instagram_user_1",
                    "facebook_page_id": "10485769213",
                    "facebook_page_name": "Mock Page Marketing 1",
                    "followers_count": 1420,
                    "profile_picture": "https://placekitten.com/200/200",
                    "business_name": "Mock Business 1"
                },
                {
                    "instagram_business_id": "17841401234567891",
                    "username": "mock_instagram_user_2",
                    "facebook_page_id": "10485769214",
                    "facebook_page_name": "Mock Page Marketing 2",
                    "followers_count": 520,
                    "profile_picture": "https://placekitten.com/200/200",
                    "business_name": "Mock Business 2"
                }
            ]
            
        accounts = []
        try:
            url = f"{cls.BASE_URL}/me/accounts"
            params = {"access_token": token}
            res = requests.get(url, params=params, timeout=15)
            if res.status_code != 200:
                return []
                
            pages = res.json().get("data", [])
            for page in pages:
                page_id = page.get("id")
                page_name = page.get("name")
                page_token = page.get("access_token") or token
                
                ig_url = f"{cls.BASE_URL}/{page_id}"
                ig_params = {"fields": "instagram_business_account", "access_token": page_token}
                ig_res = requests.get(ig_url, params=ig_params, timeout=15)
                if ig_res.status_code == 200:
                    biz_data = ig_res.json().get("instagram_business_account")
                    if biz_data:
                        biz_id = biz_data.get("id")
                        
                        details = cls.get_instagram_profile_details(biz_id, page_token)
                        accounts.append({
                            "instagram_business_id": biz_id,
                            "username": details.get("username", "Unknown"),
                            "facebook_page_id": page_id,
                            "facebook_page_name": page_name,
                            "followers_count": details.get("followers_count", 0),
                            "profile_picture": details.get("profile_picture_url") or "https://placekitten.com/200/200",
                            "business_name": details.get("name") or page_name or "Instagram Business"
                        })
        except Exception as e:
            logger.error(f"Failed to resolve accounts from token: {e}")
        return accounts

    @classmethod
    def fetch_recent_posts(cls, instagram_business_id: str, access_token: str) -> list:
        if cls.is_mock_token(access_token) or (instagram_business_id and "mock" in instagram_business_id.lower()):
            import random
            from datetime import datetime, timedelta
            posts = []
            captions = [
                "Loving this weather today! #vibes #nature #explore",
                "New launch dropping tomorrow at 9 AM IST. Stay tuned! 🚀",
                "Behind the scenes of our latest campaign shoot. #creative #crew",
                "Quick tip: ALWAYS validate your access scopes first! 💡",
                "Weekly highlights from the team. Hard work pays off! 🎉"
            ]
            for i in range(5):
                media_id = f"mock_media_{random.randint(100000, 999999)}"
                posts.append({
                    "media_id": media_id,
                    "permalink": f"https://instagram.com/p/mock_permalink_{i}/",
                    "media_url": f"https://picsum.photos/400/400?random={i}",
                    "caption": captions[i],
                    "media_type": "IMAGE" if i % 2 == 0 else "VIDEO",
                    "like_count": random.randint(15, 250),
                    "comment_count": random.randint(2, 35),
                    "published_at": datetime.utcnow() - timedelta(days=i, hours=i * 2)
                })
            return posts

        posts = []
        try:
            url = f"{cls.BASE_URL}/{instagram_business_id}/media"
            params = {
                "fields": "id,caption,media_url,media_type,like_count,comments_count,timestamp,permalink",
                "access_token": access_token,
                "limit": 20
            }
            res = requests.get(url, params=params, timeout=15)
            if res.status_code == 200:
                data = res.json().get("data", [])
                for item in data:
                    pub_time = None
                    if item.get("timestamp"):
                        try:
                            from dateutil.parser import parse
                            pub_time = parse(item.get("timestamp"))
                        except Exception:
                            pass
                    posts.append({
                        "media_id": item.get("id"),
                        "permalink": item.get("permalink"),
                        "media_url": item.get("media_url"),
                        "caption": item.get("caption"),
                        "media_type": item.get("media_type"),
                        "like_count": item.get("like_count", 0),
                        "comment_count": item.get("comments_count", 0),
                        "published_at": pub_time
                    })
        except Exception as e:
            logger.error(f"Failed to fetch recent posts from Meta Graph: {e}")
        return posts

    @classmethod
    def fetch_post_comments(cls, media_id: str, access_token: str) -> list:
        if cls.is_mock_token(access_token) or (media_id and "mock" in media_id.lower()):
            from datetime import datetime, timedelta
            return [
                {
                    "id": "c1",
                    "username": "karuppu_fan_1",
                    "text": "This is an amazing post! Keep it up!",
                    "timestamp": datetime.utcnow() - timedelta(hours=2)
                },
                {
                    "id": "c2",
                    "username": "tamil_coder",
                    "text": "Super clean setup. Loving the UI updates.",
                    "timestamp": datetime.utcnow() - timedelta(hours=4)
                },
                {
                    "id": "c3",
                    "username": "nature_lover_99",
                    "text": "Stunning visuals! 👏",
                    "timestamp": datetime.utcnow() - timedelta(hours=6)
                }
            ]

        comments = []
        try:
            url = f"{cls.BASE_URL}/{media_id}/comments"
            params = {
                "fields": "id,text,username,timestamp",
                "access_token": access_token
            }
            res = requests.get(url, params=params, timeout=15)
            if res.status_code == 200:
                data = res.json().get("data", [])
                for item in data:
                    c_time = None
                    if item.get("timestamp"):
                        try:
                            from dateutil.parser import parse
                            c_time = parse(item.get("timestamp"))
                        except Exception:
                            pass
                    comments.append({
                        "id": item.get("id"),
                        "username": item.get("username", "Anonymous"),
                        "text": item.get("text", ""),
                        "timestamp": c_time
                    })
        except Exception as e:
            logger.error(f"Failed to fetch post comments from Meta Graph: {e}")
        return comments
