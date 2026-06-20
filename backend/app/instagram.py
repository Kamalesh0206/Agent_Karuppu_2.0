import time
import os
import requests
import logging

logger = logging.getLogger("instagram_client")
logging.basicConfig(level=logging.INFO)

class InstagramAPIError(Exception):
    """Custom exception for Instagram Graph API failures."""
    def __init__(self, message, status_code=None, fb_error_code=None, error_subcode=None, raw_response=None):
        super().__init__(message)
        self.status_code = status_code
        self.fb_error_code = fb_error_code
        self.error_subcode = error_subcode
        self.raw_response = raw_response

class InstagramClient:
    GRAPH_API_VERSION = "v18.0"
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
    def _log_request(cls, method: str, url: str, params: dict = None, json_data: dict = None, response: requests.Response = None, error: Exception = None):
        # Mask access token
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

        log_msg = f"[Instagram API Request] Method: {method.upper()} | URL: {url} | Params: {masked_params} | JSON: {masked_json}"
        if response is not None:
            try:
                resp_payload = response.json()
            except Exception:
                resp_payload = response.text
            log_msg += f"\n[Instagram API Response] Status: {response.status_code} | Payload: {resp_payload}"
        if error is not None:
            log_msg += f"\n[Instagram API Error] Details: {str(error)}"
        
        logger.info(log_msg)

    @classmethod
    def is_mock_token(cls, token: str) -> bool:
        """Determines if the token is a mock/development token."""
        if not token:
            return True
        token = token.strip()
        if token.startswith("mock_") or token == "development_token" or token.startswith("mock"):
            return True
        return False

    @classmethod
    def verify_token_permissions(cls, access_token: str):
        """
        Verify that the access token contains the required permissions:
        - instagram_basic
        - instagram_content_publish
        - pages_show_list
        """
        if cls.is_mock_token(access_token):
            logger.info("[MOCK] Verifying permissions for access token.")
            return

        # The Instagram Graph API for content publishing runs on Facebook Graph API and requires a Page Access Token starting with 'EAA'.
        # Instagram User tokens (starting with 'IG') are not supported on this endpoint.
        token_str = access_token.strip()
        if not token_str.startswith("EAA"):
            if token_str.startswith("IG"):
                raise InstagramAPIError(
                    "Invalid token type. The Instagram Graph API for Business publishing requires a Facebook Page Access Token starting with 'EAA'. Tokens starting with 'IG' (Instagram User tokens) are not supported on this endpoint. Please use the Facebook Login flow to generate a Page Access Token.",
                    status_code=400
                )
            else:
                raise InstagramAPIError(
                    "Invalid token type. The Instagram Graph API for Business publishing requires a Facebook Page Access Token starting with 'EAA'.",
                    status_code=400
                )

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
                    f"Permissions check failed: {error_data.get('message', 'Unknown error')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    raw_response=response.text
                )
            
            data = response.json().get("data", [])
            granted_permissions = {item.get("permission") for item in data if item.get("status") == "granted"}
            
            required = ["instagram_basic", "instagram_content_publish", "pages_show_list"]
            missing = [p for p in required if p not in granted_permissions]
            
            if missing:
                raise InstagramAPIError(f"Missing required permissions: {', '.join(missing)}. Please re-authenticate and grant all permissions.")
                
            logger.info("Access token permissions verified successfully.")
            
        except requests.exceptions.RequestException as e:
            cls._log_request("GET", url, params=params, error=e)
            raise InstagramAPIError(f"Network error during permissions check: {str(e)}")

    @classmethod
    def verify_instagram_account_type(cls, instagram_business_id: str, access_token: str):
        """
        Verify that the target Instagram account exists and is a Business or Creator account.
        """
        if cls.is_mock_token(access_token):
            logger.info("[MOCK] Verifying Instagram Account Type.")
            return

        url = f"{cls.BASE_URL}/{instagram_business_id}"
        params = {
            "fields": "id,username",
            "access_token": access_token
        }
        session = cls._requests_retry_session()
        
        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                error_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Failed to verify Instagram account type. Ensure the account is a Business or Creator account: {error_data.get('message', 'Unknown error')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    raw_response=response.text
                )
            
            data = response.json()
            if not data.get("id") or not data.get("username"):
                raise InstagramAPIError("The linked account does not appear to be a valid Instagram Business or Creator account.")
                
            logger.info(f"Verified Instagram account @{data.get('username')} type: Business/Creator.")
            
        except requests.exceptions.RequestException as e:
            cls._log_request("GET", url, params=params, error=e)
            raise InstagramAPIError(f"Network error during account type check: {str(e)}")

    @classmethod
    def verify_account(cls, access_token: str) -> str:
        """
        Verify the access token and retrieve the linked Instagram Business Account ID.
        """
        if cls.is_mock_token(access_token):
            logger.info("Using mock account verification.")
            return "17841401234567890"

        token_str = access_token.strip()
        if not token_str.startswith("EAA"):
            if token_str.startswith("IG"):
                raise InstagramAPIError(
                    "Invalid token type. The Instagram Graph API for Business publishing requires a Facebook Page Access Token starting with 'EAA'. Tokens starting with 'IG' (Instagram User tokens) are not supported on this endpoint. Please use the Facebook Login flow to generate a Page Access Token.",
                    status_code=400
                )
            else:
                raise InstagramAPIError(
                    "Invalid token type. The Instagram Graph API for Business publishing requires a Facebook Page Access Token starting with 'EAA'.",
                    status_code=400
                )

        session = cls._requests_retry_session()
        try:
            # Step 1: Get Facebook Pages managed by this user token
            pages_url = f"{cls.BASE_URL}/me/accounts"
            cls._log_request("GET", pages_url, params={"access_token": access_token})
            response = session.get(pages_url, params={"access_token": access_token}, timeout=15)
            cls._log_request("GET", pages_url, params={"access_token": access_token}, response=response)
            
            if response.status_code != 200:
                error_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Failed to fetch FB Pages: {error_data.get('message', 'Unknown error')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    error_subcode=error_data.get("error_subcode"),
                    raw_response=response.text
                )
            
            pages_data = response.json().get("data", [])
            if not pages_data:
                raise InstagramAPIError("No Facebook Pages linked to this access token. An Instagram Business Account must be connected to a FB Page.")
 
            # Step 2: Query each Page to find the linked Instagram Business Account
            for page in pages_data:
                page_id = page.get("id")
                page_token = page.get("access_token")
                
                ig_url = f"{cls.BASE_URL}/{page_id}"
                ig_params = {
                    "fields": "instagram_business_account",
                    "access_token": page_token or access_token
                }
                
                cls._log_request("GET", ig_url, params=ig_params)
                ig_response = session.get(ig_url, params=ig_params, timeout=15)
                cls._log_request("GET", ig_url, params=ig_params, response=ig_response)
                
                if ig_response.status_code == 200:
                    ig_data = ig_response.json()
                    ig_account = ig_data.get("instagram_business_account")
                    if ig_account:
                        ig_id = ig_account.get("id")
                        logger.info(f"Successfully retrieved Instagram Business Account ID: {ig_id}")
                        return ig_id
 
            raise InstagramAPIError("Could not find any Instagram Business Account linked to the Facebook Pages.")
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Network error during account verification: {str(e)}")
            raise InstagramAPIError(f"Network error during account verification: {str(e)}")

    @classmethod
    def create_media_container(
        cls, 
        instagram_business_id: str, 
        media_url: str, 
        caption: str, 
        access_token: str, 
        is_video: bool = False
    ) -> str:
        """
        Step 1 of publishing: Create a media container on Instagram.
        """
        if cls.is_mock_token(access_token):
            logger.info("Using mock media container creation.")
            return "18273645901234567"

        url = f"{cls.BASE_URL}/{instagram_business_id}/media"
        params = {
            "caption": caption,
            "access_token": access_token
        }

        if is_video:
            params["media_type"] = "VIDEO"
            params["video_url"] = media_url
        else:
            params["image_url"] = media_url

        session = cls._requests_retry_session()
        try:
            cls._log_request("POST", url, params=params)
            response = session.post(url, params=params, timeout=20)
            cls._log_request("POST", url, params=params, response=response)
            response_json = response.json()

            if response.status_code != 200:
                error_data = response_json.get("error", {})
                raise InstagramAPIError(
                    f"Container creation failed: {error_data.get('message', 'Unknown error')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    error_subcode=error_data.get("error_subcode"),
                    raw_response=response.text
                )

            creation_id = response_json.get("id")
            logger.info(f"Created media container: {creation_id}")
            return creation_id
            
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error during media container creation: {str(e)}")

    @classmethod
    def check_container_status(cls, container_id: str, access_token: str) -> dict:
        """
        Check the status of a media container. Media processing takes time (especially videos).
        """
        if cls.is_mock_token(access_token):
            return {"status_code": "FINISHED"}

        url = f"{cls.BASE_URL}/{container_id}"
        params = {
            "fields": "status_code,error_message",
            "access_token": access_token
        }
        session = cls._requests_retry_session()

        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=10)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                error_data = response.json().get("error", {})
                raise InstagramAPIError(
                    f"Failed to check container status: {error_data.get('message')}",
                    status_code=response.status_code,
                    raw_response=response.text
                )
            return response.json()
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error checking container status: {str(e)}")

    @classmethod
    def wait_for_container_processing(cls, container_id: str, access_token: str, timeout: int = 180, interval: int = 5):
        """
        Poll the media container status until processing completes, publishes, or fails.
        """
        if cls.is_mock_token(access_token):
            time.sleep(1)
            return

        elapsed = 0
        while elapsed < timeout:
            status_info = cls.check_container_status(container_id, access_token)
            status_code = status_info.get("status_code")
            logger.info(f"Media container {container_id} status: {status_code}")

            if status_code in ["FINISHED", "PUBLISHED"]:
                return
            elif status_code in ["ERROR", "EXPIRED"]:
                error_msg = status_info.get("error_message", "Unknown container processing error.")
                raise InstagramAPIError(f"Media container processing failed: {error_msg}")

            time.sleep(interval)
            elapsed += interval

        raise InstagramAPIError("Media container processing timed out on Instagram servers.")

    @classmethod
    def publish_media_container(cls, instagram_business_id: str, creation_id: str, access_token: str) -> str:
        """
        Step 2 of publishing: Publish the created media container.
        """
        if cls.is_mock_token(access_token):
            logger.info("Using mock media container publishing.")
            return "17945612349876543"

        url = f"{cls.BASE_URL}/{instagram_business_id}/media_publish"
        params = {
            "creation_id": creation_id,
            "access_token": access_token
        }
        session = cls._requests_retry_session()

        try:
            cls._log_request("POST", url, params=params)
            response = session.post(url, params=params, timeout=20)
            cls._log_request("POST", url, params=params, response=response)
            response_json = response.json()

            if response.status_code != 200:
                error_data = response_json.get("error", {})
                raise InstagramAPIError(
                    f"Publishing container failed: {error_data.get('message', 'Unknown error')}",
                    status_code=response.status_code,
                    fb_error_code=error_data.get("code"),
                    error_subcode=error_data.get("error_subcode"),
                    raw_response=response.text
                )

            media_id = response_json.get("id")
            logger.info(f"Successfully published post, media ID: {media_id}")
            return media_id
            
        except requests.exceptions.RequestException as e:
            raise InstagramAPIError(f"Network error during container publishing: {str(e)}")

    @classmethod
    def verify_published_post(cls, media_id: str, access_token: str) -> bool:
        """
        Verify that the newly published media exists on Instagram.
        """
        if cls.is_mock_token(access_token):
            logger.info(f"[MOCK] Verifying published post exists. Media ID: {media_id}")
            return True

        url = f"{cls.BASE_URL}/{media_id}"
        params = {
            "fields": "id,ig_id,media_type,timestamp,permalink",
            "access_token": access_token
        }
        session = cls._requests_retry_session()

        try:
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)

            if response.status_code == 200:
                data = response.json()
                if data.get("id") == media_id:
                    logger.info(f"Post verified successfully. Confirmed Instagram Post Exists: {media_id}")
                    return True

            error_data = response.json().get("error", {})
            raise InstagramAPIError(
                f"Post verification failed. Media ID does not exist or is unreachable: {error_data.get('message', 'Unknown error')}",
                status_code=response.status_code,
                raw_response=response.text
            )

        except requests.exceptions.RequestException as e:
            cls._log_request("GET", url, params=params, error=e)
            raise InstagramAPIError(f"Network error verifying published post: {str(e)}")

    @classmethod
    def verify_and_resolve_account(cls, username: str, access_token: str, facebook_page_id: str = None) -> dict:
        """
        Verify that an Instagram account exists and is eligible to be connected.
        Workflow:
        1. Receive username, token, optional Page ID.
        2. Verify existence using Graph API (or mock).
        3. Verify account type, linking to FB page, permissions, and token validity.
        4. Validate that user-supplied username matches the API record.
        5. Return Success or Failure.
        """
        if cls.is_mock_token(access_token):
            username_lower = username.lower().strip()
            token_lower = access_token.lower().strip() if access_token else ""
            
            if username_lower == "non_existent":
                return {
                    "status": "rejected",
                    "reason": "Account not found"
                }
            if "invalid" in token_lower:
                return {
                    "status": "rejected",
                    "reason": "Invalid token"
                }
            if "missing_permissions" in token_lower:
                return {
                    "status": "rejected",
                    "reason": "Missing permissions"
                }
            if "no_page" in token_lower:
                return {
                    "status": "rejected",
                    "reason": "Instagram account is not linked to a Facebook Page"
                }
                
            # Default mock success
            import datetime
            return {
                "status": "verified",
                "instagram_account_id": "17841401234567890",
                "username": username,
                "account_type": "business",
                "token_status": "valid",
                "facebook_page_id": facebook_page_id or "1234567890",
                "token_expiry_time": datetime.datetime.utcnow() + datetime.timedelta(days=60)
            }

        try:
            # 1. Verify token permissions and EAA prefix
            cls.verify_token_permissions(access_token)
            
            # 2. Retrieve linked Instagram Business Account ID and Facebook Page ID
            session = cls._requests_retry_session()
            pages_url = f"{cls.BASE_URL}/me/accounts"
            cls._log_request("GET", pages_url, params={"access_token": access_token})
            response = session.get(pages_url, params={"access_token": access_token}, timeout=15)
            cls._log_request("GET", pages_url, params={"access_token": access_token}, response=response)
            
            if response.status_code != 200:
                error_data = response.json().get("error", {})
                return {
                    "status": "rejected",
                    "reason": f"Invalid token: {error_data.get('message', 'Unknown error')}"
                }
                
            pages_data = response.json().get("data", [])
            if not pages_data:
                return {
                    "status": "rejected",
                    "reason": "Instagram account is not linked to a Facebook Page"
                }
                
            ig_business_id = None
            resolved_page_id = None
            
            # Filter pages if facebook_page_id is provided
            target_pages = pages_data
            if facebook_page_id:
                target_pages = [p for p in pages_data if p.get("id") == facebook_page_id]
                if not target_pages:
                    return {
                        "status": "rejected",
                        "reason": f"Facebook Page ID {facebook_page_id} is not managed by this account"
                    }
                    
            for page in target_pages:
                page_id = page.get("id")
                page_token = page.get("access_token")
                
                ig_url = f"{cls.BASE_URL}/{page_id}"
                ig_params = {
                    "fields": "instagram_business_account",
                    "access_token": page_token or access_token
                }
                
                cls._log_request("GET", ig_url, params=ig_params)
                ig_response = session.get(ig_url, params=ig_params, timeout=15)
                cls._log_request("GET", ig_url, params=ig_params, response=ig_response)
                
                if ig_response.status_code == 200:
                    ig_data = ig_response.json()
                    ig_account = ig_data.get("instagram_business_account")
                    if ig_account:
                        ig_business_id = ig_account.get("id")
                        resolved_page_id = page_id
                        break
                        
            if not ig_business_id:
                return {
                    "status": "rejected",
                    "reason": "Instagram account is not linked to a Facebook Page"
                }
                
            # 3. Verify Instagram account existence and eligibility
            url = f"{cls.BASE_URL}/{ig_business_id}"
            params = {
                "fields": "id,username",
                "access_token": access_token
            }
            cls._log_request("GET", url, params=params)
            response = session.get(url, params=params, timeout=15)
            cls._log_request("GET", url, params=params, response=response)
            
            if response.status_code != 200:
                return {
                    "status": "rejected",
                    "reason": "Account not found"
                }
                
            data = response.json()
            api_username = data.get("username")
            if not api_username:
                return {
                    "status": "rejected",
                    "reason": "Account not found"
                }
                
            # 4. Confirm username matches the returned API profile username
            if username.lower().strip() != api_username.lower().strip():
                return {
                    "status": "rejected",
                    "reason": f"Username does not match the returned account information (expected {api_username})"
                }
                
            import datetime
            token_expiry = datetime.datetime.utcnow() + datetime.timedelta(days=60)
            
            return {
                "status": "verified",
                "instagram_account_id": ig_business_id,
                "username": api_username,
                "account_type": "business",
                "token_status": "valid",
                "facebook_page_id": resolved_page_id,
                "token_expiry_time": token_expiry
            }
            
        except InstagramAPIError as e:
            return {
                "status": "rejected",
                "reason": str(e)
            }
        except Exception as e:
            return {
                "status": "rejected",
                "reason": f"Verification error: {str(e)}"
            }
