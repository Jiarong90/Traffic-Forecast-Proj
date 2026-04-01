# FAST Demo

FAST is a Singapore traffic forecasting and monitoring demo platform. The current web entry is:

- `http://localhost:3000/ui2/`

## Overview

The current system includes:
- Home / About / Business Model public pages
- Dashboard for live traffic incidents and camera evidence
- Map View for live cameras and incident points
- Route Planner with three route options, route confirmation, live location tracking, and route-related cameras/incidents
- Weather query
- Alerts with incident details and traffic news
- Habit Routes
- Profile / Settings
- Admin Users

## Current Architecture

- Frontend: `UI 2/`
- Main backend: `camera1/server.js`
- Python compute service: `camera1/py/api_server.py`
- Core compute modules:
  - `camera1/py/compute_engine.py`
  - `camera1/py/ml_traffic_predictor.py`
- Database: Supabase PostgreSQL
- Authentication: Supabase Auth (`auth.users`, UUID)

## Authentication and Database

The current version uses Supabase Auth and Supabase PostgreSQL.

Main tables in use:
- `auth.users`
- `public.app_user_profiles`
- `public.app_user_settings`
- `public.app_user_feedback_reports`
- `public.habit_routes`
- `public.saved_places`
- `public.traffic_alerts`
- `public.app_settings`
- `public.signup_verifications`

## Run Locally

### 1. Install Node.js dependencies

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
```

### 2. Prepare Python environment for FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
```

### 3. Configure environment variables

Edit:
- `camera1/.env`

Typical required variables:

```env
PORT=3000
DATABASE_URL=postgresql://...
DATABASE_SSL=true

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

PYTHON_BIN=python3
FASTAPI_BASE_URL=http://127.0.0.1:8000

MAIL_DEV_MODE=true
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

LTA_ACCOUNT_KEY=...
OPENWEATHER_API_KEY=...
GEMINI_API_KEY=...
ONEMAP_API_KEY=...
```

### 4. Start FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 5. Start Node.js backend

Open another terminal:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

### 6. Open the site

- `http://localhost:3000/ui2/`

## Public vs Logged-in Access

Public users can access:
- Home
- About
- Business Model
- Dashboard
- Map View
- Route Planner
- Weather
- Alerts
- Habit Routes page view

Logged-in users can additionally use:
- Profile
- Settings
- Feedback submission
- Habit route saving and management

Admin users can additionally use:
- Admin Users
- Admin simulation functions

## Route Planner Notes

Current Route Planner behavior:
- Supports postal code, place name, and MRT station input
- Start point can use current location
- Returns 3 route strategies:
  - fastest
  - fewer lights
  - balanced
- Preference button can switch among the three strategies
- Route cards show:
  - ETA
  - extra delay
  - distance
  - lights
  - incidents count
  - cameras count
- After clicking `USE THIS ROUTE`:
  - start and destination pins are added
  - a red live-location marker follows the user
  - route-related camera points and incident points appear on the map
  - start/destination popup shows name and weather

## Live Data Sources

Current system integrates data from:
- data.gov.sg
- LTA DataMall
- OneMap
- OpenWeather
- Gemini
- Google News RSS
- OpenStreetMap / Overpass-derived local road network snapshot

## Local Road Network

Route planning now prefers a local road network snapshot instead of relying only on live Overpass requests.

Road network file:
- `camera1/data/sg-road-network-overpass.json`

This improves route planning stability and reduces external timeout issues.

## Common Issues

### FastAPI cannot start

Check:
- Python virtual environment is activated
- `requirements-fastapi.txt` is installed
- `python3` architecture matches installed packages

### Port 3000 is already in use

Find the process:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Then stop it and restart `npm start`.

### Current location cannot be obtained

Check:
- browser location permission
- macOS location services
- site permission for `localhost`

### Route planning fails

Check:
- FastAPI is running on `127.0.0.1:8000`
- Node backend is running
- `.env` keys are configured

## GitHub Update

```bash
cd /Users/apple/Desktop/fyp_demo
git status
git add .
git commit -m "your update message"
git push origin main
```
