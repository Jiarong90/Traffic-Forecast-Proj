# FAST Demo

FAST means **Forecasting Analytics for Singapore Traffic**.

It is a Singapore traffic forecasting and monitoring demo platform that combines traffic incidents, live camera evidence, route planning, weather information, alerts, user feedback, mobile GPS positioning, and admin-side review functions.

Current web entry:

```text
http://localhost:3000/
```

## Current Features

- Public Home / About / Business Model pages
- Dashboard with live incident overview, recent updates, camera evidence, expressway outlook and hotspot analytics
- Map View with cameras, incidents, ERP, PGS and user feedback map points
- Route Planner with three route options, route confirmation, live location marker, route camera/incident/feedback points and trip cost estimates
- Weather page with postal code/place search and current-location lookup
- Alerts page with traffic reports, traffic news and AI-assisted incident detail explanation
- Habit Routes and frequent locations for logged-in users
- Profile and Settings
- Membership display and PayNow upgrade demo flow
- Admin Users page with user list and feedback history
- FASTbot chatbot
- Android phone GPS upload through `mobile-location.html`

## Current Architecture

```text
fyp_demo/
  start.sh
  README.md

  frontend/
    index.html
    mobile-location.html
    ml-traffic-model.js
    sw.js
    assets/images/
    css/
    js/

  backend/
    server.js
    config.js
    package.json
    src/
      app.js
      db.js
      state.js
      context.js
      middleware/
      routes/
      services/
      utils/

  python/
    api_server.py
    requirements-fastapi.txt
    compute/
    ml/
    data/
    models/

  docs/
    ANDROID_GPS_USAGE.md
    README_代码结构说明.md
    WINDOWS_DEPLOYMENT_GUIDE.md
```

### Frontend

- Main page: `frontend/index.html`
- Runtime JS:
  - `frontend/js/auth.js`
  - `frontend/js/pages/dashboard.js`
  - `frontend/js/pages/routePlanner.js`
  - `frontend/js/pages/weather.js`
  - `frontend/js/features/reroute.js`
  - `frontend/js/features/journey.js`
  - `frontend/js/features/incidentImpact.js`
  - `frontend/js/features/chatbot.js`
  - `frontend/js/features/mobileMenu.js`
  - `frontend/js/app.js`
- Runtime CSS:
  - `frontend/css/base.css`
  - `frontend/css/layout.css`
  - `frontend/css/components.css`
  - `frontend/css/pages-dashboard.css`
  - `frontend/css/pages-map.css`
  - `frontend/css/pages-route.css`
  - `frontend/css/pages-weather.css`
  - `frontend/css/pages-alerts.css`
  - `frontend/css/modals.css`

### Backend

- Main Node.js startup entry: `backend/server.js`
- Express app and middleware: `backend/src/app.js`
- Runtime config: `backend/config.js`
- PostgreSQL pool: `backend/src/db.js`
- Shared route context: `backend/src/context.js`
- Route modules: `backend/src/routes/`
- Service modules: `backend/src/services/`
- Utility modules: `backend/src/utils/`
- Node listens on:

```text
http://localhost:3000/
```

### Python / FastAPI

- FastAPI entry: `python/api_server.py`
- Route compute entry: `python/compute/routing.py`
- Route compute modules: `python/compute/graph.py`, `python/compute/astar.py`, `python/compute/avoidance.py`, `python/compute/route_events.py`
- Traffic impact model: `python/ml/traffic_predictor.py`
- FastAPI listens on:

```text
http://127.0.0.1:8000/
```

## Authentication And Database

The demo uses Supabase Auth and Supabase PostgreSQL.

Main tables in use:

- `auth.users`
- `public.app_user_profiles`
- `public.app_user_settings`
- `public.app_user_feedback_reports`
- `public.habit_routes`
- `public.saved_places`
- `public.traffic_alerts`
- `public.signup_verifications`

## Data Sources

The project integrates:

- data.gov.sg traffic images
- LTA traffic incidents and traffic signal data
- OneMap geocoding / reverse geocoding
- OneMotoring ERP and PGS data
- OpenWeather current weather and forecast
- Gemini for AI text generation
- Google News RSS for traffic news
- Local OpenStreetMap / Overpass-derived Singapore road network snapshot

## Local Road Network

Route planning prefers the local Singapore road network snapshot:

```text
python/data/sg-road-network-overpass.json
```

This avoids depending entirely on live Overpass responses and reduces route planning timeout risk.

## Quick Start macOS / Linux / WSL

### 1. Install Node dependencies

```bash
cd /Users/apple/Desktop/fyp_demo/backend
npm install
```

### 2. Create Python virtual environment

```bash
cd /Users/apple/Desktop/fyp_demo/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r ../python/requirements-fastapi.txt
```

### 3. Configure environment variables

Create or edit:

```text
backend/.env
```

Typical variables:

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

OPENWEATHER_API_KEY=...
GEMINI_API_KEY=...
ONEMAP_API_KEY=...
LTA_ACCOUNT_KEY=...
```

### 4. Start both services

From the project root:

```bash
cd /Users/apple/Desktop/fyp_demo
./start.sh
```

The script starts:

- FastAPI: `http://127.0.0.1:8000`
- Node.js web app: `http://localhost:3000/`

Logs:

- `backend/fastapi.log`
- `backend/node.log`

Press `Ctrl+C` in the terminal to stop both services.

## Manual Start

If you do not use `start.sh`, run two terminals.

Terminal 1:

```bash
cd /Users/apple/Desktop/fyp_demo/backend
source .venv/bin/activate
npm run start:fastapi
```

Terminal 2:

```bash
cd /Users/apple/Desktop/fyp_demo/backend
npm start
```

Open:

```text
http://localhost:3000/
```

## Windows Deployment

Use:

```text
docs/WINDOWS_DEPLOYMENT_GUIDE.md
```

Recommended Windows setup is WSL Ubuntu. Native Windows PowerShell is also documented.

## Android Phone GPS

The demo can use an Android phone as a live GPS device.

Guide:

```text
docs/ANDROID_GPS_USAGE.md
```

Typical flow:

1. Start the web app on the computer.
2. Start `cloudflared tunnel --url http://localhost:3000`.
3. Open the generated HTTPS URL on Android:

```text
https://your-cloudflared-url/mobile-location.html
```

4. Allow browser location permission.
5. The desktop Route Planner can read the latest phone GPS from `/api/mobile-location/latest`.

## Access Rules

Public users can access:

- Home
- About
- Business Model
- Dashboard
- Map View
- Route Planner
- Weather
- Alerts

Logged-in users can additionally use:

- Profile
- Settings
- feedback submission
- Habit Routes saving and management
- saved vehicles and frequent locations

Admin users can additionally use:

- Admin Users
- user feedback history
- feedback deletion
- admin replay recording endpoints

## Route Planner Notes

Route Planner supports:

- postal code / place / MRT input
- current location as start point
- Android phone GPS as live position source
- three route options:
  - fastest
  - fewer lights
  - balanced
- route preference switching
- route card metrics:
  - ETA
  - delay
  - distance
  - traffic lights
  - incident count
  - camera count
  - fuel cost
  - ERP charges
  - total estimated cost
- route confirmation through `USE THIS ROUTE`
- start and destination pins
- live red location marker
- grey travelled route segment
- route-related camera / incident / feedback markers
- nearest live camera toggle
- rerouting when the user deviates or avoids incidents/congestion

## Current Cleanup State

The project has been cleaned and synchronized with the current structure:

- Runtime code is organized into `frontend/`, `backend/`, and `python/`.
- Empty frontend placeholder JS files were removed.
- Empty backend service placeholder files were removed.
- Removed admin simulation legacy controls and backend config leftovers.
- Large unused data/model files were removed to reduce repository size.
- Current large files are kept because they are still used by the demo:
  - `python/data/sg-road-network-overpass.json`
  - `python/data/LTATrafficSignalAspectGEOJSON.geojson`
  - `python/models/traffic_model.pkl`
  - `python/models/incident_classifier.pkl`
  - `python/models/incident_regressor.pkl`

## Useful Documentation

- `docs/README_代码结构说明.md`: detailed code structure
- `docs/ANDROID_GPS_USAGE.md`: Android phone GPS usage
- `docs/WINDOWS_DEPLOYMENT_GUIDE.md`: Windows deployment guide

## Common Issues

### FastAPI cannot start

Check:

- `backend/.venv` exists
- dependencies are installed from `python/requirements-fastapi.txt`
- port `8000` is free

### Node cannot start

Check:

- `backend/node_modules` exists
- `backend/.env` is configured
- port `3000` is free

### Port 3000 is already in use

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Stop the existing process, then restart.

### Port 8000 is already in use

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Stop the existing FastAPI process, then restart.

### Route planning fails

Check:

- FastAPI is running on `127.0.0.1:8000`
- Node is running on `localhost:3000`
- local road network file exists:

```text
python/data/sg-road-network-overpass.json
```

### Current location cannot be obtained

Check:

- browser location permission
- macOS / Windows location permission
- use `localhost` or HTTPS
- for Android phone GPS, use cloudflared HTTPS URL

## GitHub Update

Before pushing:

```bash
cd /Users/apple/Desktop/fyp_demo
git status
```

Then:

```bash
git add .
git commit -m "update FAST demo"
git push origin main
```

Do not commit `.env`, `.venv`, `node_modules`, logs, or local backup folders.
