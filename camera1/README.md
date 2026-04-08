# camera1 Backend

This directory contains the current FAST backend stack.

## Main Files

- Node backend:
  - [/Users/apple/Desktop/fyp_demo/camera1/server.js](/Users/apple/Desktop/fyp_demo/camera1/server.js)
- Config:
  - [/Users/apple/Desktop/fyp_demo/camera1/config.js](/Users/apple/Desktop/fyp_demo/camera1/config.js)
- Node package file:
  - [/Users/apple/Desktop/fyp_demo/camera1/package.json](/Users/apple/Desktop/fyp_demo/camera1/package.json)
- Python dependency list:
  - [/Users/apple/Desktop/fyp_demo/camera1/requirements-fastapi.txt](/Users/apple/Desktop/fyp_demo/camera1/requirements-fastapi.txt)
- FastAPI entry:
  - [/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py](/Users/apple/Desktop/fyp_demo/camera1/py/combined_api_server.py)

## Node Responsibilities

`server.js` currently handles:
- static hosting for `UI 2`
- Supabase Auth session validation
- Supabase PostgreSQL data access
- weather APIs
- traffic incidents and cameras
- ERP / PGS APIs
- traffic news feed
- profile / settings / membership / feedback APIs
- habit routes APIs
- route planning entry APIs
- FastAPI proxy routes
- AI chatbot endpoint
- Android mobile-location APIs

## FastAPI Responsibilities

`py/combined_api_server.py` currently handles:
- route planning compute entry
- route recalculation
- route event analytics
- incident normalization
- incident-camera matching
- expressway forecast
- hotspot analytics
- traffic ML feature assembly

## Python Runtime Notes

The current combined FastAPI service depends on:
- numpy
- pandas
- scikit-learn
- requests
- httpx
- xgboost
- duckdb
- pyarrow
- psutil

On macOS, `xgboost` also requires:

```bash
brew install libomp
```

## Start

### Recommended

From project root:

```bash
cd /Users/apple/Desktop/fyp_demo
./start.sh
```

### Manual

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-fastapi.txt
npm run start:fastapi
```

In another terminal:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

## Current Scripts

```bash
npm start
npm run start:fastapi
```

## Key Directories

- Python code:
  - [/Users/apple/Desktop/fyp_demo/camera1/py](/Users/apple/Desktop/fyp_demo/camera1/py)
- Local data:
  - [/Users/apple/Desktop/fyp_demo/camera1/data](/Users/apple/Desktop/fyp_demo/camera1/data)
- Python ML/data assets:
  - [/Users/apple/Desktop/fyp_demo/camera1/py/data](/Users/apple/Desktop/fyp_demo/camera1/py/data)
  - [/Users/apple/Desktop/fyp_demo/camera1/py/model](/Users/apple/Desktop/fyp_demo/camera1/py/model)
  - [/Users/apple/Desktop/fyp_demo/camera1/py/static](/Users/apple/Desktop/fyp_demo/camera1/py/static)
- Technical docs:
  - [/Users/apple/Desktop/fyp_demo/camera1/docs](/Users/apple/Desktop/fyp_demo/camera1/docs)

## Current Notes

- Route planning can still fall back to older Python compute paths from Node for some endpoints.
- `Expressway Outlook` and `High-Risk Zones` depend on the combined FastAPI server.
- If FastAPI is down, the main website still partially works, but those advanced analytics blocks fail.
