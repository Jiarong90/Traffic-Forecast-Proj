# FAST Demo

FAST is a Singapore traffic forecasting and monitoring demo platform.

Main web entry:
- `http://localhost:3000/ui2/`

## Current Stack

- Frontend: `/Users/apple/Desktop/fyp_demo/UI 2`
- Node backend: [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
- FastAPI backend: [/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py)
- Core route/analysis engine: [/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py](/Users/apple/Desktop/fyp_demo/camera1/py/compute_engine.py)
- Traffic ML helper: [/Users/apple/Desktop/fyp_demo/camera1/py/ml_traffic_predictor.py](/Users/apple/Desktop/fyp_demo/camera1/py/ml_traffic_predictor.py)
- Database: Supabase PostgreSQL
- Auth: Supabase Auth (`auth.users`, UUID)

## Current Features

- Public pages:
  - Home
  - About
  - Business Model
- Public functional pages:
  - Dashboard
  - Map View
  - Route Planner
  - Weather
  - Alerts
  - Habit Routes page view
- Logged-in user features:
  - Profile
  - Settings
  - Feedback submission
  - Habit route save / rename / delete / alert window
  - Vehicle profiles for trip cost estimation
  - Membership display and upgrade demo flow
- Admin features:
  - Admin Users
  - Admin simulation controls

## Dashboard

Current Dashboard includes:
- Incident Overview
- Recent Updates
- Incident Camera Evidence
- Expressway Outlook
- High-Risk Zones (Historical)

Notes:
- `Expressway Outlook` and `High-Risk Zones` depend on the FastAPI combined service.
- If FastAPI is not running, those blocks will fail to load.

## Map View

Current Map View supports:
- live camera display/hide
- LTA incident display/hide
- ERP display/hide
- PGS display/hide
- camera / incident / ERP / PGS custom map icons
- feedback submission button on the map

## Route Planner

Current Route Planner supports:
- start / destination by postal code, place, MRT, or current location
- 3 route options:
  - fastest
  - fewer lights
  - balanced
- route preference switching
- route card summary:
  - ETA
  - extra delay
  - distance
  - lights
  - incidents count
  - cameras count
  - fuel cost
  - fuel used
  - ERP charges
  - total estimated cost
- saved vehicle selection for route cost estimation
- `USE THIS ROUTE`
- live red-dot navigation
- route camera and incident points after confirmation
- automatic rerouting after deviation
- nearest live camera toggle
- chatbot-triggered route planning
- loading habit routes into planner

## Settings and Vehicles

Current Settings includes:
- display name
- email display
- password update
- frequent locations and routes
- up to 3 saved vehicles

Vehicle profiles store:
- nickname
- vehicle type
- fuel grade
- fuel consumption

Saved vehicles are persisted in backend settings and can be reused in `TRIP COST ESTIMATE`.

## Android Live GPS

This project supports Android phone GPS as a live location source.

Usage guide:
- [/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md](/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md)

## Current Run Method

Recommended:

```bash
cd /Users/apple/Desktop/fyp_demo
./start.sh
```

This starts:
- FastAPI from `camera1/.venv`
- Node backend on port `3000`

## Manual Run Method

### 1. Install Node dependencies

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
```

### 2. Create and prepare Python virtual environment

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
```

### 3. Install required system runtime for XGBoost on macOS

```bash
brew install libomp
```

### 4. Start FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

### 5. Start Node

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

## Environment Variables

Edit:
- [/Users/apple/Desktop/fyp_demo/camera1/.env](/Users/apple/Desktop/fyp_demo/camera1/.env)

Main variables used now include:

```env
PORT=3000
DATABASE_URL=postgresql://...
DATABASE_SSL=true

SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

FASTAPI_BASE_URL=http://127.0.0.1:8000

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...

LTA_ACCOUNT_KEY=...
OPENWEATHER_API_KEY=...
GEMINI_API_KEY=...
ONEMAP_API_KEY=...
```

## Data Sources

- data.gov.sg
- LTA DataMall
- OneMap
- OpenWeather
- Google News RSS
- Gemini
- OneMotoring
- local Singapore road network snapshot

## Important Local Data

- road snapshot:
  - [/Users/apple/Desktop/fyp_demo/camera1/data/sg-road-network-overpass.json](/Users/apple/Desktop/fyp_demo/camera1/data/sg-road-network-overpass.json)
- ERP rate data:
  - [/Users/apple/Desktop/fyp_demo/camera1/data/erp_rates_2026-03-23.json](/Users/apple/Desktop/fyp_demo/camera1/data/erp_rates_2026-03-23.json)

## Common Problems

### Dashboard expressway/hotspot blocks fail

Check:
- FastAPI is running
- `.venv` dependencies are installed
- `libomp` is installed on macOS

### FastAPI fails to start

Check:
- use `camera1/.venv`
- install from `requirements-fastapi.txt`
- install `libomp`

### Port already in use

Check:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

### Android live location fails

Use:
- HTTPS tunnel
- latest `trycloudflare.com` address
- active mobile sharing page

## Documentation

- [/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md](/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md)
- [/Users/apple/Desktop/fyp_demo/camera1/README.md](/Users/apple/Desktop/fyp_demo/camera1/README.md)
- [/Users/apple/Desktop/fyp_demo/camera1/docs/README_一键使用说明.md](/Users/apple/Desktop/fyp_demo/camera1/docs/README_%E4%B8%80%E9%94%AE%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)
- [/Users/apple/Desktop/fyp_demo/camera1/docs/README_代码结构说明.md](/Users/apple/Desktop/fyp_demo/camera1/docs/README_%E4%BB%A3%E7%A0%81%E7%BB%93%E6%9E%84%E8%AF%B4%E6%98%8E.md)
- [/Users/apple/Desktop/fyp_demo/camera1/docs/ROUTING_README.md](/Users/apple/Desktop/fyp_demo/camera1/docs/ROUTING_README.md)
- [/Users/apple/Desktop/fyp_demo/camera1/docs/A星寻路实现指南.md](/Users/apple/Desktop/fyp_demo/camera1/docs/A%E6%98%9F%E5%AF%BB%E8%B7%AF%E5%AE%9E%E7%8E%B0%E6%8C%87%E5%8D%97.md)
- [/Users/apple/Desktop/fyp_demo/camera1/docs/摄像头实现指南.md](/Users/apple/Desktop/fyp_demo/camera1/docs/%E6%91%84%E5%83%8F%E5%A4%B4%E5%AE%9E%E7%8E%B0%E6%8C%87%E5%8D%97.md)
