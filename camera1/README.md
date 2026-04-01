# camera1 Backend

This directory contains the current backend and compute services for the FAST demo.

## Contents

- `server.js`: main Node.js backend
- `config.js`: basic config module
- `package.json`: Node scripts
- `requirements-fastapi.txt`: Python/FastAPI dependencies
- `py/`: Python compute modules
- `data/`: local data files, including road network snapshot
- `docs/`: technical documentation

## Main Responsibilities

`server.js` handles:
- static hosting for `UI 2`
- Supabase Auth integration
- Supabase PostgreSQL access
- live incident and camera APIs
- weather, AI summary, and traffic news APIs
- route planning entry
- feedback and admin APIs

`py/api_server.py` handles:
- route planning
- route event analysis
- route event evaluation
- incident normalization
- incident-camera matching
- ML traffic impact prediction

## Start

### Node.js

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm install
npm start
```

### FastAPI

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-fastapi.txt
npm run start:fastapi
```

## Current Scripts

```bash
npm start
npm run start:fastapi
```
