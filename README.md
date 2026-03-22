# Se-Q — Community Safety Platform

Se-Q is a mobile-first public safety platform connecting civilians with security personnel for real-time emergency response, escort tracking, and incident reporting.

## Architecture

```
Se-Q-App6/
├── backend/        FastAPI + MongoDB (Motor async driver)
└── frontend/       React Native + Expo (Expo Router, file-based navigation)
```

## User Roles

| Role | Access |
|------|--------|
| **Civil** | Panic SOS, escort requests, incident reports, messaging |
| **Security** | Panic response, user tracking, nearby reports, escort management |
| **Admin** | Dashboard, user management, analytics, broadcast, audit log |

## Key Features

- 🚨 **Panic SOS** — shake-to-panic, persistent notification shortcut, background location tracking
- 📍 **Escort Tracking** — real-time location sharing between civil and security users
- 📹 **Incident Reports** — photo, audio, and video evidence submission with offline queue
- 💬 **Chat** — direct messaging between civil and security users
- 🔔 **Push Notifications** — Expo push service with panic and report alerts
- 🔒 **PIN Lock** — app-level PIN on every resume from background
- 🗺️ **Security Map** — live map of active security personnel (admin view)

## Setup

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Create .env file:
cp .env.example .env   # then fill in values
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Required `.env` variables:

```env
MONGO_URL=mongodb+srv://...
DB_NAME=seq_db
JWT_SECRET=<strong-random-secret>

# Admin accounts (created on startup if they don't exist)
ADMIN1_EMAIL=you@example.com
ADMIN1_PASSWORD=YourStrongPassword!
ADMIN1_NAME=Your Name
ADMIN1_PHONE=+234...

# Optional second admin
ADMIN2_EMAIL=
ADMIN2_PASSWORD=
ADMIN2_NAME=
ADMIN2_PHONE=
```

### Frontend

```bash
cd frontend
npm install
npx expo start --clear
```

To point at your backend, update `frontend/utils/config.ts`:

```ts
const FALLBACK_URL = 'https://your-backend-url.app.github.dev';
```

Or set it per build profile in `app.json → expo.extra.backendUrl`.

### EAS Build (Android APK)

```bash
eas build --profile preview --platform android
```

## Project Structure — Frontend

```
frontend/app/
├── index.tsx              Auth router (redirects by role)
├── _layout.tsx            Root layout: PIN lock, shake detector, push notifications
├── auth/                  Login, Register
├── civil/                 Civil user screens (home, panic, escort, messages)
├── security/              Security user screens (home, panics, reports, chat, tracking)
├── admin/                 Admin portal (dashboard, users, analytics, map, broadcast)
├── report/                Incident reporting (form, audio, list)
├── settings.tsx           App settings (PIN, notifications, profile)
└── premium.tsx            Premium subscription screen

frontend/utils/
├── config.ts              ← Single source of truth for BACKEND_URL
├── auth.ts                Token storage (SecureStore native / AsyncStorage web)
├── offlineQueue.ts        Queues API calls when offline, replays on reconnect
├── shakeDetector.ts       Accelerometer-based triple-shake detection
└── notifications.ts       Push token registration helpers
```

## License

Private — Directorate for the Actualisation of Sustainable Development Goals (DASDG)
