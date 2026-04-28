# FAST Backend

This directory contains the current backend and compute services for the FAST demo.

## Contents

- `server.js`: Node.js startup entry
- `config.js`: runtime config, paths, API URLs and environment variables
- `package.json`: Node scripts
- `src/app.js`: Express app, static hosting, middleware and rate limit
- `src/db.js`: PostgreSQL pool
- `src/context.js`: shared dependency context for route modules
- `src/routes/`: HTTP API route modules
- `src/services/`: auth, data, FastAPI/Python, Gemini, weather and payload services
- `src/utils/`: shared utility functions
- `../python/requirements-fastapi.txt`: Python/FastAPI dependencies
- Python compute modules now live in `../python/`
- Local data files now live in `../python/data/`
- Technical documentation now lives in `../docs/`

## Main Responsibilities

`server.js` handles:
- app creation
- route registration
- database bootstrap
- process startup

`src/app.js` handles:
- static hosting for `frontend`
- request logging
- JSON middleware
- rate limiting

`src/routes/` handles:
- Supabase Auth integration
- Supabase PostgreSQL access
- live incident and camera APIs
- weather, AI summary, and traffic news APIs
- route planning entry
- feedback and admin APIs

`src/services/` handles:
- Supabase helpers and auth middleware
- verification email delivery
- traffic, camera, incident, ERP, PGS and RSS data loading
- FastAPI calls and Python fallback subprocesses
- payload validation and normalization

`../python/api_server.py` handles:
- route planning
- route event analysis
- route event evaluation
- incident normalization
- incident-camera matching
- ML traffic impact prediction

## Start

### Node.js

```bash
cd /Users/apple/Desktop/fyp_demo/backend
npm install
npm start
```

### FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r ../python/requirements-fastapi.txt
npm run start:fastapi
```

## Current Scripts

```bash
npm start
npm run start:fastapi
```
