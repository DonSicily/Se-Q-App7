"""
Integration services - Simplified version without external dependencies
"""
import os
import logging
import base64
import httpx
from typing import List, Optional, Dict, Any
from datetime import datetime
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logger = logging.getLogger(__name__)

# ===== FIREBASE STORAGE SERVICE (MOCK) =====
class FirebaseStorageService:
    """Mock Firebase Storage Service - stores files locally"""
    def __init__(self):
        self.bucket_name = os.getenv('FIREBASE_STORAGE_BUCKET', 'safeguard-storage')
        self.storage_dir = ROOT_DIR / 'uploads'
        self.storage_dir.mkdir(exist_ok=True)
        logger.info(f"Firebase Storage service (local mock) initialized")
    
    async def upload_file(
        self, 
        file_data: bytes, 
        filename: str, 
        content_type: str = 'application/octet-stream',
        folder: str = 'uploads'
    ) -> str:
        """Upload file locally and return a URL path"""
        try:
            folder_path = self.storage_dir / folder
            folder_path.mkdir(exist_ok=True)
            
            file_path = folder_path / filename
            with open(file_path, 'wb') as f:
                f.write(file_data)
            
            # Return path that can be served by the backend
            return f"/api/media/{folder}/{filename}"
            
        except Exception as e:
            logger.error(f"Upload error: {e}")
            return f"/api/media/{folder}/{filename}"
    
    async def upload_base64(
        self,
        base64_data: str,
        filename: str,
        content_type: str,
        folder: str = 'uploads'
    ) -> str:
        """Upload base64 encoded file"""
        try:
            file_data = base64.b64decode(base64_data)
            return await self.upload_file(file_data, filename, content_type, folder)
        except Exception as e:
            logger.error(f"Base64 upload error: {e}")
            return f"/api/media/{folder}/{filename}"
    
    async def delete_file(self, file_path: str) -> bool:
        """Delete a file"""
        try:
            parts = file_path.split('/')
            if len(parts) >= 2:
                full_path = self.storage_dir / parts[-2] / parts[-1]
                if full_path.exists():
                    full_path.unlink()
                    return True
            return False
        except Exception as e:
            logger.error(f"Delete error: {e}")
            return False

# ===== PAYSTACK SERVICE (MOCK) =====
class PaystackService:
    """Mock Paystack payment service"""
    def __init__(self):
        self.secret_key = os.getenv('PAYSTACK_SECRET_KEY', 'sk_test_mock')
        logger.info("Paystack service (mock) initialized")
    
    async def initialize_transaction(
        self,
        email: str,
        amount: int,
        reference: str,
        callback_url: str,
        metadata: dict = None
    ) -> dict:
        """Initialize a mock payment transaction"""
        return {
            "status": True,
            "message": "Authorization URL created",
            "data": {
                "authorization_url": f"https://paystack.com/pay/{reference}",
                "access_code": f"access_{reference}",
                "reference": reference
            }
        }
    
    async def verify_transaction(self, reference: str) -> dict:
        """Verify a mock transaction"""
        return {
            "status": True,
            "message": "Verification successful",
            "data": {
                "status": "success",
                "reference": reference,
                "amount": 500000,  # 5000 NGN in kobo
                "currency": "NGN"
            }
        }

# ===== EXPO PUSH SERVICE =====
class ExpoPushService:
    """Expo push notification service"""
    def __init__(self):
        self.push_url = "https://exp.host/--/api/v2/push/send"
        logger.info("Expo Push service initialized")
    
    async def send_push_notification(
        self,
        tokens: List[str],
        title: str,
        body: str,
        data: dict = None
    ) -> dict:
        """Send push notification via Expo"""
        try:
            if not tokens:
                return {"status": "no_tokens", "sent_to": 0}
            
            messages = []
            for token in tokens:
                if token and token.startswith('ExponentPushToken'):
                    messages.append({
                        "to": token,
                        "title": title,
                        "body": body,
                        "data": data or {},
                        "sound": "default",
                        "priority": "high"
                    })
            
            if not messages:
                return {"status": "no_valid_tokens", "sent_to": 0}
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.push_url,
                    json=messages,
                    headers={"Content-Type": "application/json"},
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    return {"status": "sent", "sent_to": len(messages)}
                else:
                    logger.error(f"Push notification error: {response.text}")
                    return {"status": "error", "sent_to": 0}
                    
        except Exception as e:
            logger.error(f"Push notification error: {e}")
            return {"status": "error", "error": str(e), "sent_to": 0}

# ===== EMAIL SERVICE (MOCK) =====
class EmailService:
    """Mock email service"""
    def __init__(self):
        self.smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
        self.smtp_user = os.getenv('SMTP_USER', '')
        self.smtp_pass = os.getenv('SMTP_PASSWORD', '')
        self.from_email = os.getenv('FROM_EMAIL', 'noreply@safeguard.app')
        logger.info("Email service (mock) initialized")
    
    async def send_email(
        self,
        to_email: str,
        subject: str,
        body: str,
        html_body: str = None
    ) -> bool:
        """Send an email (mock - just logs)"""
        try:
            logger.info(f"[EMAIL MOCK] To: {to_email}, Subject: {subject}")
            return True
        except Exception as e:
            logger.error(f"Email error: {e}")
            return False
    
    async def send_panic_alert(
        self,
        to_email: str,
        user_name: str,
        user_phone: str,
        latitude: float,
        longitude: float,
        category: str
    ) -> bool:
        """Send panic alert email"""
        subject = f"🚨 PANIC ALERT - {user_name}"
        body = f"""
EMERGENCY ALERT!

User: {user_name}
Phone: {user_phone}
Category: {category}
Location: {latitude}, {longitude}
Map: https://maps.google.com/?q={latitude},{longitude}

Please respond immediately!
"""
        return await self.send_email(to_email, subject, body)

# Initialize service instances
firebase_service = FirebaseStorageService()
paystack_service = PaystackService()
expo_push_service = ExpoPushService()
email_service = EmailService()
