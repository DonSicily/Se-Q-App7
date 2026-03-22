from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Body, Query, Request, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import bcrypt
import jwt
from bson import ObjectId
import math
import hashlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create geospatial indexes
async def create_indexes():
    await db.civil_reports.create_index([("location", "2dsphere")])
    await db.civil_tracks.create_index([("currentLocation.coordinates", "2dsphere")])
    await db.security_teams.create_index([("teamLocation.coordinates", "2dsphere")])

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'safeguard-secret-key-2025')
if JWT_SECRET == 'safeguard-secret-key-2025':
    logger.warning(
        "⚠️  JWT_SECRET is using the insecure default value. "
        "Set a strong random JWT_SECRET in your .env file before deploying to production."
    )
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 30  # 30 days

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ===== MODELS =====
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    confirm_password: str
    phone: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "civil"  # "civil" or "security"
    invite_code: Optional[str] = None  # Required for security role
    security_sub_role: Optional[str] = None  # "supervisor" or "team_member" for security
    team_name: Optional[str] = None  # Optional team name for security

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class AdminLogin(BaseModel):
    email: EmailStr
    password: str

class GoogleAuthData(BaseModel):
    google_id: str
    email: EmailStr
    name: str
    role: str = "civil"

class LocationPoint(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    emergency_category: Optional[str] = None  # For panic events: violence, robbery, kidnapping, etc.

class SetTeamLocation(BaseModel):
    latitude: float
    longitude: float
    radius_km: float = 10.0  # Default 10km radius

class ReportCreate(BaseModel):
    type: str  # "video" or "audio"
    caption: Optional[str] = None
    is_anonymous: bool = False
    file_url: Optional[str] = None
    thumbnail: Optional[str] = None
    uploaded: bool = False
    latitude: float
    longitude: float

class UserSearch(BaseModel):
    search_term: str  # phone or email

class AppCustomization(BaseModel):
    app_name: str
    app_logo: str

class UpdateLocation(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None

class UpdateStatus(BaseModel):
    status: str  # "available", "busy", "responding", "offline"

class UpdateSecuritySettings(BaseModel):
    visibility_radius_km: Optional[int] = None
    status: Optional[str] = None
    is_visible: Optional[bool] = None

class SendMessage(BaseModel):
    to_user_id: str
    content: str
    message_type: str = "text"  # "text", "image", "location", "voice"

class CreateInviteCode(BaseModel):
    code: Optional[str] = None  # Auto-generate if not provided
    max_uses: int = 10
    expires_days: int = 30

# ===== HELPER FUNCTIONS =====
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.split(' ')[1]
    payload = verify_token(token)
    user = await db.users.find_one({'_id': ObjectId(payload['user_id'])})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user

def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points in km using Haversine formula"""
    R = 6371  # Earth's radius in km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c

def geohash(lat: float, lon: float, precision: int = 6) -> str:
    """Simple geohash implementation"""
    return hashlib.md5(f"{lat:.{precision}f},{lon:.{precision}f}".encode()).hexdigest()[:precision]

# Import services
from services import (
    firebase_service,
    paystack_service,
    expo_push_service,
    email_service
)

# Real Push Notification using Expo
async def send_push_notification(user_ids: List[str], title: str, body: str, data: dict = None):
    """Send push notification using Expo Push Service"""
    try:
        # Get push tokens for these users
        users_with_tokens = await db.users.find({
            '_id': {'$in': [ObjectId(uid) for uid in user_ids]},
            'push_token': {'$exists': True, '$ne': None}
        }).to_list(length=None)
        
        tokens = [user.get('push_token') for user in users_with_tokens if user.get('push_token')]
        
        if not tokens:
            logging.info(f"No push tokens found for {len(user_ids)} users")
            return {"status": "no_tokens", "sent_to": 0}
        
        # Send via Expo Push Service
        result = await expo_push_service.send_push_notification(
            tokens=tokens,
            title=title,
            body=body,
            data=data or {},
            priority='high'
        )
        
        logging.info(f"Push notification sent: {result['success']} success, {result['failed']} failed")
        return {"status": "sent", "sent_to": result['success'], "failed": result['failed']}
        
    except Exception as e:
        logging.error(f"Push notification error: {e}")
        return {"status": "error", "sent_to": 0, "error": str(e)}

# ===== AUTHENTICATION ROUTES =====
@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    # Check passwords match
    if user_data.password != user_data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    # Check if user exists
    existing_user = await db.users.find_one({'email': user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate security role and invite code
    if user_data.role == "security":
        if not user_data.invite_code:
            raise HTTPException(status_code=403, detail="Invite code required for security registration")
        
        # Check invite code validity
        invite = await db.invite_codes.find_one({
            'code': user_data.invite_code,
            'is_active': True,
            'expires_at': {'$gt': datetime.utcnow()}
        })
        
        if not invite:
            raise HTTPException(status_code=403, detail="Invalid or expired invite code")
        
        if invite.get('used_count', 0) >= invite.get('max_uses', 10):
            raise HTTPException(status_code=403, detail="Invite code has reached maximum uses")
        
        # Increment used count
        await db.invite_codes.update_one(
            {'_id': invite['_id']},
            {'$inc': {'used_count': 1}}
        )
    
    # Create user
    user = {
        'email': user_data.email.strip().lower(),
        'phone': user_data.phone,
        'full_name': user_data.full_name or '',
        'password': hash_password(user_data.password),
        'role': user_data.role,
        'is_premium': False,
        'is_active': True,
        'is_verified': True,  # Auto-verify for demo
        'app_name': 'SafeGuard',
        'app_logo': 'shield',
        'created_at': datetime.utcnow(),
        'google_id': None
    }
    
    # Add security-specific fields
    if user_data.role == "security":
        user['security_sub_role'] = user_data.security_sub_role or 'team_member'
        user['team_name'] = user_data.team_name or ''
        user['status'] = 'available'
        user['visibility_radius_km'] = 25
        user['is_visible'] = True
    
    result = await db.users.insert_one(user)
    user_id = str(result.inserted_id)
    
    # Create security team entry if security user
    if user_data.role == "security":
        team = {
            'user_id': user_id,
            'teamLocation': {
                'type': 'Point',
                'coordinates': [0, 0]  # Default, user will set
            },
            'radius_km': 10.0,
            'created_at': datetime.utcnow()
        }
        await db.security_teams.insert_one(team)
    
    token = create_token(user_id, user_data.email, user_data.role)
    
    return {
        'token': token,
        'user_id': user_id,
        'email': user_data.email,
        'role': user_data.role,
        'is_premium': False
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    logger.info(f"Login attempt for email: {credentials.email}")
    user = await db.users.find_one({'email': credentials.email})
    if not user:
        logger.warning(f"User not found: {credentials.email}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get('password'):
        logger.warning(f"User has no password: {credentials.email}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    try:
        is_valid = verify_password(credentials.password, user['password'])
        logger.info(f"Password verification result: {is_valid}")
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(str(user['_id']), user['email'], user.get('role', 'civil'))
    
    return {
        'token': token,
        'user_id': str(user['_id']),
        'email': user['email'],
        'role': user.get('role', 'civil'),
        'is_premium': user.get('is_premium', False)
    }

@api_router.post("/auth/google")
async def google_auth(auth_data: GoogleAuthData):
    user = await db.users.find_one({'google_id': auth_data.google_id})
    
    if not user:
        user = {
            'email': auth_data.email,
            'name': auth_data.name,
            'google_id': auth_data.google_id,
            'password': None,
            'role': auth_data.role,
            'is_premium': False,
            'is_verified': True,
            'app_name': 'SafeGuard',
            'app_logo': 'shield',
            'created_at': datetime.utcnow()
        }
        result = await db.users.insert_one(user)
        user_id = str(result.inserted_id)
    else:
        user_id = str(user['_id'])
    
    token = create_token(user_id, auth_data.email, user.get('role', auth_data.role))
    
    return {
        'token': token,
        'user_id': user_id,
        'email': auth_data.email,
        'role': user.get('role', auth_data.role),
        'is_premium': user.get('is_premium', False)
    }

# ===== USER ROUTES =====
@api_router.get("/user/profile")
async def get_profile(user = Depends(get_current_user)):
    return {
        'id': str(user['_id']),
        'email': user['email'],
        'full_name': user.get('full_name', ''),
        'phone': user.get('phone'),
        'role': user.get('role', 'civil'),
        'is_premium': user.get('is_premium', False),
        'app_name': user.get('app_name', 'SafeGuard'),
        'app_logo': user.get('app_logo', 'shield'),
        'profile_photo_url': user.get('profile_photo_url', None),
        'emergency_contacts': user.get('emergency_contacts', []),
        'created_at': user.get('created_at')
    }

class ProfilePhotoUpdate(BaseModel):
    photo_data: str  # Base64 encoded image (kept for backwards compat)
    mime_type: str = "image/jpeg"

@api_router.post("/user/profile-photo")
async def update_profile_photo(
    photo: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload profile photo via multipart/form-data (avoids proxy body size limits)"""
    try:
        content = await photo.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image too large (max 5MB)")
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty file received")

        photos_dir = ROOT_DIR / 'uploads' / 'photos'
        photos_dir.mkdir(parents=True, exist_ok=True)

        content_type = photo.content_type or 'image/jpeg'
        ext = 'png' if 'png' in content_type else 'jpg'
        filename = f"profile_{str(user['_id'])}_{uuid.uuid4().hex[:8]}.{ext}"
        file_path = photos_dir / filename

        with open(file_path, 'wb') as f:
            f.write(content)

        photo_url = f"/api/media/photos/{filename}"
        await db.users.update_one(
            {'_id': user['_id']},
            {'$set': {'profile_photo_url': photo_url, 'profile_photo_updated_at': datetime.utcnow()}}
        )
        return {'message': 'Profile photo updated', 'photo_url': photo_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating profile photo: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update profile photo: {str(e)}")


class ProfilePhotoBase64(BaseModel):
    photo_base64: str
    mime_type: str = 'image/jpeg'

@api_router.post("/user/profile-photo-base64")
async def update_profile_photo_base64(
    data: ProfilePhotoBase64,
    user: dict = Depends(get_current_user)
):
    """Upload profile photo via base64 encoded JSON - more reliable across platforms"""
    try:
        # Decode base64
        import base64
        content = base64.b64decode(data.photo_base64)
        
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Image too large (max 5MB)")
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty image received")

        photos_dir = ROOT_DIR / 'uploads' / 'photos'
        photos_dir.mkdir(parents=True, exist_ok=True)

        ext = 'png' if 'png' in data.mime_type else 'jpg'
        filename = f"profile_{str(user['_id'])}_{uuid.uuid4().hex[:8]}.{ext}"
        file_path = photos_dir / filename

        with open(file_path, 'wb') as f:
            f.write(content)

        photo_url = f"/api/media/photos/{filename}"
        await db.users.update_one(
            {'_id': user['_id']},
            {'$set': {'profile_photo_url': photo_url, 'profile_photo_updated_at': datetime.utcnow()}}
        )
        return {'message': 'Profile photo updated', 'photo_url': photo_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating profile photo (base64): {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update profile photo: {str(e)}")


@api_router.put("/user/customize-app")
async def customize_app(customization: AppCustomization, user = Depends(get_current_user)):
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'app_name': customization.app_name, 'app_logo': customization.app_logo}}
    )
    return {'message': 'App customization updated'}

class EmergencyContactsUpdate(BaseModel):
    contacts: List[dict]

@api_router.put("/user/emergency-contacts")
async def update_emergency_contacts(data: EmergencyContactsUpdate, user = Depends(get_current_user)):
    """Update user's emergency contacts for panic notifications"""
    valid_contacts = []
    for contact in data.contacts:
        if contact.get('phone'):
            valid_contacts.append({
                'name': contact.get('name', ''),
                'phone': contact.get('phone'),
                'email': contact.get('email', '')
            })
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'emergency_contacts': valid_contacts}}
    )
    return {'message': 'Emergency contacts updated', 'count': len(valid_contacts)}


@api_router.get("/panic/status")
async def get_panic_status(user = Depends(get_current_user)):
    """Get current user's panic status - used to sync state after app restart"""
    if user.get('role') != 'civil':
        return {'is_active': False}
    
    # Check panic_events collection (primary storage)
    active_panic = await db.panic_events.find_one({
        'user_id': str(user['_id']),
        'is_active': True
    })
    
    # Also check legacy active_panics collection if needed
    if not active_panic:
        active_panic = await db.active_panics.find_one({
            'user_id': str(user['_id']),
            'is_active': True
        })
    
    if active_panic:
        return {
            'is_active': True,
            'panic_id': str(active_panic['_id']),
            'activated_at': active_panic.get('activated_at'),
            'emergency_category': active_panic.get('emergency_category', 'other')
        }
    return {'is_active': False}

# ===== CIVIL USER ROUTES =====
@api_router.post("/panic/activate")
async def activate_panic(panic_data: LocationPoint, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can activate panic")
    
    # Map category labels for notifications
    CATEGORY_LABELS = {
        'violence': 'Violence/Assault',
        'robbery': 'Armed Robbery',
        'kidnapping': 'Kidnapping/Abduction',
        'burglary': 'Break-in/Burglary',
        'breakin': 'Break-in/Burglary',
        'medical': 'Medical Emergency',
        'fire': 'Fire/Accident',
        'harassment': 'Harassment/Stalking',
        'other': 'Emergency'
    }
    
    category = panic_data.emergency_category or 'other'
    category_label = CATEGORY_LABELS.get(category, 'Emergency')
    
    panic_event = {
        'user_id': str(user['_id']),
        'activated_at': datetime.utcnow(),
        'is_active': True,
        'emergency_category': category,
        'location': {
            'type': 'Point',
            'coordinates': [panic_data.longitude, panic_data.latitude]
        },
        'locations': [{
            'latitude': panic_data.latitude,
            'longitude': panic_data.longitude,
            'accuracy': panic_data.accuracy,
            'timestamp': panic_data.timestamp
        }]
    }
    result = await db.panic_events.insert_one(panic_event)
    
    # Notify nearby security users
    security_teams = await db.security_teams.find({
        'teamLocation.coordinates': {
            '$near': {
                '$geometry': {'type': 'Point', 'coordinates': [panic_data.longitude, panic_data.latitude]},
                '$maxDistance': 50000  # 50km max
            }
        }
    }).to_list(100)
    
    security_user_ids = [team['user_id'] for team in security_teams]
    if security_user_ids:
        # Send push notifications with category
        await send_push_notification(
            security_user_ids,
            f"🚨 {category_label.upper()} ALERT",
            f"{category_label} reported nearby at {panic_data.latitude:.4f}, {panic_data.longitude:.4f}",
            {'type': 'panic', 'event_id': str(result.inserted_id), 'category': category}
        )
        
        # Send email alerts to security users
        try:
            security_users = await db.users.find({
                '_id': {'$in': [ObjectId(uid) for uid in security_user_ids]}
            }).to_list(length=None)
            
            for sec_user in security_users:
                if sec_user.get('email'):
                    await email_service.send_panic_alert_email(
                        to_email=sec_user['email'],
                        reporter_name=user.get('email', 'Unknown'),
                        latitude=panic_data.latitude,
                        longitude=panic_data.longitude,
                        timestamp=datetime.utcnow()
                    )
        except Exception as e:
            logging.error(f"Error sending panic emails: {e}")
    
    return {'panic_id': str(result.inserted_id), 'message': 'Panic activated'}

@api_router.post("/panic/location")
async def log_panic_location(location: LocationPoint, user = Depends(get_current_user)):
    panic_event = await db.panic_events.find_one({'user_id': str(user['_id']), 'is_active': True})
    if not panic_event:
        raise HTTPException(status_code=404, detail="No active panic")
    
    await db.panic_events.update_one(
        {'_id': panic_event['_id']},
        {'$push': {'locations': {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'accuracy': location.accuracy,
            'timestamp': location.timestamp
        }}}
    )
    return {'message': 'Location logged'}

@api_router.post("/panic/deactivate")
async def deactivate_panic(user = Depends(get_current_user)):
    await db.panic_events.update_one(
        {'user_id': str(user['_id']), 'is_active': True},
        {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow()}}
    )
    return {'message': 'Panic deactivated'}

@api_router.post("/escort/action")
async def escort_action(action: str = Body(...), location: LocationPoint = Body(...), user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can use escort")
    if not user.get('is_premium'):
        raise HTTPException(status_code=403, detail="Premium feature")
    
    if action == 'start':
        # Seed locations[] with the activation point so security page
        # is never empty — subsequent /escort/location calls append to this
        initial_point = {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'accuracy': location.accuracy,
            'timestamp': location.timestamp if location.timestamp else datetime.utcnow(),
        }
        session = {
            'user_id': str(user['_id']),
            'started_at': datetime.utcnow(),
            'is_active': True,
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'locations': [initial_point]
        }
        result = await db.escort_sessions.insert_one(session)
        
        # Create real-time track document
        await db.civil_tracks.insert_one({
            'user_id': str(user['_id']),
            'session_id': str(result.inserted_id),
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude],
                'timestamp': datetime.utcnow()
            },
            'is_active': True
        })
        
        return {'session_id': str(result.inserted_id), 'message': 'Escort started'}
    
    elif action == 'stop':
        session = await db.escort_sessions.find_one({'user_id': str(user['_id']), 'is_active': True})
        if not session:
            raise HTTPException(status_code=404, detail="No active session")
        
        # Schedule deletion after 24h
        await db.escort_sessions.update_one(
            {'_id': session['_id']},
            {'$set': {'is_active': False, 'ended_at': datetime.utcnow(), 'delete_at': datetime.utcnow() + timedelta(hours=24)}}
        )
        await db.civil_tracks.delete_one({'user_id': str(user['_id']), 'session_id': str(session['_id'])})
        
        return {'message': 'Arrived safely. Data will be deleted in 24h'}

@api_router.post("/escort/location")
async def log_escort_location(location: LocationPoint, user = Depends(get_current_user)):
    # Allow location posting if the user has an active escort session
    # (belt-and-suspenders: don't block GPS if premium flag is stale)
    session = await db.escort_sessions.find_one({'user_id': str(user['_id']), 'is_active': True})
    if not session:
        # Only enforce premium if there is no active session at all
        if not user.get('is_premium'):
            raise HTTPException(status_code=403, detail="Premium feature")
        raise HTTPException(status_code=404, detail="No active escort session")
    
    # Update session history
    await db.escort_sessions.update_one(
        {'_id': session['_id']},
        {'$push': {'locations': {
            'latitude': location.latitude,
            'longitude': location.longitude,
            'timestamp': location.timestamp
        }}}
    )
    
    # Update real-time track
    await db.civil_tracks.update_one(
        {'user_id': str(user['_id']), 'is_active': True},
        {'$set': {
            'currentLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude],
                'timestamp': datetime.utcnow()
            }
        }}
    )
    
    return {'message': 'Location logged'}

@api_router.post("/report/create")
async def create_report(report: ReportCreate, user = Depends(get_current_user)):
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can create reports")
    
    report_data = {
        'user_id': str(user['_id']),
        'type': report.type,
        'caption': report.caption,
        'is_anonymous': report.is_anonymous,
        'file_url': report.file_url,
        'thumbnail': report.thumbnail,
        'uploaded': report.uploaded,
        'location': {
            'type': 'Point',
            'coordinates': [report.longitude, report.latitude]
        },
        'geohash': geohash(report.latitude, report.longitude),
        'created_at': datetime.utcnow()
    }
    
    result = await db.civil_reports.insert_one(report_data)
    
    # Notify nearby security
    security_teams = await db.security_teams.find({
        'teamLocation.coordinates': {
            '$near': {
                '$geometry': {'type': 'Point', 'coordinates': [report.longitude, report.latitude]},
                '$maxDistance': 50000
            }
        }
    }).to_list(100)
    
    security_user_ids = [team['user_id'] for team in security_teams]
    if security_user_ids:
        await send_push_notification(
            security_user_ids,
            f"📹 New {report.type.upper()} Report",
            f"Report submitted nearby: {report.caption or 'No caption'}",
            {'type': 'report', 'report_id': str(result.inserted_id)}
        )
    
    return {'report_id': str(result.inserted_id), 'message': 'Report created'}

class VideoUpload(BaseModel):
    video_data: str  # Base64 encoded video — kept for backwards compatibility only
    caption: Optional[str] = None
    is_anonymous: bool = False
    latitude: float
    longitude: float
    duration_seconds: Optional[int] = 0

# Import video transcoder
from video_transcoder import (
    transcode_video_async, 
    get_video_info, 
    should_transcode_sync,
    select_profile,
    transcode_queue
)

@api_router.post("/report/upload-video")
async def upload_video_report(
    request: Request,
    user = Depends(get_current_user)
):
    """
    Upload video report — accepts multipart/form-data (preferred) or legacy base64 JSON.
    Multipart is ~33% smaller on the wire and much faster to decode on the server.
    Server-side FFmpeg transcoding reduces output to WhatsApp-level file sizes (~1.5-2MB/min).
    """
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can create reports")

    try:
        import base64 as b64mod
        import uuid, shutil

        content_type = request.headers.get('content-type', '')

        # ── Decode payload ────────────────────────────────────────────────
        if 'multipart/form-data' in content_type:
            # Preferred path — no base64 overhead
            form = await request.form()
            video_file = form.get('video')
            if not video_file:
                raise HTTPException(status_code=400, detail="No video file in multipart form")
            video_bytes = await video_file.read()
            caption       = str(form.get('caption', '')) or None
            is_anonymous  = str(form.get('is_anonymous', 'false')).lower() == 'true'
            latitude      = float(form.get('latitude', 0))
            longitude     = float(form.get('longitude', 0))
            duration_s    = int(float(form.get('duration_seconds', 0)))
        else:
            # Legacy base64 JSON path — still supported
            body = await request.json()
            raw = body.get('video_data', '')
            if not raw:
                raise HTTPException(status_code=400, detail="No video_data in request body")
            video_bytes   = b64mod.b64decode(raw)
            caption       = body.get('caption') or None
            is_anonymous  = bool(body.get('is_anonymous', False))
            latitude      = float(body.get('latitude', 0))
            longitude     = float(body.get('longitude', 0))
            duration_s    = int(body.get('duration_seconds', 0))

        if not video_bytes:
            raise HTTPException(status_code=400, detail="Video file is empty")

        original_size_mb = len(video_bytes) / (1024 * 1024)
        logger.info(f"Received video upload: {original_size_mb:.2f}MB via {'multipart' if 'multipart' in content_type else 'base64'}")

        # ── Save raw upload ───────────────────────────────────────────────
        unique_id = uuid.uuid4().hex[:8]
        original_filename   = f"video_orig_{str(user['_id'])}_{unique_id}.mp4"
        compressed_filename = f"video_{str(user['_id'])}_{unique_id}.mp4"

        uploads_dir = ROOT_DIR / 'uploads' / 'videos'
        uploads_dir.mkdir(parents=True, exist_ok=True)

        original_path   = uploads_dir / original_filename
        compressed_path = uploads_dir / compressed_filename

        with open(original_path, 'wb') as f:
            f.write(video_bytes)
        del video_bytes  # free memory immediately

        # ── Transcode ─────────────────────────────────────────────────────
        video_info = get_video_info(str(original_path))
        duration   = video_info.get('duration', 0)
        profile    = select_profile(str(original_path), target_size_mb=4.0)  # tighter target
        logger.info(f"Selected transcoding profile: {profile} for {duration:.1f}s video")

        if should_transcode_sync(str(original_path)):
            success, message, transcode_info = await transcode_video_async(
                str(original_path), str(compressed_path), profile
            )
            if success and compressed_path.exists():
                final_filename = compressed_filename
                original_path.unlink(missing_ok=True)
                logger.info(
                    f"Sync transcode: {transcode_info.get('input_size_mb',0):.2f}MB "
                    f"→ {transcode_info.get('output_size_mb',0):.2f}MB"
                )
            else:
                logger.warning(f"Transcoding failed ({message}), using original")
                final_filename = original_filename.replace('_orig', '')
                shutil.move(str(original_path), str(uploads_dir / final_filename))
        else:
            # Long video — serve original immediately, replace with compressed in background
            final_filename = original_filename

            async def on_transcode_complete(job_id, success, message, info):
                if success:
                    await db.civil_reports.update_one(
                        {'file_url': f"/api/media/videos/{original_filename}"},
                        {'$set': {
                            'file_url': f"/api/media/videos/{compressed_filename}",
                            'transcoding_complete': True,
                            'transcode_info': info
                        }}
                    )
                    original_path.unlink(missing_ok=True)

            await transcode_queue.enqueue(
                str(original_path), str(compressed_path), profile, on_transcode_complete
            )

        file_url = f"/api/media/videos/{final_filename}"

        # ── Save report record ────────────────────────────────────────────
        report_data = {
            'user_id':      str(user['_id']),
            'type':         'video',
            'caption':      caption or 'Video report',
            'is_anonymous': is_anonymous,
            'file_url':     file_url,
            'uploaded':     True,
            'duration_seconds': duration_s or int(duration),
            'original_size_mb': round(original_size_mb, 2),
            'transcoding_complete': should_transcode_sync(str(uploads_dir / final_filename))
                                    if (uploads_dir / final_filename).exists() else False,
            'location': {'type': 'Point', 'coordinates': [longitude, latitude]},
            'geohash':  geohash(latitude, longitude),
            'created_at': datetime.utcnow()
        }
        result = await db.civil_reports.insert_one(report_data)

        # ── Notify nearby security ────────────────────────────────────────
        try:
            security_teams = await db.security_teams.find({
                'teamLocation.coordinates': {
                    '$near': {
                        '$geometry': {'type': 'Point', 'coordinates': [longitude, latitude]},
                        '$maxDistance': 50000
                    }
                }
            }).to_list(100)
            ids = [t['user_id'] for t in security_teams]
            if ids:
                await send_push_notification(
                    ids, "📹 New VIDEO Report",
                    f"Video report submitted nearby: {caption or 'No caption'}",
                    {'type': 'report', 'report_id': str(result.inserted_id)}
                )
        except Exception as e:
            logger.warning(f"Failed to notify security: {e}")

        return {
            'report_id':       str(result.inserted_id),
            'file_url':        file_url,
            'message':         'Video report uploaded successfully',
            'original_size_mb': round(original_size_mb, 2),
            'transcoded':      final_filename == compressed_filename,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Video upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {str(e)}")

@api_router.post("/report/upload-audio")
async def upload_audio_report(
    request: Request,
    user = Depends(get_current_user)
):
    """
    Upload an audio recording to the server.
    Accepts multipart/form-data with field 'audio' (file bytes).
    Returns a server-hosted URL that can be played back from any device.
    """
    if user.get('role') != 'civil':
        raise HTTPException(status_code=403, detail="Only civil users can upload audio")

    try:
        form = await request.form()
        audio_file = form.get('audio')
        if not audio_file:
            raise HTTPException(status_code=400, detail="No audio file provided")

        # Read file bytes
        audio_bytes = await audio_file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio file is empty")

        # Determine extension from content type or filename
        content_type = getattr(audio_file, 'content_type', 'audio/m4a') or 'audio/m4a'
        ext_map = {
            'audio/m4a': '.m4a', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3',
            'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.m4a',
            'audio/3gpp': '.3gp', 'audio/ogg': '.ogg',
        }
        ext = ext_map.get(content_type, '.m4a')
        filename = getattr(audio_file, 'filename', '') or ''
        if filename and '.' in filename:
            ext = '.' + filename.rsplit('.', 1)[-1].lower()

        # Save to uploads/audio/
        unique_id = uuid.uuid4().hex[:10]
        audio_filename = f"audio_{str(user['_id'])}_{unique_id}{ext}"
        uploads_dir = ROOT_DIR / 'uploads' / 'audio'
        uploads_dir.mkdir(parents=True, exist_ok=True)
        file_path = uploads_dir / audio_filename

        with open(file_path, 'wb') as f:
            f.write(audio_bytes)

        size_kb = len(audio_bytes) / 1024
        logger.info(f"Audio uploaded: {audio_filename} ({size_kb:.1f} KB)")

        file_url = f"/api/media/audio/{audio_filename}"
        return {
            'file_url': file_url,
            'filename': audio_filename,
            'size_kb': round(size_kb, 1),
            'message': 'Audio uploaded successfully'
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Audio upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload audio: {str(e)}")


@api_router.get("/report/my-reports")
async def get_my_reports(user = Depends(get_current_user)):
    reports = await db.civil_reports.find({'user_id': str(user['_id'])}).sort('created_at', -1).to_list(100)
    return [{
        'id': str(r['_id']),
        'type': r['type'],
        'caption': r.get('caption'),
        'is_anonymous': r.get('is_anonymous'),
        'file_url': r.get('file_url'),
        'thumbnail': r.get('thumbnail'),
        'uploaded': r.get('uploaded'),
        'latitude': r['location']['coordinates'][1],
        'longitude': r['location']['coordinates'][0],
        'created_at': r['created_at']
    } for r in reports]

# ===== SECURITY USER ROUTES =====
@api_router.post("/security/set-location")
async def set_team_location(location: SetTeamLocation, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    await db.security_teams.update_one(
        {'user_id': str(user['_id'])},
        {'$set': {
            'teamLocation': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'radius_km': location.radius_km,
            'updated_at': datetime.utcnow()
        }},
        upsert=True
    )
    return {'message': 'Team location set'}

@api_router.get("/security/team-location")
async def get_team_location(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return {'latitude': 0, 'longitude': 0, 'radius_km': 10.0}
    
    return {
        'latitude': team['teamLocation']['coordinates'][1],
        'longitude': team['teamLocation']['coordinates'][0],
        'radius_km': team.get('radius_km', 10.0)
    }

@api_router.get("/security/nearby-reports")
async def get_nearby_reports(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return []
    
    # Check if team location is set
    team_location = team.get('teamLocation')
    if not team_location or team_location.get('coordinates', [0, 0]) == [0, 0]:
        # Return all recent reports if no location set
        reports = await db.civil_reports.find({}).sort('created_at', -1).to_list(50)
    else:
        radius_meters = team.get('radius_km', 10.0) * 1000
        try:
            reports = await db.civil_reports.find({
                'location': {
                    '$near': {
                        '$geometry': team_location,
                        '$maxDistance': radius_meters
                    }
                }
            }).sort('created_at', -1).to_list(100)
        except Exception as e:
            # If geospatial query fails, return recent reports
            logger.warning(f"Geospatial query failed: {e}")
            reports = await db.civil_reports.find({}).sort('created_at', -1).to_list(50)
    
    result = []
    for r in reports:
        user_info = await db.users.find_one({'_id': ObjectId(r['user_id'])})
        if not user_info:
            user_info = {'email': 'Unknown', 'phone': ''}
        
        result.append({
            'id': str(r['_id']),
            'type': r.get('type', 'unknown'),
            'caption': r.get('caption', ''),
            'is_anonymous': r.get('is_anonymous', False),
            'file_url': r.get('file_url'),
            'thumbnail': r.get('thumbnail'),
            'latitude': r.get('location', {}).get('coordinates', [0, 0])[1] if r.get('location') else 0,
            'longitude': r.get('location', {}).get('coordinates', [0, 0])[0] if r.get('location') else 0,
            'created_at': r.get('created_at'),
            'user_email': user_info.get('email', 'Unknown') if not r.get('is_anonymous') else 'Anonymous',
            'user_phone': user_info.get('phone', '') if not r.get('is_anonymous') else 'Anonymous',
            'duration_seconds': r.get('duration_seconds', 0)
        })
    
    return result

@api_router.get("/security/track-user/{user_id}")
async def track_user(user_id: str, user = Depends(get_current_user)):
    """Get tracking data for a specific user (civil user being tracked)"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    try:
        # Get the civil user
        target_user = await db.users.find_one({'_id': ObjectId(user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if user has active panic or escort session
        active_panic = await db.panic_events.find_one({
            'user_id': user_id,
            'is_active': True
        })
        
        active_escort = await db.escort_sessions.find_one({
            'user_id': user_id,
            'status': 'active'
        })
        
        # Get latest location from panic or escort
        latitude = None
        longitude = None
        last_update = None
        is_active = False
        
        if active_panic:
            is_active = True
            if active_panic.get('locations') and len(active_panic['locations']) > 0:
                latest = active_panic['locations'][-1]
                latitude = latest.get('latitude')
                longitude = latest.get('longitude')
                last_update = latest.get('timestamp')
            elif active_panic.get('location'):
                coords = active_panic['location'].get('coordinates', [0, 0])
                longitude = coords[0]
                latitude = coords[1]
                last_update = active_panic.get('activated_at')
        elif active_escort:
            is_active = True
            if active_escort.get('route') and len(active_escort['route']) > 0:
                latest = active_escort['route'][-1]
                latitude = latest.get('latitude')
                longitude = latest.get('longitude')
                last_update = latest.get('timestamp')
        elif target_user.get('current_location'):
            coords = target_user['current_location'].get('coordinates', [0, 0])
            longitude = coords[0]
            latitude = coords[1]
            last_update = target_user.get('last_location_update')
        
        # Build location history list
        location_history = []
        if active_panic and active_panic.get('locations'):
            for loc in active_panic['locations']:
                location_history.append({
                    'latitude': loc.get('latitude'),
                    'longitude': loc.get('longitude'),
                    'timestamp': loc.get('timestamp').isoformat() if hasattr(loc.get('timestamp'), 'isoformat') else loc.get('timestamp'),
                    'accuracy': loc.get('accuracy'),
                    'source': 'panic'
                })
        elif active_escort and active_escort.get('route'):
            for loc in active_escort['route']:
                location_history.append({
                    'latitude': loc.get('latitude'),
                    'longitude': loc.get('longitude'),
                    'timestamp': loc.get('timestamp').isoformat() if hasattr(loc.get('timestamp'), 'isoformat') else loc.get('timestamp'),
                    'accuracy': loc.get('accuracy'),
                    'source': 'escort'
                })

        return {
            'user_id': user_id,
            'full_name': target_user.get('full_name', ''),
            'email': target_user.get('email', ''),
            'phone': target_user.get('phone', ''),
            'profile_photo_url': target_user.get('profile_photo_url', None),
            'latitude': latitude,
            'longitude': longitude,
            'last_update': last_update.isoformat() if hasattr(last_update, 'isoformat') else last_update,
            'is_active': is_active,
            'has_panic': active_panic is not None,
            'has_escort': active_escort is not None,
            'location_history': location_history
        }
    except Exception as e:
        logger.error(f"Error tracking user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/security/escort-sessions")
async def get_escort_sessions(user = Depends(get_current_user)):
    """Get all active escort sessions for security/admin to monitor GPS routes"""
    if user.get('role') not in ['security', 'admin']:
        raise HTTPException(status_code=403, detail="Security or admin users only")
    
    sessions = await db.escort_sessions.find({'is_active': True}).sort('started_at', -1).to_list(50)
    result = []
    for s in sessions:
        user_info = await db.users.find_one({'_id': ObjectId(s['user_id'])})
        if not user_info:
            user_info = {}
        latest_loc = s.get('locations', [])[-1] if s.get('locations') else None
        result.append({
            'session_id': str(s['_id']),
            'user_name': user_info.get('full_name') or user_info.get('email', 'Unknown'),
            'user_email': user_info.get('email', ''),
            'user_phone': user_info.get('phone', ''),
            'started_at': s.get('started_at'),
            'latitude': latest_loc['latitude'] if latest_loc else None,
            'longitude': latest_loc['longitude'] if latest_loc else None,
            'location_count': len(s.get('locations', [])),
            'route': s.get('locations', [])[-20:],  # Last 20 GPS points
        })
    return result

@api_router.get("/security/nearby-panics")
async def get_nearby_panics(user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    team = await db.security_teams.find_one({'user_id': str(user['_id'])})
    if not team:
        return []
    
    # Check if team location is set
    team_location = team.get('teamLocation')
    if not team_location or team_location.get('coordinates', [0, 0]) == [0, 0]:
        # Return all active panics if no location set
        panics = await db.panic_events.find({'is_active': True}).sort('activated_at', -1).to_list(50)
    else:
        radius_meters = team.get('radius_km', 10.0) * 1000
        try:
            panics = await db.panic_events.find({
                'is_active': True,
                'location': {
                    '$near': {
                        '$geometry': team_location,
                        '$maxDistance': radius_meters
                    }
                }
            }).sort('activated_at', -1).to_list(50)
        except Exception as e:
            logger.warning(f"Geospatial query failed for panics: {e}")
            panics = await db.panic_events.find({'is_active': True}).sort('activated_at', -1).to_list(50)
    
    result = []
    for p in panics:
        user_info = await db.users.find_one({'_id': ObjectId(p['user_id'])})
        if not user_info:
            user_info = {'email': 'Unknown', 'phone': '', 'full_name': ''}
        
        # Get the INITIAL activation location (most accurate for emergency response)
        # This is stored in the GeoJSON 'location' field at panic activation time
        initial_location = p.get('location', {})
        initial_coords = initial_location.get('coordinates', [0, 0]) if initial_location else [0, 0]
        
        # Also get the latest tracked location for comparison
        latest_tracked = p.get('locations', [])[-1] if p.get('locations') else None
        
        # Use initial coordinates by default (captured at panic activation with high accuracy)
        lat = initial_coords[1] if len(initial_coords) >= 2 else 0
        lng = initial_coords[0] if len(initial_coords) >= 2 else 0
        
        # Build user name with fallbacks
        user_full_name = (user_info.get('full_name') or '').strip()
        user_email = user_info.get('email', 'Unknown')
        user_phone = user_info.get('phone', '')
        
        # Include FULL location history for GPS tracking display
        location_history = []
        for loc in p.get('locations', []):
            location_history.append({
                'latitude': loc.get('latitude'),
                'longitude': loc.get('longitude'),
                'accuracy': loc.get('accuracy'),
                'timestamp': loc.get('timestamp').isoformat() if hasattr(loc.get('timestamp'), 'isoformat') else str(loc.get('timestamp', ''))
            })
        
        result.append({
            'id': str(p['_id']),
            'user_id': str(p['user_id']),
            'user_name': user_full_name or user_email,
            'full_name': user_full_name,
            'user_email': user_email,
            'user_phone': user_phone,
            'activated_at': p.get('activated_at'),
            'latitude': lat,
            'longitude': lng,
            'initial_latitude': lat,
            'initial_longitude': lng,
            'latest_latitude': latest_tracked.get('latitude', lat) if latest_tracked else lat,
            'latest_longitude': latest_tracked.get('longitude', lng) if latest_tracked else lng,
            'location_count': len(p.get('locations', [])),
            'emergency_category': p.get('emergency_category', 'other'),
            'profile_photo_url': user_info.get('profile_photo_url'),
            'location_history': location_history  # Full GPS track for security dashboard
        })
    
    return result

@api_router.post("/security/ping-user/{user_id}")
async def ping_user(user_id: str, user = Depends(get_current_user)):
    """Ping a civil user to activate their location services"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    try:
        target_user = await db.users.find_one({'_id': ObjectId(user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        # Record ping in database
        await db.location_pings.insert_one({
            'target_user_id': user_id,
            'pinged_by': str(user['_id']),
            'pinged_at': datetime.utcnow(),
            'status': 'pending'
        })
        return {'success': True, 'message': f"Ping sent to {target_user.get('full_name') or target_user.get('email')}"}
    except Exception as e:
        logger.error(f"Error pinging user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/security/search-user")
async def search_user(search: UserSearch, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    # Search by phone or email
    civil_user = await db.users.find_one({
        '$or': [
            {'email': search.search_term},
            {'phone': search.search_term}
        ],
        'role': 'civil'
    })
    
    if not civil_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get current track
    current_track = await db.civil_tracks.find_one({'user_id': str(civil_user['_id']), 'is_active': True})
    
    # Get historical sessions
    sessions = await db.escort_sessions.find(
        {'user_id': str(civil_user['_id'])}
    ).sort('started_at', -1).limit(10).to_list(10)
    
    return {
        'user_id': str(civil_user['_id']),
        'email': civil_user['email'],
        'phone': civil_user.get('phone'),
        'is_premium': civil_user.get('is_premium', False),
        'current_location': {
            'latitude': current_track['currentLocation']['coordinates'][1],
            'longitude': current_track['currentLocation']['coordinates'][0],
            'timestamp': current_track['currentLocation']['timestamp']
        } if current_track else None,
        'recent_sessions': [{
            'session_id': str(s['_id']),
            'started_at': s['started_at'],
            'ended_at': s.get('ended_at'),
            'is_active': s.get('is_active', False),
            'location_count': len(s.get('locations', []))
        } for s in sessions]
    }

@api_router.get("/security/user-history/{user_id}")
async def get_user_history(user_id: str, user = Depends(get_current_user)):
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    # Get all escort sessions for this user
    sessions = await db.escort_sessions.find(
        {'user_id': user_id}
    ).sort('started_at', -1).to_list(50)
    
    result = []
    for s in sessions:
        result.append({
            'session_id': str(s['_id']),
            'started_at': s['started_at'],
            'ended_at': s.get('ended_at'),
            'is_active': s.get('is_active', False),
            'locations': s.get('locations', [])
        })
    
    return result

# ===== PUSH TOKEN MANAGEMENT =====
@api_router.post("/push-token/register")
async def register_push_token(token: str = Body(...), user = Depends(get_current_user)):
    """Register Expo push token for user"""
    try:
        # Validate token format
        if not expo_push_service.is_valid_token(token):
            raise HTTPException(status_code=400, detail="Invalid Expo push token format")
        
        # Update user's push token
        await db.users.update_one(
            {'_id': user['_id']},
            {'$set': {
                'push_token': token,
                'push_token_updated_at': datetime.utcnow()
            }}
        )
        
        logging.info(f"Push token registered for user {user['email']}")
        return {'message': 'Push token registered successfully'}
        
    except Exception as e:
        logging.error(f"Push token registration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/push-token/unregister")
async def unregister_push_token(user = Depends(get_current_user)):
    """Unregister push token"""
    try:
        await db.users.update_one(
            {'_id': user['_id']},
            {'$unset': {'push_token': '', 'push_token_updated_at': ''}}
        )
        return {'message': 'Push token unregistered successfully'}
    except Exception as e:
        logging.error(f"Push token unregister error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== PAYMENT ROUTES (REAL PAYSTACK) =====
@api_router.post("/payment/init")
async def init_payment(amount: float = Body(...), user = Depends(get_current_user)):
    """Initialize Paystack payment for premium subscription"""
    try:
        # Generate unique reference
        reference = f"SGD_{uuid.uuid4().hex[:12].upper()}"
        
        # Convert amount to kobo (₦2,000 = 200000 kobo)
        amount_in_kobo = int(amount * 100)
        
        # Initialize payment with Paystack
        result = await paystack_service.initialize_transaction(
            email=user['email'],
            amount=amount_in_kobo,
            reference=reference,
            callback_url=None  # Can add callback URL for mobile app
        )
        
        if result.get('status'):
            data = result.get('data', {})
            
            # Store payment reference in database
            await db.payment_transactions.insert_one({
                'user_id': str(user['_id']),
                'reference': reference,
                'amount': amount,
                'amount_kobo': amount_in_kobo,
                'status': 'pending',
                'created_at': datetime.utcnow()
            })
            
            return {
                'status': True,
                'authorization_url': data.get('authorization_url'),
                'access_code': data.get('access_code'),
                'reference': reference,
                'message': 'Payment initialized successfully'
            }
        else:
            raise HTTPException(status_code=400, detail="Payment initialization failed")
            
    except Exception as e:
        logging.error(f"Payment init error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/payment/verify/{reference}")
async def verify_payment(reference: str, user = Depends(get_current_user)):
    """Verify Paystack payment and activate premium"""
    try:
        # Verify payment with Paystack
        result = await paystack_service.verify_transaction(reference)
        
        if result.get('status'):
            data = result.get('data', {})
            
            if data.get('status') == 'success':
                # Update user to premium
                await db.users.update_one(
                    {'_id': user['_id']},
                    {'$set': {
                        'is_premium': True,
                        'premium_activated_at': datetime.utcnow()
                    }}
                )
                
                # Update transaction status
                await db.payment_transactions.update_one(
                    {'reference': reference},
                    {'$set': {
                        'status': 'completed',
                        'verified_at': datetime.utcnow(),
                        'paystack_data': data
                    }}
                )
                
                # Send confirmation email
                try:
                    await email_service.send_payment_confirmation(
                        to_email=user['email'],
                        amount=data.get('amount', 0) / 100,  # Convert from kobo
                        reference=reference
                    )
                except Exception as e:
                    logging.error(f"Email send error: {e}")
                
                return {
                    'status': 'success',
                    'message': 'Premium activated successfully!',
                    'amount': data.get('amount', 0) / 100,
                    'paid_at': data.get('paid_at')
                }
            else:
                return {
                    'status': 'failed',
                    'message': f"Payment status: {data.get('status')}"
                }
        else:
            raise HTTPException(status_code=400, detail="Payment verification failed")
            
    except Exception as e:
        logging.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class PaymentVerify(BaseModel):
    reference: str

@api_router.post("/payment/verify")
async def verify_payment_post(data: PaymentVerify, user = Depends(get_current_user)):
    """Verify payment and activate premium - POST version for demo"""
    try:
        # For demo purposes, auto-activate if reference starts with DEMO_
        if data.reference.startswith('DEMO_'):
            await db.users.update_one(
                {'_id': user['_id']},
                {'$set': {
                    'is_premium': True,
                    'premium_activated_at': datetime.utcnow()
                }}
            )
            return {
                'status': 'success',
                'message': 'Premium activated successfully! (Demo Mode)',
                'is_premium': True
            }
        
        # Otherwise try to verify with Paystack
        result = await paystack_service.verify_transaction(data.reference)
        
        if result.get('status') and result.get('data', {}).get('status') == 'success':
            await db.users.update_one(
                {'_id': user['_id']},
                {'$set': {
                    'is_premium': True,
                    'premium_activated_at': datetime.utcnow()
                }}
            )
            return {
                'status': 'success',
                'message': 'Premium activated successfully!',
                'is_premium': True
            }
        else:
            raise HTTPException(status_code=400, detail="Payment verification failed")
            
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Payment verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN ROUTES =====

async def get_admin_user(authorization: Optional[str] = Header(None)):
    """Verify user is an admin"""
    user = await get_current_user(authorization)
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@api_router.post("/admin/login")
async def admin_login(login_data: AdminLogin):
    """Admin login endpoint"""
    user = await db.users.find_one({'email': login_data.email, 'role': 'admin'})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    
    # Support both 'password' and 'password_hash' field names
    password_field = user.get('password') or user.get('password_hash')
    if not password_field or not verify_password(login_data.password, password_field):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    
    if not user.get('is_active', True):
        raise HTTPException(status_code=403, detail="Admin account is deactivated")
    
    token = create_token(str(user['_id']), user['email'], 'admin')
    
    return {
        'token': token,
        'user_id': str(user['_id']),
        'email': user['email'],
        'full_name': user.get('full_name', ''),
        'role': 'admin'
    }

async def _log_admin_action(admin_id: str, action: str, target_type: str, target_id: str, details: dict = None):
    """Log every admin action to immutable audit log"""
    try:
        await db.admin_audit_log.insert_one({
            'admin_id': admin_id,
            'action': action,
            'target_type': target_type,
            'target_id': target_id,
            'details': details or {},
            'timestamp': datetime.utcnow()
        })
    except Exception as e:
        logger.error(f"Audit log error: {e}")

@api_router.get("/admin/dashboard")
async def admin_dashboard(user: dict = Depends(get_admin_user)):
    """Get enhanced admin dashboard statistics"""
    total_users = await db.users.count_documents({})
    civil_users = await db.users.count_documents({'role': 'civil'})
    security_users = await db.users.count_documents({'role': 'security'})
    premium_users = await db.users.count_documents({'is_premium': True})
    flagged_users = await db.users.count_documents({'is_flagged': True})
    
    active_panics = await db.panic_events.count_documents({'is_active': True})
    total_panics = await db.panic_events.count_documents({})
    false_alarms = await db.panic_events.count_documents({'is_false_alarm': True})
    total_reports = await db.civil_reports.count_documents({})
    active_escorts = await db.escort_sessions.count_documents({'is_active': True})
    
    # Recent activity (last 24 hours)
    yesterday = datetime.utcnow() - timedelta(hours=24)
    recent_panics = await db.panic_events.count_documents({'activated_at': {'$gte': yesterday}})
    recent_reports = await db.civil_reports.count_documents({'created_at': {'$gte': yesterday}})
    new_users = await db.users.count_documents({'created_at': {'$gte': yesterday}})
    
    # Average response time (resolved panics with known duration)
    resolved = await db.panic_events.find({
        'is_active': False, 'deactivated_at': {'$exists': True}, 'activated_at': {'$exists': True}
    }).to_list(100)
    avg_response_mins = 0
    if resolved:
        durations = []
        for p in resolved:
            try:
                dur = (p['deactivated_at'] - p['activated_at']).total_seconds() / 60
                if 0 < dur < 120:
                    durations.append(dur)
            except: pass
        if durations:
            avg_response_mins = round(sum(durations) / len(durations), 1)

    # Panic breakdown by category (last 30 days)
    thirty_days = datetime.utcnow() - timedelta(days=30)
    panic_pipeline = [
        {'$match': {'activated_at': {'$gte': thirty_days}}},
        {'$group': {'_id': '$emergency_category', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}}
    ]
    category_breakdown = []
    async for doc in db.panic_events.aggregate(panic_pipeline):
        category_breakdown.append({'category': doc['_id'] or 'other', 'count': doc['count']})

    # Reports by status
    pending_reports = await db.civil_reports.count_documents({'status': {'$in': [None, 'new']}})
    under_review = await db.civil_reports.count_documents({'status': 'under_review'})
    resolved_reports = await db.civil_reports.count_documents({'status': 'resolved'})

    return {
        'total_users': total_users,
        'civil_users': civil_users,
        'security_users': security_users,
        'premium_users': premium_users,
        'flagged_users': flagged_users,
        'active_panics': active_panics,
        'total_panics': total_panics,
        'false_alarms': false_alarms,
        'total_reports': total_reports,
        'active_escorts': active_escorts,
        'avg_response_mins': avg_response_mins,
        'pending_reports': pending_reports,
        'under_review_reports': under_review,
        'resolved_reports': resolved_reports,
        'recent_24h': {
            'panics': recent_panics,
            'reports': recent_reports,
            'new_users': new_users
        },
        'category_breakdown': category_breakdown
    }

@api_router.get("/admin/users")
async def admin_get_users(
    role: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    user: dict = Depends(get_admin_user)
):
    """Get all users with optional role filter — excludes hard-deleted users"""
    # Only return users that have NOT been hard-deleted
    query: dict = {'deleted_at': {'$exists': False}}
    if role:
        query['role'] = role

    users = await db.users.find(query).sort('created_at', -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.users.count_documents(query)

    return {
        'users': [{
            'id': str(u['_id']),
            'email': u.get('email'),
            'full_name': u.get('full_name', ''),
            'phone': u.get('phone', ''),
            'role': u.get('role'),
            'security_sub_role': u.get('security_sub_role'),
            'team_name': u.get('team_name', ''),
            'is_active': u.get('is_active', True),
            'is_premium': u.get('is_premium', False),
            'is_flagged': u.get('is_flagged', False),
            'flag_reason': u.get('flag_reason', ''),
            'is_verified': u.get('is_verified', False),
            'profile_photo_url': u.get('profile_photo_url'),
            'status': u.get('status', 'offline'),
            'created_at': u.get('created_at', datetime.utcnow()).isoformat()
        } for u in users],
        'total': total,
        'skip': skip,
        'limit': limit
    }

@api_router.put("/admin/users/{user_id}/toggle")
async def admin_toggle_user(user_id: str, user: dict = Depends(get_admin_user)):
    """Activate/deactivate a user"""
    target_user = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_status = not target_user.get('is_active', True)
    await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_active': new_status}}
    )
    await _log_admin_action(str(user['_id']), 'toggle_user', 'user', user_id, {'new_status': new_status})
    return {'message': f"User {'activated' if new_status else 'deactivated'}", 'is_active': new_status}

@api_router.put("/admin/users/{user_id}/flag")
async def admin_flag_user(user_id: str, reason: str = Body(...), user: dict = Depends(get_admin_user)):
    """Flag/unflag a user for suspicious activity"""
    target_user = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    currently_flagged = target_user.get('is_flagged', False)
    await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_flagged': not currently_flagged, 'flag_reason': reason if not currently_flagged else ''}}
    )
    await _log_admin_action(str(user['_id']), 'flag_user' if not currently_flagged else 'unflag_user', 'user', user_id, {'reason': reason})
    return {'is_flagged': not currently_flagged}

@api_router.put("/admin/users/{user_id}/premium")
async def admin_toggle_premium(user_id: str, user: dict = Depends(get_admin_user)):
    """Manually toggle a user's premium status"""
    target_user = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    new_premium = not target_user.get('is_premium', False)
    await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_premium': new_premium}}
    )
    await _log_admin_action(str(user['_id']), 'toggle_premium', 'user', user_id, {'is_premium': new_premium})
    return {'is_premium': new_premium}

@api_router.put("/admin/users/{user_id}/verify")
async def admin_verify_user(user_id: str, user: dict = Depends(get_admin_user)):
    """Verify a user's identity"""
    target_user = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    new_verified = not target_user.get('is_verified', False)
    await db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'is_verified': new_verified}}
    )
    await _log_admin_action(str(user['_id']), 'verify_user', 'user', user_id, {'is_verified': new_verified})
    return {'is_verified': new_verified}

@api_router.get("/admin/users/{user_id}/timeline")
async def admin_user_timeline(user_id: str, user: dict = Depends(get_admin_user)):
    """Get a user's full activity timeline"""
    events = []
    # Panics
    panics = await db.panic_events.find({'user_id': user_id}).sort('activated_at', -1).to_list(50)
    for p in panics:
        events.append({
            'type': 'panic', 'icon': 'alert-circle', 'color': '#EF4444',
            'title': f"Panic Activated — {(p.get('emergency_category') or 'other').title()}",
            'timestamp': p.get('activated_at', datetime.utcnow()).isoformat(),
            'detail': 'Resolved' if not p.get('is_active') else 'Still Active',
            'is_false_alarm': p.get('is_false_alarm', False)
        })
    # Reports
    reports = await db.civil_reports.find({'user_id': user_id}).sort('created_at', -1).to_list(50)
    for r in reports:
        events.append({
            'type': 'report', 'icon': 'videocam' if r.get('type') == 'video' else 'mic', 'color': '#3B82F6',
            'title': f"{(r.get('type') or 'report').title()} Report Submitted",
            'timestamp': r.get('created_at', datetime.utcnow()).isoformat(),
            'detail': r.get('caption', 'No caption')
        })
    # Escort sessions
    escorts = await db.escort_sessions.find({'user_id': user_id}).sort('started_at', -1).to_list(20)
    for e in escorts:
        events.append({
            'type': 'escort', 'icon': 'navigate', 'color': '#10B981',
            'title': 'Security Escort Session',
            'timestamp': e.get('started_at', datetime.utcnow()).isoformat(),
            'detail': f"{len(e.get('locations', []))} GPS points recorded"
        })
    # Sort all by timestamp desc
    events.sort(key=lambda x: x['timestamp'], reverse=True)
    return {'timeline': events[:80]}

@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, user: dict = Depends(get_admin_user)):
    """
    Hard-delete a user permanently from the database.
    Also cleans up associated panic events, escort sessions and tracks.
    """
    # Verify user exists first
    target = await db.users.find_one({'_id': ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    uid_str = str(user_id)

    # Hard delete the user document
    result = await db.users.delete_one({'_id': ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # Clean up orphaned data for this user
    try:
        await db.panic_events.delete_many({'user_id': uid_str})
    except Exception:
        pass
    try:
        await db.escort_sessions.delete_many({'user_id': uid_str})
    except Exception:
        pass
    try:
        await db.civil_tracks.delete_many({'user_id': uid_str})
    except Exception:
        pass
    try:
        await db.civil_reports.delete_many({'user_id': uid_str})
    except Exception:
        pass

    await _log_admin_action(
        str(user['_id']), 'delete_user', 'user', uid_str,
        {'email': target.get('email'), 'role': target.get('role')}
    )

    return {'message': 'User permanently deleted', 'deleted_id': uid_str}

@api_router.get("/admin/security-map")
async def admin_security_map(user: dict = Depends(get_admin_user)):
    """Get all security users with their locations for map display"""
    security_users = await db.users.find({
        'role': 'security',
        'is_active': True,
        'current_location': {'$exists': True}
    }).to_list(length=500)
    
    return {
        'security_users': [{
            'id': str(u['_id']),
            'full_name': u.get('full_name', u.get('email', 'Unknown')),
            'email': u.get('email'),
            'security_sub_role': u.get('security_sub_role', 'team_member'),
            'team_name': u.get('team_name', ''),
            'status': u.get('status', 'offline'),
            'location': u.get('current_location'),
            'last_location_update': u.get('last_location_update', datetime.utcnow()).isoformat()
        } for u in security_users]
    }

@api_router.get("/admin/all-panics")
async def admin_all_panics(
    active_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_admin_user)
):
    """Get all panic events with full user details"""
    query: dict = {'is_active': True} if active_only else {}

    # Optional date range filter
    if start_date or end_date:
        date_filter: dict = {}
        try:
            if start_date:
                date_filter['$gte'] = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            if end_date:
                date_filter['$lte'] = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            if date_filter:
                query['activated_at'] = date_filter
        except Exception:
            pass  # Ignore malformed dates — return unfiltered

    panics = await db.panic_events.find(query).sort('activated_at', -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.panic_events.count_documents(query)

    result = []
    for p in panics:
        try:
            # Safely resolve user info
            user_info = None
            uid = p.get('user_id')
            if uid:
                try:
                    user_info = await db.users.find_one({'_id': ObjectId(str(uid))})
                except Exception:
                    user_info = None

            # Resolve best available lat/lng
            latest_loc = None
            locs = p.get('locations', [])
            if locs:
                latest_loc = locs[-1]

            lat = None
            lng = None
            if latest_loc:
                lat = latest_loc.get('latitude')
                lng = latest_loc.get('longitude')
            elif p.get('location') and p['location'].get('coordinates'):
                coords = p['location']['coordinates']
                if len(coords) >= 2:
                    lng = coords[0]
                    lat = coords[1]

            # Safely serialize activated_at
            activated_raw = p.get('activated_at')
            if activated_raw is None:
                activated_str = datetime.utcnow().isoformat()
            elif isinstance(activated_raw, str):
                activated_str = activated_raw
            else:
                activated_str = activated_raw.isoformat()

            deactivated_raw = p.get('deactivated_at')
            if deactivated_raw is None:
                deactivated_str = None
            elif isinstance(deactivated_raw, str):
                deactivated_str = deactivated_raw
            else:
                deactivated_str = deactivated_raw.isoformat()

            result.append({
                'id': str(p['_id']),
                'user_id': str(uid) if uid else None,
                'full_name': (user_info.get('full_name') or '').strip() if user_info else 'Unknown',
                'user_name': (user_info.get('full_name') or '').strip() if user_info else 'Unknown',
                'user_email': user_info.get('email', 'Unknown') if user_info else 'Unknown',
                'user_phone': user_info.get('phone', '') if user_info else '',
                'profile_photo_url': user_info.get('profile_photo_url') if user_info else None,
                'is_active': bool(p.get('is_active', False)),
                'is_false_alarm': bool(p.get('is_false_alarm', False)),
                'emergency_category': p.get('emergency_category', 'other'),
                'latitude': lat,
                'longitude': lng,
                'location_count': len(locs),
                'locations': locs[-30:],
                'location': p.get('location'),
                'incident_notes': p.get('incident_notes', []),
                'activated_at': activated_str,
                'deactivated_at': deactivated_str,
            })
        except Exception as e:
            logging.error(f"[all-panics] Skipping panic {p.get('_id')}: {e}")
            continue  # Never let one bad record crash the whole list

    return {'panics': result, 'total': total}

@api_router.post("/admin/panics/{panic_id}/deactivate")
async def admin_deactivate_panic(panic_id: str, reason: str = Body('Manual override by admin'), user: dict = Depends(get_admin_user)):
    """Manually deactivate a panic — admin override"""
    result = await db.panic_events.update_one(
        {'_id': ObjectId(panic_id)},
        {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow(), 'deactivated_by': 'admin', 'deactivation_reason': reason}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Panic not found")
    await _log_admin_action(str(user['_id']), 'deactivate_panic', 'panic', panic_id, {'reason': reason})
    return {'message': 'Panic deactivated by admin'}

@api_router.post("/admin/panics/{panic_id}/false-alarm")
async def admin_false_alarm(panic_id: str, user: dict = Depends(get_admin_user)):
    """Mark a panic as a false alarm"""
    panic = await db.panic_events.find_one({'_id': ObjectId(panic_id)})
    if not panic:
        raise HTTPException(status_code=404, detail="Panic not found")
    new_val = not panic.get('is_false_alarm', False)
    await db.panic_events.update_one(
        {'_id': ObjectId(panic_id)},
        {'$set': {'is_false_alarm': new_val}}
    )
    if new_val and panic.get('user_id'):
        # Increment user's false alarm count
        await db.users.update_one({'_id': ObjectId(panic['user_id'])}, {'$inc': {'false_alarm_count': 1}})
    await _log_admin_action(str(user['_id']), 'mark_false_alarm', 'panic', panic_id, {'is_false_alarm': new_val})
    return {'is_false_alarm': new_val}

@api_router.post("/admin/panics/{panic_id}/notes")
async def admin_add_panic_note(panic_id: str, note: str = Body(...), user: dict = Depends(get_admin_user)):
    """Add an incident note to a panic event"""
    note_entry = {
        'note': note,
        'added_by': user.get('email', 'Admin'),
        'added_at': datetime.utcnow().isoformat()
    }
    result = await db.panic_events.update_one(
        {'_id': ObjectId(panic_id)},
        {'$push': {'incident_notes': note_entry}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Panic not found")
    await _log_admin_action(str(user['_id']), 'add_incident_note', 'panic', panic_id, {'note': note[:100]})
    return {'message': 'Note added', 'note': note_entry}

@api_router.put("/admin/reports/{report_id}/status")
async def admin_update_report_status(report_id: str, status: str = Body(...), user: dict = Depends(get_admin_user)):
    """Update report review status: new → under_review → escalated → resolved → forwarded"""
    valid_statuses = ['new', 'under_review', 'escalated', 'resolved', 'forwarded']
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    result = await db.civil_reports.update_one(
        {'_id': ObjectId(report_id)},
        {'$set': {'status': status, 'status_updated_at': datetime.utcnow(), 'status_updated_by': user.get('email')}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Report not found")
    await _log_admin_action(str(user['_id']), 'update_report_status', 'report', report_id, {'status': status})
    return {'status': status}

@api_router.get("/admin/security-teams")
async def admin_get_security_teams(user: dict = Depends(get_admin_user)):
    """Get all security teams with their members"""
    teams_raw = await db.security_teams.find({}).to_list(100)
    result = []
    for team in teams_raw:
        members = await db.users.find({'team_name': team.get('name'), 'role': 'security'}).to_list(50)
        result.append({
            'id': str(team['_id']),
            'name': team.get('name', 'Unnamed Team'),
            'team_location': team.get('teamLocation'),
            'radius_km': team.get('radius_km', 10.0),
            'member_count': len(members),
            'members': [{
                'id': str(m['_id']),
                'full_name': m.get('full_name', ''),
                'email': m.get('email'),
                'phone': m.get('phone', ''),
                'sub_role': m.get('security_sub_role', 'team_member'),
                'is_active': m.get('is_active', True),
                'status': m.get('status', 'offline'),
                'is_verified': m.get('is_verified', False),
                'profile_photo_url': m.get('profile_photo_url'),
            } for m in members]
        })
    # Also get ungrouped security officers
    all_security = await db.users.find({'role': 'security', 'is_active': True}).to_list(200)
    team_names_in_results = {t['name'] for t in result}
    ungrouped = [m for m in all_security if m.get('team_name', '') not in team_names_in_results or not m.get('team_name')]
    if ungrouped:
        result.append({
            'id': 'ungrouped',
            'name': 'Unassigned Officers',
            'team_location': None,
            'radius_km': 0,
            'member_count': len(ungrouped),
            'members': [{
                'id': str(m['_id']),
                'full_name': m.get('full_name', ''),
                'email': m.get('email'),
                'phone': m.get('phone', ''),
                'sub_role': m.get('security_sub_role', 'team_member'),
                'is_active': m.get('is_active', True),
                'status': m.get('status', 'offline'),
                'is_verified': m.get('is_verified', False),
                'profile_photo_url': m.get('profile_photo_url'),
            } for m in ungrouped]
        })
    return result


class CreateTeam(BaseModel):
    name: str

@api_router.post("/admin/create-team")
async def admin_create_team(team_data: CreateTeam, user: dict = Depends(get_admin_user)):
    """Create a new security team"""
    existing = await db.security_teams.find_one({'name': team_data.name})
    if existing:
        raise HTTPException(status_code=400, detail="Team with this name already exists")
    
    await db.security_teams.insert_one({
        'name': team_data.name,
        'teamLocation': {'type': 'Point', 'coordinates': [0, 0]},
        'radius_km': 10.0,
        'created_at': datetime.utcnow(),
        'created_by': str(user['_id'])
    })
    await _log_admin_action(str(user['_id']), 'create_team', 'team', team_data.name, {})
    return {'message': 'Team created successfully', 'name': team_data.name}


@api_router.get("/admin/analytics")
async def admin_analytics(user: dict = Depends(get_admin_user)):
    """Get analytics data: trends, response times, category breakdowns"""
    now = datetime.utcnow()
    thirty_days = now - timedelta(days=30)
    seven_days = now - timedelta(days=7)

    # Daily panic counts for last 7 days
    daily_panics = []
    for i in range(6, -1, -1):
        day_start = now - timedelta(days=i+1)
        day_end = now - timedelta(days=i)
        count = await db.panic_events.count_documents({
            'activated_at': {'$gte': day_start, '$lt': day_end}
        })
        daily_panics.append({
            'day': day_start.strftime('%a'),
            'date': day_start.strftime('%m/%d'),
            'count': count
        })

    # Category breakdown (30 days)
    cat_pipeline = [
        {'$match': {'activated_at': {'$gte': thirty_days}}},
        {'$group': {'_id': '$emergency_category', 'count': {'$sum': 1}}},
        {'$sort': {'count': -1}}
    ]
    categories = []
    async for doc in db.panic_events.aggregate(cat_pipeline):
        categories.append({'category': doc['_id'] or 'other', 'count': doc['count']})

    # Response times (resolved panics last 30 days)
    resolved = await db.panic_events.find({
        'is_active': False,
        'deactivated_at': {'$exists': True},
        'activated_at': {'$gte': thirty_days}
    }).to_list(200)
    response_buckets = {'<5 min': 0, '5-15 min': 0, '15-30 min': 0, '>30 min': 0}
    for p in resolved:
        try:
            mins = (p['deactivated_at'] - p['activated_at']).total_seconds() / 60
            if mins < 5: response_buckets['<5 min'] += 1
            elif mins < 15: response_buckets['5-15 min'] += 1
            elif mins < 30: response_buckets['15-30 min'] += 1
            else: response_buckets['>30 min'] += 1
        except: pass

    # Reports by type
    video_reports = await db.civil_reports.count_documents({'type': 'video'})
    audio_reports = await db.civil_reports.count_documents({'type': 'audio'})

    # User growth (daily new users last 7 days)
    daily_users = []
    for i in range(6, -1, -1):
        day_start = now - timedelta(days=i+1)
        day_end = now - timedelta(days=i)
        count = await db.users.count_documents({'created_at': {'$gte': day_start, '$lt': day_end}})
        daily_users.append({'day': day_start.strftime('%a'), 'date': day_start.strftime('%m/%d'), 'count': count})

    # False alarm rate
    total_panics_30d = await db.panic_events.count_documents({'activated_at': {'$gte': thirty_days}})
    false_alarms_30d = await db.panic_events.count_documents({'activated_at': {'$gte': thirty_days}, 'is_false_alarm': True})

    return {
        'daily_panics': daily_panics,
        'daily_users': daily_users,
        'categories': categories,
        'response_time_buckets': [{'label': k, 'count': v} for k, v in response_buckets.items()],
        'reports_by_type': [{'type': 'Video', 'count': video_reports}, {'type': 'Audio', 'count': audio_reports}],
        'false_alarm_rate': round((false_alarms_30d / total_panics_30d * 100) if total_panics_30d else 0, 1),
        'total_panics_30d': total_panics_30d,
    }

@api_router.get("/admin/audit-log")
async def admin_audit_log(skip: int = 0, limit: int = 50, user: dict = Depends(get_admin_user)):
    """Get immutable admin audit log"""
    logs = await db.admin_audit_log.find({}).sort('timestamp', -1).skip(skip).limit(limit).to_list(limit)
    total = await db.admin_audit_log.count_documents({})
    result = []
    for log in logs:
        admin = await db.users.find_one({'_id': ObjectId(log['admin_id'])}) if log.get('admin_id') else None
        result.append({
            'id': str(log['_id']),
            'admin_name': admin.get('full_name') or admin.get('email', 'Unknown') if admin else 'Unknown',
            'admin_email': admin.get('email', '') if admin else '',
            'action': log.get('action'),
            'target_type': log.get('target_type'),
            'target_id': log.get('target_id'),
            'details': log.get('details', {}),
            'timestamp': log.get('timestamp', datetime.utcnow()).isoformat()
        })
    return {'logs': result, 'total': total}

@api_router.post("/admin/broadcast")
async def admin_broadcast(
    title: str = Body(...),
    message: str = Body(...),
    target_role: Optional[str] = Body(None),
    user: dict = Depends(get_admin_user)
):
    """Broadcast a push notification/message to all users or by role"""
    query = {'is_active': True}
    if target_role and target_role != 'all':
        query['role'] = target_role
    
    target_users = await db.users.find(query).to_list(5000)
    push_tokens = [u['push_token'] for u in target_users if u.get('push_token')]
    
    # Store broadcast record
    await db.broadcasts.insert_one({
        'title': title,
        'message': message,
        'target_role': target_role or 'all',
        'recipient_count': len(target_users),
        'sent_by': user.get('email'),
        'sent_at': datetime.utcnow()
    })
    
    # Send push notifications in batches of 100
    sent = 0
    for i in range(0, len(push_tokens), 100):
        batch = push_tokens[i:i+100]
        result = await push_service.send_push_notification(batch, title, message, {'type': 'broadcast'})
        sent += result.get('sent_to', 0)
    
    await _log_admin_action(str(user['_id']), 'broadcast', 'all', 'all', {
        'title': title, 'target_role': target_role, 'recipients': len(target_users)
    })
    return {'message': 'Broadcast sent', 'recipients': len(target_users), 'push_sent': sent}

@api_router.get("/admin/all-reports")
async def admin_all_reports(
    report_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    user: dict = Depends(get_admin_user)
):
    """Get all reports with user details and status"""
    query = {}
    if report_type:
        query['type'] = report_type
    reports = await db.civil_reports.find(query).sort('created_at', -1).skip(skip).limit(limit).to_list(length=limit)
    total = await db.civil_reports.count_documents(query)
    result = []
    for r in reports:
        user_info = None
        if not r.get('is_anonymous') and r.get('user_id'):
            try:
                user_info = await db.users.find_one({'_id': ObjectId(r['user_id'])})
            except: pass
        file_url = r.get('file_url', '')
        if file_url and not file_url.startswith('http'):
            file_url = file_url  # relative path, frontend will prepend BACKEND_URL
        result.append({
            'id': str(r['_id']),
            'user_id': r.get('user_id'),
            'full_name': (user_info.get('full_name') or '').strip() if user_info else ('Anonymous' if r.get('is_anonymous') else 'Unknown'),
            'user_email': user_info.get('email', '') if user_info else '',
            'user_phone': user_info.get('phone', '') if user_info else '',
            'type': r.get('type'),
            'caption': r.get('caption', ''),
            'is_anonymous': r.get('is_anonymous', False),
            'file_url': file_url,
            'location': r.get('location'),
            'status': r.get('status', 'new'),
            'status_updated_at': r.get('status_updated_at').isoformat() if r.get('status_updated_at') else None,
            'status_updated_by': r.get('status_updated_by', ''),
            'created_at': r.get('created_at', datetime.utcnow()).isoformat()
        })
    return {'reports': result, 'total': total}

@api_router.post("/admin/invite-codes")
async def admin_create_invite_code(code_data: CreateInviteCode, user: dict = Depends(get_admin_user)):
    """Create a new invite code for security registration"""
    code = code_data.code or f"SG-{uuid.uuid4().hex[:8].upper()}"
    
    existing = await db.invite_codes.find_one({'code': code})
    if existing:
        raise HTTPException(status_code=400, detail="Code already exists")
    
    invite = {
        'code': code,
        'max_uses': code_data.max_uses,
        'used_count': 0,
        'created_by': str(user['_id']),
        'created_at': datetime.utcnow(),
        'expires_at': datetime.utcnow() + timedelta(days=code_data.expires_days),
        'is_active': True
    }
    
    await db.invite_codes.insert_one(invite)
    return {'code': code, 'message': 'Invite code created successfully'}

@api_router.get("/admin/invite-codes")
async def admin_list_invite_codes(user: dict = Depends(get_admin_user)):
    """List all invite codes"""
    codes = await db.invite_codes.find().sort('created_at', -1).to_list(length=100)
    return {
        'codes': [{
            'id': str(c['_id']),
            'code': c['code'],
            'max_uses': c.get('max_uses', 10),
            'used_count': c.get('used_count', 0),
            'is_active': c.get('is_active', True),
            'expires_at': c.get('expires_at', datetime.utcnow()).isoformat(),
            'created_at': c.get('created_at', datetime.utcnow()).isoformat()
        } for c in codes]
    }

# ===== SECURITY USER ENHANCED ROUTES =====

@api_router.post("/security/update-location")
async def security_update_location(location: UpdateLocation, user: dict = Depends(get_current_user)):
    """Manually update security user's location"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {
            'current_location': {
                'type': 'Point',
                'coordinates': [location.longitude, location.latitude]
            },
            'last_location_update': datetime.utcnow()
        }}
    )
    
    return {'message': 'Location updated successfully', 'timestamp': datetime.utcnow().isoformat()}

@api_router.put("/security/status")
async def security_update_status(status_data: UpdateStatus, user: dict = Depends(get_current_user)):
    """Update security user's status"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    valid_statuses = ['available', 'busy', 'responding', 'offline']
    if status_data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    await db.users.update_one(
        {'_id': user['_id']},
        {'$set': {'status': status_data.status, 'status_updated_at': datetime.utcnow()}}
    )
    
    return {'message': 'Status updated', 'status': status_data.status}

@api_router.put("/security/settings")
async def security_update_settings(settings: UpdateSecuritySettings, user: dict = Depends(get_current_user)):
    """Update security user's settings (radius, visibility)"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    update_data = {}
    if settings.visibility_radius_km is not None:
        update_data['visibility_radius_km'] = settings.visibility_radius_km
    if settings.status is not None:
        update_data['status'] = settings.status
    if settings.is_visible is not None:
        update_data['is_visible'] = settings.is_visible
    
    if update_data:
        await db.users.update_one({'_id': user['_id']}, {'$set': update_data})
    
    return {'message': 'Settings updated', 'updated': update_data}

@api_router.get("/security/nearby")
async def security_get_nearby(user: dict = Depends(get_current_user)):
    """Get nearby security users within the user's set radius"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    user_location = user.get('current_location')
    if not user_location:
        raise HTTPException(status_code=400, detail="Please update your location first")
    
    radius_km = user.get('visibility_radius_km', 25)  # Default 25km
    
    # Find nearby security users
    nearby = await db.users.find({
        'role': 'security',
        'is_active': True,
        'is_visible': {'$ne': False},  # Include if not explicitly hidden
        '_id': {'$ne': user['_id']},  # Exclude self
        'current_location': {
            '$near': {
                '$geometry': user_location,
                '$maxDistance': radius_km * 1000  # Convert to meters
            }
        }
    }).to_list(length=100)
    
    return {
        'nearby_users': [{
            'id': str(u['_id']),
            'full_name': u.get('full_name', u.get('email', 'Unknown')),
            'security_sub_role': u.get('security_sub_role', 'team_member'),
            'team_name': u.get('team_name', ''),
            'status': u.get('status', 'offline'),
            'location': u.get('current_location'),
            'last_location_update': u.get('last_location_update', datetime.utcnow()).isoformat()
        } for u in nearby],
        'your_radius_km': radius_km,
        'your_location': user_location
    }

@api_router.get("/security/profile")
async def security_get_profile(user: dict = Depends(get_current_user)):
    """Get security user's full profile"""
    if user.get('role') != 'security':
        raise HTTPException(status_code=403, detail="Security users only")
    
    return {
        'id': str(user['_id']),
        'email': user.get('email'),
        'full_name': user.get('full_name', ''),
        'phone': user.get('phone', ''),
        'security_sub_role': user.get('security_sub_role', 'team_member'),
        'team_name': user.get('team_name', ''),
        'status': user.get('status', 'available'),
        'visibility_radius_km': user.get('visibility_radius_km', 25),
        'is_visible': user.get('is_visible', True),
        'current_location': user.get('current_location'),
        'last_location_update': user.get('last_location_update').isoformat() if user.get('last_location_update') else None
    }

# ===== CHAT & MESSAGING ROUTES =====

@api_router.get("/chat/conversations")
async def get_conversations(user: dict = Depends(get_current_user)):
    """Get all conversations for the current user"""
    user_id = str(user['_id'])
    
    conversations = await db.conversations.find({
        '$or': [
            {'participant_1': user_id},
            {'participant_2': user_id}
        ]
    }).sort('last_message_at', -1).to_list(length=50)
    
    result = []
    for conv in conversations:
        other_id = conv['participant_2'] if conv['participant_1'] == user_id else conv['participant_1']
        other_user = await db.users.find_one({'_id': ObjectId(other_id)})
        
        result.append({
            'id': str(conv['_id']),
            'other_user': {
                'id': other_id,
                'full_name': other_user.get('full_name', other_user.get('email', 'Unknown')) if other_user else 'Unknown',
                'security_sub_role': other_user.get('security_sub_role') if other_user else None,
                'status': other_user.get('status', 'offline') if other_user else 'offline'
            },
            'last_message': conv.get('last_message'),
            'last_message_at': conv.get('last_message_at', datetime.utcnow()).isoformat(),
            'unread_count': conv.get(f'unread_{user_id}', 0)
        })
    
    return {'conversations': result}

@api_router.post("/chat/start")
async def start_conversation(data: dict = Body(...), user: dict = Depends(get_current_user)):
    """Start a new conversation or get existing one"""
    user_id = str(user['_id'])
    to_user_id = data.get('other_user_id') or data.get('to_user_id')
    
    if not to_user_id:
        raise HTTPException(status_code=400, detail="other_user_id is required")
    
    # Check if conversation already exists
    existing = await db.conversations.find_one({
        '$or': [
            {'participant_1': user_id, 'participant_2': to_user_id},
            {'participant_1': to_user_id, 'participant_2': user_id}
        ]
    })
    
    if existing:
        return {'conversation_id': str(existing['_id']), 'existing': True}
    
    # Create new conversation
    conv = {
        'participant_1': user_id,
        'participant_2': to_user_id,
        'created_at': datetime.utcnow(),
        'last_message_at': datetime.utcnow(),
        f'unread_{user_id}': 0,
        f'unread_{to_user_id}': 0
    }
    result = await db.conversations.insert_one(conv)
    
    return {'conversation_id': str(result.inserted_id), 'existing': False}

@api_router.get("/chat/{conversation_id}/messages")
async def get_messages(conversation_id: str, skip: int = 0, limit: int = 50, user: dict = Depends(get_current_user)):
    """Get messages in a conversation"""
    user_id = str(user['_id'])
    
    # Verify user is part of conversation
    conv = await db.conversations.find_one({'_id': ObjectId(conversation_id)})
    if not conv or (conv['participant_1'] != user_id and conv['participant_2'] != user_id):
        raise HTTPException(status_code=403, detail="Not authorized to view this conversation")
    
    # Mark messages as read
    await db.conversations.update_one(
        {'_id': ObjectId(conversation_id)},
        {'$set': {f'unread_{user_id}': 0}}
    )
    
    messages = await db.messages.find({
        'conversation_id': conversation_id
    }).sort('created_at', -1).skip(skip).limit(limit).to_list(length=limit)
    
    return {
        'messages': [{
            'id': str(m['_id']),
            'from_user_id': m['from_user_id'],
            'content': m['content'],
            'message_type': m.get('message_type', 'text'),
            'created_at': m['created_at'].isoformat(),
            'is_mine': m['from_user_id'] == user_id
        } for m in reversed(messages)]
    }

@api_router.post("/chat/send")
async def send_message(message: SendMessage, user: dict = Depends(get_current_user)):
    """Send a message to another user"""
    user_id = str(user['_id'])
    
    # Find or create conversation
    conv = await db.conversations.find_one({
        '$or': [
            {'participant_1': user_id, 'participant_2': message.to_user_id},
            {'participant_1': message.to_user_id, 'participant_2': user_id}
        ]
    })
    
    if not conv:
        conv_result = await db.conversations.insert_one({
            'participant_1': user_id,
            'participant_2': message.to_user_id,
            'created_at': datetime.utcnow(),
            'last_message_at': datetime.utcnow()
        })
        conversation_id = str(conv_result.inserted_id)
    else:
        conversation_id = str(conv['_id'])
    
    # Create message
    msg = {
        'conversation_id': conversation_id,
        'from_user_id': user_id,
        'to_user_id': message.to_user_id,
        'content': message.content,
        'message_type': message.message_type,
        'created_at': datetime.utcnow()
    }
    result = await db.messages.insert_one(msg)
    
    # Update conversation
    await db.conversations.update_one(
        {'_id': ObjectId(conversation_id)},
        {
            '$set': {
                'last_message': message.content[:100],
                'last_message_at': datetime.utcnow()
            },
            '$inc': {f'unread_{message.to_user_id}': 1}
        }
    )
    
    # Send push notification to recipient
    await send_push_notification(
        [message.to_user_id],
        f"New message from {user.get('full_name', user.get('email', 'Security'))}",
        message.content[:100],
        {'type': 'chat', 'conversation_id': conversation_id, 'from_user_id': user_id}
    )
    
    return {
        'message_id': str(result.inserted_id),
        'conversation_id': conversation_id,
        'sent_at': datetime.utcnow().isoformat()
    }

@api_router.get("/chat/unread-count")
async def get_unread_count(user: dict = Depends(get_current_user)):
    """Get total unread message count"""
    user_id = str(user['_id'])
    
    pipeline = [
        {'$match': {
            '$or': [
                {'participant_1': user_id},
                {'participant_2': user_id}
            ]
        }},
        {'$group': {
            '_id': None,
            'total': {'$sum': f'$unread_{user_id}'}
        }}
    ]
    
    result = await db.conversations.aggregate(pipeline).to_list(length=1)
    total = result[0]['total'] if result else 0
    
    return {'unread_count': total}


# ===== BROADCASTS ENDPOINTS =====
@api_router.get("/broadcasts")
async def get_broadcasts(skip: int = 0, limit: int = 30, user: dict = Depends(get_current_user)):
    """Get broadcast messages for the user (all or by role)"""
    user_role = user.get('role', 'civil')
    
    # Get broadcasts targeted to this user's role or all users
    query = {'$or': [{'target_role': 'all'}, {'target_role': user_role}]}
    
    broadcasts = await db.broadcasts.find(query).sort('sent_at', -1).skip(skip).limit(limit).to_list(length=limit)
    
    return {
        'broadcasts': [{
            'id': str(b['_id']),
            'title': b.get('title', ''),
            'message': b.get('message', ''),
            'target_role': b.get('target_role', 'all'),
            'sent_by': b.get('sent_by', 'Admin'),
            'sent_at': b.get('sent_at', datetime.utcnow()).isoformat()
        } for b in broadcasts]
    }


# ===== USERS LIST FOR MESSAGING =====
@api_router.get("/users/contactable")
async def get_contactable_users(user: dict = Depends(get_current_user)):
    """Get list of users that can be messaged by the current user"""
    user_role = user.get('role', 'civil')
    user_id = str(user['_id'])
    
    # Civil users can message security users
    # Security users can message civil users and other security users
    # Admins can message everyone
    
    if user_role == 'civil':
        query = {'role': 'security', 'is_active': True, '_id': {'$ne': ObjectId(user_id)}}
    elif user_role == 'security':
        query = {'role': {'$in': ['civil', 'security']}, 'is_active': True, '_id': {'$ne': ObjectId(user_id)}}
    else:  # admin
        query = {'is_active': True, '_id': {'$ne': ObjectId(user_id)}}
    
    users = await db.users.find(query).limit(100).to_list(length=100)
    
    return {
        'users': [{
            'id': str(u['_id']),
            'full_name': u.get('full_name') or u.get('email', 'Unknown'),
            'email': u.get('email', ''),
            'role': u.get('role', 'civil'),
            'status': u.get('status', 'offline'),
            'profile_photo_url': u.get('profile_photo_url')
        } for u in users]
    }


# ===== DATA RESET AND SEED ENDPOINT =====
@api_router.post("/admin/reset-and-seed")
async def reset_and_seed_data():
    """Reset all data and create fresh specified accounts"""
    try:
        # Clear all old data
        await db.civil_reports.delete_many({})
        await db.panics.delete_many({})
        await db.panic_locations.delete_many({})
        await db.civil_tracks.delete_many({})
        await db.conversations.delete_many({})
        await db.messages.delete_many({})
        await db.users.delete_many({})
        
        # Create specified Civil users
        # Credentials are loaded from environment variables (SEED_CIVIL_n_EMAIL / PASSWORD / NAME / PHONE)
        civil_users = []
        for i in range(1, 6):  # supports up to 5 seed civil users
            email = os.environ.get(f'SEED_CIVIL_{i}_EMAIL')
            pw    = os.environ.get(f'SEED_CIVIL_{i}_PASSWORD')
            if email and pw:
                civil_users.append({
                    "email": email,
                    "password": pw,
                    "full_name": os.environ.get(f'SEED_CIVIL_{i}_NAME', f'Civil User {i}'),
                    "phone": os.environ.get(f'SEED_CIVIL_{i}_PHONE', ''),
                })

        for user in civil_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "civil",
                "is_premium": False,
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created civil user: {user['email']}")
        
        # Create specified Security users (SEED_SECURITY_n_EMAIL / PASSWORD / NAME / PHONE)
        security_users = []
        for i in range(1, 6):
            email = os.environ.get(f'SEED_SECURITY_{i}_EMAIL')
            pw    = os.environ.get(f'SEED_SECURITY_{i}_PASSWORD')
            if email and pw:
                security_users.append({
                    "email": email,
                    "password": pw,
                    "full_name": os.environ.get(f'SEED_SECURITY_{i}_NAME', f'Security User {i}'),
                    "phone": os.environ.get(f'SEED_SECURITY_{i}_PHONE', ''),
                })
        
        for user in security_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "security",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created security user: {user['email']}")
        
        # Create specified Admin users (reuses ADMIN1_* / ADMIN2_* env vars)
        admin_users = []
        for i in range(1, 4):
            email = os.environ.get(f'ADMIN{i}_EMAIL')
            pw    = os.environ.get(f'ADMIN{i}_PASSWORD')
            if email and pw:
                admin_users.append({
                    "email": email,
                    "password": pw,
                    "full_name": os.environ.get(f'ADMIN{i}_NAME', f'Admin {i}'),
                    "phone": os.environ.get(f'ADMIN{i}_PHONE', ''),
                })
        
        for user in admin_users:
            await db.users.insert_one({
                "email": user["email"],
                "password": hash_password(user["password"]),
                "full_name": user["full_name"],
                "phone": user["phone"],
                "role": "admin",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created admin user: {user['email']}")
        
        # Recreate invite codes
        await db.invite_codes.delete_many({})
        default_codes = [
            {"code": "SECURITY2025", "max_uses": 100, "used_count": 0},
            {"code": "SAFEGUARD-TEAM", "max_uses": 50, "used_count": 0},
        ]
        for code_data in default_codes:
            await db.invite_codes.insert_one({
                **code_data,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(days=365),
                "is_active": True
            })
        
        return {
            "status": "success",
            "message": "Data reset and seeded successfully",
            "accounts_created": {
                "civil": 3,
                "security": 2,
                "admin": 2
            }
        }
    except Exception as e:
        logger.error(f"Reset error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN SEARCH ENDPOINT =====
@api_router.get("/admin/search")
async def admin_search(
    query: str = "",
    data_type: str = "all",
    field: str = "all",
    start_date: str = None,
    end_date: str = None,
    user: dict = Depends(get_current_user)
):
    """Search all data - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    results = []
    
    # Build search filter
    search_filter = {}
    if query:
        if field == 'name':
            search_filter['full_name'] = {'$regex': query, '$options': 'i'}
        elif field == 'email':
            search_filter['email'] = {'$regex': query, '$options': 'i'}
        elif field == 'phone':
            search_filter['phone'] = {'$regex': query, '$options': 'i'}
        else:
            search_filter['$or'] = [
                {'full_name': {'$regex': query, '$options': 'i'}},
                {'email': {'$regex': query, '$options': 'i'}},
                {'phone': {'$regex': query, '$options': 'i'}},
                {'caption': {'$regex': query, '$options': 'i'}}
            ]
    
    # Date filter
    date_filter = {}
    if start_date:
        try:
            date_filter['$gte'] = datetime.fromisoformat(start_date)
        except: pass
    if end_date:
        try:
            date_filter['$lte'] = datetime.fromisoformat(end_date) + timedelta(days=1)
        except: pass
    
    if date_filter:
        search_filter['created_at'] = date_filter
    
    # Search panics
    if data_type in ['all', 'panics']:
        panic_filter = {**search_filter}
        panics = await db.panics.find(panic_filter).limit(100).to_list(100)
        for p in panics:
            p['id'] = str(p['_id'])
            p['data_type'] = 'panic'
            del p['_id']
            results.append(p)
    
    # Search reports
    if data_type in ['all', 'reports']:
        report_filter = {**search_filter}
        reports = await db.civil_reports.find(report_filter).limit(100).to_list(100)
        for r in reports:
            r['id'] = str(r['_id'])
            r['data_type'] = 'report'
            del r['_id']
            results.append(r)
    
    # Search users
    if data_type in ['all', 'users']:
        user_filter = {**search_filter}
        users = await db.users.find(user_filter).limit(100).to_list(100)
        for u in users:
            u['id'] = str(u['_id'])
            u['data_type'] = 'user'
            del u['_id']
            if 'password' in u:
                del u['password']
            results.append(u)
    
    # Sort by date
    results.sort(key=lambda x: x.get('created_at', datetime.min), reverse=True)
    
    return {"results": results[:200], "total": len(results)}

# ===== ADMIN DELETE ENDPOINT =====
@api_router.delete("/admin/delete/{data_type}/{item_id}")
async def admin_delete(data_type: str, item_id: str, user: dict = Depends(get_current_user)):
    """Delete a record - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        if data_type == 'panic':
            result = await db.panics.delete_one({'_id': ObjectId(item_id)})
        elif data_type == 'report':
            result = await db.civil_reports.delete_one({'_id': ObjectId(item_id)})
        elif data_type == 'user':
            result = await db.users.delete_one({'_id': ObjectId(item_id)})
        else:
            raise HTTPException(status_code=400, detail="Invalid data type")
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Record not found")
        
        return {"status": "deleted", "id": item_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN TRACK USER ENDPOINT =====
@api_router.get("/admin/track-user/{user_id}")
async def admin_track_user(user_id: str, user: dict = Depends(get_current_user)):
    """Get user tracking data - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        target_user = await db.users.find_one({'_id': ObjectId(user_id)})
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get last known location from panics or security locations
        last_location = None
        
        # Check security team location
        if target_user.get('role') == 'security':
            team_loc = await db.security_locations.find_one({'user_id': user_id})
            if team_loc:
                last_location = {
                    'latitude': team_loc.get('latitude'),
                    'longitude': team_loc.get('longitude'),
                    'timestamp': team_loc.get('updated_at')
                }
        
        # Check panic locations
        panic_loc = await db.panic_locations.find_one(
            {'user_id': user_id},
            sort=[('timestamp', -1)]
        )
        if panic_loc and (not last_location or panic_loc.get('timestamp', datetime.min) > last_location.get('timestamp', datetime.min)):
            last_location = {
                'latitude': panic_loc.get('latitude'),
                'longitude': panic_loc.get('longitude'),
                'timestamp': panic_loc.get('timestamp')
            }
        
        # Count reports and panics
        total_reports = await db.civil_reports.count_documents({'user_id': user_id})
        total_panics = await db.panics.count_documents({'user_id': user_id})
        
        # Get recent activity
        recent_activity = []
        
        recent_reports = await db.civil_reports.find({'user_id': user_id}).sort('created_at', -1).limit(5).to_list(5)
        for r in recent_reports:
            recent_activity.append({
                'type': 'report',
                'description': f"{r.get('type', 'Report').title()} report submitted",
                'timestamp': r.get('created_at')
            })
        
        recent_panics = await db.panics.find({'user_id': user_id}).sort('created_at', -1).limit(5).to_list(5)
        for p in recent_panics:
            recent_activity.append({
                'type': 'panic',
                'description': f"{p.get('category', 'Emergency').replace('_', ' ').title()} panic triggered",
                'timestamp': p.get('created_at')
            })
        
        # Sort by timestamp
        recent_activity.sort(key=lambda x: x.get('timestamp', datetime.min), reverse=True)
        
        # Calculate active days
        all_dates = set()
        for r in recent_reports:
            if r.get('created_at'):
                all_dates.add(r['created_at'].date())
        for p in recent_panics:
            if p.get('created_at'):
                all_dates.add(p['created_at'].date())
        
        return {
            'user_id': user_id,
            'last_location': last_location,
            'total_reports': total_reports,
            'total_panics': total_panics,
            'active_days': len(all_dates),
            'recent_activity': recent_activity[:10]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===== ADMIN MESSAGING ENDPOINT =====
@api_router.post("/admin/message")
async def admin_send_message(
    data: dict = Body(...),
    user: dict = Depends(get_current_user)
):
    """Send message to user - Admin only"""
    if user.get('role') != 'admin':
        raise HTTPException(status_code=403, detail="Admin access required")
    
    to_user_id = data.get('to_user_id')
    content = data.get('content')
    
    if not to_user_id or not content:
        raise HTTPException(status_code=400, detail="to_user_id and content required")
    
    try:
        admin_id = str(user['_id'])
        
        # Find or create conversation
        conv = await db.conversations.find_one({
            '$or': [
                {'participant_1': admin_id, 'participant_2': to_user_id},
                {'participant_1': to_user_id, 'participant_2': admin_id}
            ]
        })
        
        if not conv:
            conv_result = await db.conversations.insert_one({
                'participant_1': admin_id,
                'participant_2': to_user_id,
                'is_admin_chat': True,
                'created_at': datetime.utcnow(),
                'last_message_at': datetime.utcnow()
            })
            conversation_id = str(conv_result.inserted_id)
        else:
            conversation_id = str(conv['_id'])
        
        # Create message
        msg = {
            'conversation_id': conversation_id,
            'from_user_id': admin_id,
            'to_user_id': to_user_id,
            'content': content,
            'message_type': 'admin_message',
            'created_at': datetime.utcnow()
        }
        result = await db.messages.insert_one(msg)
        
        # Update conversation
        await db.conversations.update_one(
            {'_id': ObjectId(conversation_id)},
            {
                '$set': {
                    'last_message': content[:100],
                    'last_message_at': datetime.utcnow()
                }
            }
        )
        
        # Send push notification
        target_user = await db.users.find_one({'_id': ObjectId(to_user_id)})
        if target_user and target_user.get('push_token'):
            await push_service.send_push_notification(
                [target_user['push_token']],
                "Message from Admin",
                content[:100],
                {'type': 'admin_message', 'conversation_id': conversation_id}
            )
        
        return {
            'message_id': str(result.inserted_id),
            'conversation_id': conversation_id,
            'sent_at': datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===== MEDIA FILE SERVING (with video streaming / range request support) =====
@app.get("/api/media/{folder}/{filename}")
async def serve_media_file(folder: str, filename: str, request: Request):
    """Serve uploaded media files with range-request support for video streaming"""
    file_path = ROOT_DIR / 'uploads' / folder / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    suffix = file_path.suffix.lower()
    content_types = {
        '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
        '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
    }
    media_type = content_types.get(suffix, 'application/octet-stream')
    file_size = file_path.stat().st_size
    range_header = request.headers.get('range')
    if range_header and suffix in ('.mp4', '.mov', '.avi', '.webm', '.mp3', '.m4a', '.wav'):
        try:
            range_val = range_header.strip().replace('bytes=', '')
            start_str, end_str = range_val.split('-')
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            chunk_size = end - start + 1
            def iter_file():
                with open(file_path, 'rb') as f:
                    f.seek(start)
                    remaining = chunk_size
                    while remaining > 0:
                        data = f.read(min(65536, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            return StreamingResponse(
                iter_file(), status_code=206, media_type=media_type,
                headers={
                    'Content-Range': f'bytes {start}-{end}/{file_size}',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': str(chunk_size),
                    'Access-Control-Allow-Origin': '*',
                }
            )
        except Exception as e:
            logger.warning(f"Range request error: {e}")
    return FileResponse(
        str(file_path), media_type=media_type,
        headers={'Accept-Ranges': 'bytes', 'Content-Length': str(file_size), 'Access-Control-Allow-Origin': '*'}
    )


# ===== ADMIN: CLEAR AUDIO/VIDEO UPLOADS =====
@api_router.delete("/admin/clear-uploads")
async def admin_clear_uploads(user: dict = Depends(get_admin_user)):
    """
    Permanently delete all audio/video report records, associated media files,
    and any orphaned/pending upload queue entries.
    Phase 1.1: Ensures no pending uploads remain after this operation.
    """
    import shutil
    deleted_records = 0
    deleted_files = 0
    deleted_pending = 0

    # 1. Delete media files from disk
    reports = await db.civil_reports.find({'type': {'$in': ['video', 'audio']}}).to_list(length=None)
    for r in reports:
        file_url = r.get('file_url', '')
        if file_url and file_url.startswith('/api/media/'):
            parts = file_url.replace('/api/media/', '').split('/')
            if len(parts) == 2:
                file_path = ROOT_DIR / 'uploads' / parts[0] / parts[1]
                if file_path.exists():
                    file_path.unlink()
                    deleted_files += 1

    # 2. Delete all video/audio report records from database
    result = await db.civil_reports.delete_many({'type': {'$in': ['video', 'audio']}})
    deleted_records = result.deleted_count

    # 3. Delete any orphaned/pending uploads that failed to associate with a report
    try:
        pending_result = await db.upload_queue.delete_many({})
        deleted_pending += pending_result.deleted_count
    except Exception:
        pass

    # 4. Sweep audio and video upload folders for orphaned files not linked to any report
    # NOTE: photos/ is intentionally excluded — profile photos must not be deleted here.
    try:
        for media_folder in ('videos', 'audio'):
            folder = ROOT_DIR / 'uploads' / media_folder
            if folder.exists():
                for f in folder.iterdir():
                    if f.is_file() and f.name != '.gitkeep':
                        f.unlink()
                        deleted_files += 1
    except Exception:
        pass

    await _log_admin_action(str(user['_id']), 'clear_uploads', 'reports', 'all', {
        'deleted_records': deleted_records,
        'deleted_files': deleted_files,
        'deleted_pending': deleted_pending
    })
    return {
        'message': (
            f'Cleared {deleted_records} report records, {deleted_files} media files, '
            f'and {deleted_pending} pending upload entries'
        ),
        'deleted_records': deleted_records,
        'deleted_files': deleted_files,
        'deleted_pending': deleted_pending
    }


# ===== ADMIN: CLEAR ALL PANICS =====
@api_router.delete("/admin/clear-panics")
async def admin_clear_panics(user: dict = Depends(get_admin_user)):
    """
    Permanently delete every panic record and resolve all orphaned panic sessions.
    Phase 1.1: Ensures no orphaned panic sessions remain after this operation.
    """
    deleted_panics = 0
    deleted_active = 0
    orphans_cleared = 0

    # 1. Delete all records from panic_events (primary collection)
    result = await db.panic_events.delete_many({})
    deleted_panics = result.deleted_count

    # 2. Delete legacy active_panics collection
    try:
        result2 = await db.active_panics.delete_many({})
        deleted_active = result2.deleted_count
    except Exception:
        pass

    # 3. Clear any lingering records in the generic panics collection
    try:
        await db.panics.delete_many({})
    except Exception:
        pass

    # 4. ORPHAN CLEANUP: Find users whose local panic flag is set but no active
    #    panic_event exists, then mark them resolved so they are not stuck.
    #    We achieve this by setting is_active=False on any remaining docs that
    #    somehow survived the delete (belt-and-suspenders) and resetting the
    #    has_active_panic flag on every user record.
    try:
        orphan_result = await db.panic_events.update_many(
            {'is_active': True},
            {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow(),
                      'deactivated_by': 'admin_bulk_clear', 'deactivation_reason': 'Admin bulk clear'}}
        )
        orphans_cleared = orphan_result.modified_count
    except Exception:
        pass

    # 5. Reset has_active_panic flag on all user documents
    try:
        await db.users.update_many(
            {'has_active_panic': True},
            {'$set': {'has_active_panic': False}}
        )
    except Exception:
        pass

    await _log_admin_action(str(user['_id']), 'clear_panics', 'panics', 'all', {
        'deleted_panic_events': deleted_panics,
        'deleted_active_panics': deleted_active,
        'orphans_cleared': orphans_cleared
    })
    return {
        'message': (
            f'Cleared {deleted_panics} panic events, {deleted_active} active panics, '
            f'and resolved {orphans_cleared} orphaned sessions'
        ),
        'deleted_panic_events': deleted_panics,
        'deleted_active_panics': deleted_active,
        'orphans_cleared': orphans_cleared
    }


# ===== ADMIN: RESOLVE TRAPPED PANICS (without deleting) =====
@api_router.post("/admin/resolve-trapped-panics")
async def admin_resolve_trapped_panics(user: dict = Depends(get_admin_user)):
    """
    Force-deactivate every panic that is still marked is_active=True.
    This resolves the 'All Panics trapped and unable to resolve' bug
    without permanently deleting the panic records (audit trail preserved).
    """
    resolved = 0
    try:
        result = await db.panic_events.update_many(
            {'is_active': True},
            {
                '$set': {
                    'is_active': False,
                    'deactivated_at': datetime.utcnow(),
                    'deactivated_by': 'admin_force_resolve',
                    'deactivation_reason': 'Bulk resolve by admin — trapped panic fix'
                }
            }
        )
        resolved = result.modified_count
    except Exception as e:
        logging.error(f"Error resolving trapped panics: {e}")

    # Also clear legacy collections
    try:
        await db.active_panics.update_many(
            {'is_active': True},
            {'$set': {'is_active': False, 'deactivated_at': datetime.utcnow()}}
        )
    except Exception:
        pass

    # Reset user flags
    try:
        await db.users.update_many(
            {'has_active_panic': True},
            {'$set': {'has_active_panic': False}}
        )
    except Exception:
        pass

    await _log_admin_action(str(user['_id']), 'resolve_trapped_panics', 'panics', 'all', {'resolved': resolved})
    return {
        'message': f'Force-resolved {resolved} trapped panic(s). All panics are now deactivated.',
        'resolved': resolved
    }


# ===== ADMIN: RESET ALL DATA =====
@api_router.delete("/admin/reset-all-data")
async def admin_reset_all_data(user: dict = Depends(get_admin_user)):
    """Clear ALL panic events, reports, and uploads - comprehensive cleanup"""
    results = {
        'panic_events': 0,
        'active_panics': 0,
        'civil_reports': 0,
        'escort_sessions': 0,
        'files_deleted': 0
    }
    
    # Clear panic events
    r = await db.panic_events.delete_many({})
    results['panic_events'] = r.deleted_count
    
    # Clear active panics
    try:
        r = await db.active_panics.delete_many({})
        results['active_panics'] = r.deleted_count
    except: pass
    
    # Clear all civil reports
    reports = await db.civil_reports.find({}).to_list(length=None)
    for rep in reports:
        file_url = rep.get('file_url', '')
        if file_url and file_url.startswith('/api/media/'):
            parts = file_url.replace('/api/media/', '').split('/')
            if len(parts) == 2:
                file_path = ROOT_DIR / 'uploads' / parts[0] / parts[1]
                if file_path.exists():
                    file_path.unlink()
                    results['files_deleted'] += 1
    
    r = await db.civil_reports.delete_many({})
    results['civil_reports'] = r.deleted_count
    
    # Clear escort sessions
    r = await db.escort_sessions.delete_many({})
    results['escort_sessions'] = r.deleted_count
    
    # Clear civil tracks
    try:
        await db.civil_tracks.delete_many({})
    except: pass
    
    await _log_admin_action(str(user['_id']), 'reset_all_data', 'system', 'all', results)
    return {
        'message': 'All data cleared successfully',
        'results': results
    }


# ===== ESCORT ETA MONITORING =====
class EscortETA(BaseModel):
    session_id: str
    eta_minutes: int
    destination: Optional[str] = None

@api_router.post("/escort/set-eta")
async def set_escort_eta(eta_data: EscortETA, user = Depends(get_current_user)):
    """Set ETA for an escort session — security teams will be alerted if not safe by then"""
    session = await db.escort_sessions.find_one({'_id': ObjectId(eta_data.session_id)})
    if not session:
        raise HTTPException(status_code=404, detail="Escort session not found")

    eta_time = datetime.utcnow() + timedelta(minutes=eta_data.eta_minutes)
    await db.escort_sessions.update_one(
        {'_id': ObjectId(eta_data.session_id)},
        {'$set': {
            'eta_time': eta_time,
            'eta_minutes': eta_data.eta_minutes,
            'destination': eta_data.destination or '',
            'eta_alerted': False,
        }}
    )
    return {'message': 'ETA set', 'eta_time': eta_time.isoformat(), 'eta_minutes': eta_data.eta_minutes}

@api_router.get("/security/escort-eta-alerts")
async def get_escort_eta_alerts(user = Depends(get_current_user)):
    """Get escort sessions where ETA has passed but user hasn't marked safe"""
    if user.get('role') not in ['security', 'admin']:
        raise HTTPException(status_code=403, detail="Security or admin only")

    now = datetime.utcnow()
    # Sessions that are still active, have an ETA set, and the ETA has passed
    overdue = await db.escort_sessions.find({
        'is_active': True,
        'eta_time': {'$exists': True, '$lt': now},
        'eta_alerted': {'$ne': True}
    }).to_list(50)

    result = []
    for s in overdue:
        user_info = await db.users.find_one({'_id': ObjectId(s['user_id'])})
        if not user_info:
            user_info = {}
        latest_loc = s.get('locations', [])[-1] if s.get('locations') else None
        minutes_overdue = int((now - s['eta_time']).total_seconds() / 60)
        result.append({
            'session_id': str(s['_id']),
            'user_name': user_info.get('full_name') or user_info.get('email', 'Unknown'),
            'user_email': user_info.get('email', ''),
            'user_phone': user_info.get('phone', ''),
            'started_at': s.get('started_at'),
            'eta_time': s.get('eta_time'),
            'eta_minutes': s.get('eta_minutes', 0),
            'minutes_overdue': minutes_overdue,
            'destination': s.get('destination', ''),
            'latitude': latest_loc['latitude'] if latest_loc else None,
            'longitude': latest_loc['longitude'] if latest_loc else None,
        })
        # Mark as alerted so we don't spam
        await db.escort_sessions.update_one({'_id': s['_id']}, {'$set': {'eta_alerted': True}})

    return result


# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup():
    await create_indexes()
    await create_default_admins()
    await create_default_invite_codes()
    # Start the video transcoding queue worker
    await transcode_queue.start_worker()
    logger.info("MongoDB indexes created and default admins initialized")

async def create_default_admins():
    """Create admin accounts from environment variables if they don't exist.

    Required .env keys:
        ADMIN1_EMAIL, ADMIN1_PASSWORD, ADMIN1_NAME, ADMIN1_PHONE
        ADMIN2_EMAIL, ADMIN2_PASSWORD, ADMIN2_NAME, ADMIN2_PHONE  (optional)
    """
    default_admins = []
    # Primary admin (required)
    if os.environ.get('ADMIN1_EMAIL') and os.environ.get('ADMIN1_PASSWORD'):
        default_admins.append({
            "email": os.environ['ADMIN1_EMAIL'],
            "password": os.environ['ADMIN1_PASSWORD'],
            "full_name": os.environ.get('ADMIN1_NAME', 'Admin'),
            "phone": os.environ.get('ADMIN1_PHONE', ''),
        })
    # Secondary admin (optional)
    if os.environ.get('ADMIN2_EMAIL') and os.environ.get('ADMIN2_PASSWORD'):
        default_admins.append({
            "email": os.environ['ADMIN2_EMAIL'],
            "password": os.environ['ADMIN2_PASSWORD'],
            "full_name": os.environ.get('ADMIN2_NAME', 'Admin 2'),
            "phone": os.environ.get('ADMIN2_PHONE', ''),
        })
    
    for admin in default_admins:
        existing = await db.users.find_one({"email": admin["email"]})
        if not existing:
            await db.users.insert_one({
                "email": admin["email"],
                "password": hash_password(admin["password"]),
                "full_name": admin["full_name"],
                "phone": admin.get("phone", ""),
                "role": "admin",
                "is_active": True,
                "created_at": datetime.utcnow()
            })
            logger.info(f"Created admin account: {admin['email']}")

async def create_default_invite_codes():
    """Create default invite codes for security registration"""
    default_codes = [
        {"code": "SECURITY2025", "max_uses": 100, "used_count": 0},
        {"code": "SAFEGUARD-TEAM", "max_uses": 50, "used_count": 0},
        {"code": "SUPERVISOR-ACCESS", "max_uses": 20, "used_count": 0},
    ]
    
    for code_data in default_codes:
        existing = await db.invite_codes.find_one({"code": code_data["code"]})
        if not existing:
            await db.invite_codes.insert_one({
                **code_data,
                "created_at": datetime.utcnow(),
                "expires_at": datetime.utcnow() + timedelta(days=365),
                "is_active": True
            })
            logger.info(f"Created invite code: {code_data['code']}")

@app.on_event("shutdown")
async def shutdown():
    client.close()
