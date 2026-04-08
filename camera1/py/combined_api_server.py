from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, Header, HTTPException, Depends, Query
from pydantic import BaseModel

from .compute_engine import (
    analyze_events_for_route,
    enrich_incidents_with_cameras,
    evaluate_route_events,
    normalize_incidents,
    plan_routes,
    recalculate_route,
)
from .ml_traffic_predictor import load_or_train, predict

from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import requests
import json
from dotenv import load_dotenv
import os
from math import sqrt
import logging

# temp
import psutil

import traceback
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree
import math
import asyncio
from collections import defaultdict
import xgboost as xgb
import httpx
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional
from fastapi.middleware.cors import CORSMiddleware
import gc
import duckdb

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODEL_DIR = BASE_DIR / "model"
STATIC_DIR = BASE_DIR / "static"
PROJECT_DATA_DIR = BASE_DIR.parent / "data"

LTA_API_KEY = os.getenv("LTA_API_KEY")
DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_API_KEY = os.getenv("SUPABASE_API_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
ONEMAP_TOKEN = os.getenv("authToken")
ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
# Get allowed origins from env, default to localhost for dev
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")


process = psutil.Process(os.getpid())
ram_before = process.memory_info().rss / (1024 * 1024)

# Store the precomputed T+15 speedbands for all 150k links
GLOBAL_T15_CACHE = {}

# Load ML Model
models = {
    "gatekeeper": xgb.Booster(),
    "router": xgb.Booster(),
    "ascent": xgb.Booster(),
    "descent": xgb.Booster()
}
models["gatekeeper"].load_model(str(MODEL_DIR / "gatekeeper.json"))
models["router"].load_model(str(MODEL_DIR / "router.json"))
models["ascent"].load_model(str(MODEL_DIR / "asc_specialist.json"))
models["descent"].load_model(str(MODEL_DIR / "descent_specialist.json"))


ram_after = process.memory_info().rss / (1024 * 1024)
model_ram_usage = ram_after - ram_before

print(f"--- MEMORY DIAGNOSTICS ---")
print(f"Total App RAM so far: {ram_after:.2f} MB")
print(f"RAM consumed by 4 XGBoost Models: {model_ram_usage:.2f} MB")

# Global variables..
# SPECIALIST THRESHOLD
ML_SPECIALIST_THRESHOLD = 0.75

# Load road link data and precompute the mid_lat and mid_lon
road_links_df = pd.read_parquet(DATA_DIR / "road_links.parquet")

for col in ["start_lat", "start_lon", "end_lat", "end_lon"]:
    road_links_df[col] = road_links_df[col].astype(float)

road_links_df["mid_lat"] = (road_links_df["start_lat"] + road_links_df["end_lat"]) / 2.0
road_links_df["mid_lon"] = (road_links_df["start_lon"] + road_links_df["end_lon"]) / 2.0

# Load Neighbor Map 
neighbor_df = pd.read_parquet(DATA_DIR / "link_neighbors_slim.parquet")
neighbor_map = neighbor_df.groupby("link_id")["neighbor_link_id"].apply(list).to_dict()
del neighbor_df
gc.collect()

# Load Weather Map
weather_map = pd.read_parquet(DATA_DIR / "link_station_mapping.parquet").set_index("link_id")["nearest_station_id"].to_dict()

current_rain_mm = 0
# --- Precompute Link Distance Proxy ---
# We do this once on startup so it's not calculated 1000x per minute
road_links_df["link_dist_proxy"] = np.sqrt(
    (road_links_df["start_lat"].astype(float) - road_links_df["end_lat"].astype(float))**2 + 
    (road_links_df["start_lon"].astype(float) - road_links_df["end_lon"].astype(float))**2
)
road_links_df["mid_lat"] = (road_links_df["start_lat"] + road_links_df["end_lat"]) / 2.0
road_links_df["mid_lon"] = (road_links_df["start_lon"] + road_links_df["end_lon"]) / 2.0
# Convert to dict for O(1) speed
road_meta_dict = road_links_df.set_index("link_id")[
    ["mid_lat", "mid_lon", "road_category", "link_dist_proxy"]
].to_dict("index")

# Load data for Speedbands, to be used as inputs for ML.
road_category_dict = road_links_df.set_index("link_id")["road_category"].to_dict()
live_speedbands = defaultdict(list)

# Load Incident Hotspots data
hotspots_df = pd.read_parquet(DATA_DIR / "dashboard_hotspots.parquet")
hotspots_cache = hotspots_df.to_dict(orient="records")
del hotspots_df
gc.collect()

## -- ML FEATURE FRAMEWORK
GATEKEEPER_FEATURES = [
    "sb", "sb_tm5", "sb_tm10", "sb_tm15",
    "delta_0_5", "delta_5_10", "delta_10_15",
    "mid_lat", "mid_lon",
    "acceleration", "link_dist_proxy",
    "rain_mm", "is_raining",
    "road_category", "is_weekend", "is_peak",
    "incident_nearby", "mins_since_nearby_start",
    "nearby_accident", "nearby_roadwork", "nearby_breakdown"
]

GATEKEEPER_THRESHOLD = 0.25


class PayloadModel(BaseModel):
    payload: Dict[str, Any] = {}


# To tidy up and split into separate files in the future if possible
# CLASSES
class HabitRouteIn(BaseModel):
    route_name: str | None = None
    from_label: str | None = None
    to_label: str | None = None
    coords_json: list[list[float]]
    distance_m: float | None = None
    link_ids: list[int] = [] 

class SavedPlaceIn(BaseModel):
    place_name: str
    label: str
    lat: float
    lon: float
    postal: str | None = None 

class RouteSettingsUpdate(BaseModel):
    alert_enabled: bool | None = None
    alert_start_time: str | None = None
    alert_end_time: str | None = None
    route_name: str | None = None

# For simulated predictions
class HijackPayload(BaseModel):
    link_id: int
    sb: int
    sb_tm5: int
    sb_tm10: int
    sb_tm15: int
    delta_0_5: float
    delta_5_10: float
    delta_10_15: float
    acceleration: float
    mid_lat: float
    mid_lon: float
    link_dist_proxy: float
    road_category: int
    rain_mm: float
    is_raining: int
    is_weekend: int
    is_peak: int
    incident_nearby: int     
    mins_since_nearby_start: int
    nearby_accident: int    
    nearby_roadwork: int    
    nearby_breakdown: int

    road_name: str | None = None
    segment_len_m: float | None = 500.0

class HijackRouteRequest(BaseModel):
    coords_json: list
    links: List[HijackPayload]

class DebugRowRequest(BaseModel):
    row: dict

class SegmentInfo(BaseModel):
    link_id: int
    road_name: Optional[str] = "Unknown Road"

class HistoricalPlanRequest(BaseModel):
    segment_sequence: List[Optional[SegmentInfo]]
    day: int          
    bucket: int       
    distance_m: float = 0.0

# For handle_recalculate
class RerouteRequest(BaseModel):
    start: Dict[str, float]
    end: Dict[str, float]
    blocked_edges: List[str] = []
    speedbands: Dict[str, int] = {}
    preference: Optional[str] = "fastest"
    roads: Optional[Dict[str, Any]] = None


PLAN_MODEL_PATH = DATA_DIR / "plan_model.parquet"
LOCAL_ROAD_SNAPSHOT_PATH = PROJECT_DATA_DIR / "sg-road-network-overpass.json"
LOCAL_ROADS_JSON = None

def load_local_road_snapshot():
    try:
        with open(LOCAL_ROAD_SNAPSHOT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or "elements" not in data:
            print("Local road snapshot invalid, falling back to empty map", flush=True)
            return {"elements": []}
        print(f"Loaded local road snapshot: {len(data.get('elements', []))} elements", flush=True)
        return data
    except Exception as e:
        print(f"Failed to load local road snapshot: {e}", flush=True)
        return {"elements": []}





# Poll LTA for live data and store data needed for inputs in dictionary
# Similar process used for when polling data for SQLite3 database for training
async def lightweight_poller():
    url = "https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands"
    headers = {"AccountKey": LTA_API_KEY, "accept": "application/json"}

    while True:
        try:
            print("Fetching lightweight live speed bands...")
            skip = 0

            async with httpx.AsyncClient(timeout=10) as client:
                while True:
                    res = await client.get(f"{url}?$skip={skip}", headers=headers)

                    if res.status_code == 200:
                        data = res.json().get("value", [])

                        # Reached end 
                        if not data:
                            break

                        for item in data:
                            try:
                                lid = int(item["LinkID"])
                                sb = int(item["SpeedBand"])
                            except Exception:
                                continue

                            live_speedbands[lid].insert(0, sb)

                            if len(live_speedbands[lid]) > 4:
                                live_speedbands[lid].pop()

                        if len(data) < 500:
                            break

                        skip += 500
            
                    else:
                        print(f"Poll failed with status {res.status_code}")
                        break

            print(f"Updated cache for {len(live_speedbands)} roads.")

            try:
                await precompute_global_t15()
            except Exception as ml_err:
                print(f"Error in pre-computing T+15 speedbands: {ml_err}")
                traceback.print_exc()


        except Exception as e:
            print(f"Lightweight poller error: {e}")

        await asyncio.sleep(300)

# Scheduler for habit_route alerts
async def alert_scheduler():
    # Define Timezone locally to prevent hoisting issues
    local_sg_tz = timezone(timedelta(hours=8))
    
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                now_str = datetime.now(local_sg_tz).strftime("%H:%M")
                print(f"--- [Scheduler] Heartbeat at {now_str} ---")
                
                headers = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"}

                # Fetch active windows
                res = await client.get(f"{SUPABASE_URL}/rest/v1/habit_routes?alert_enabled=eq.true", headers=headers)
                if res.status_code != 200:
                    await asyncio.sleep(60)
                    continue
                
                for route in res.json():
                    # TIME WINDOW LOGIC
                    start = route.get("alert_start_time", "07:30")
                    end = route.get("alert_end_time", "09:00")
                    
                    in_window = False
                    if start <= end:
                        in_window = start <= now_str <= end
                    else: 
                        in_window = now_str >= start or now_str <= end
                    
                    if not in_window: 
                        continue

                    # CONGESTION THRESHOLD LOGIC
                    all_links = route.get("link_ids", [])
                    if not all_links:
                        continue
                        
                    # Find all links that are currently Band 1, 2, or 3
                    jammed_links = [lid for lid in all_links if live_speedbands.get(lid, [9])[0] < 4]
                    
                    # Force threshold to 0 for testing
                    threshold_limit = 0
                    
                    if len(jammed_links) >= threshold_limit:
                        
                        # --- SPAM PREVENTION LOGIC ---
                        time_limit = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")                        
                        check_url = f"{SUPABASE_URL}/rest/v1/traffic_alerts?route_id=eq.{route['id']}&created_at=gt.{time_limit}"
                        
                        check_res = await client.get(check_url, headers=headers)
                        print(f"DEBUG DB CHECK: Status {check_res.status_code} | Body: {check_res.text}")
                        
                        if check_res.status_code == 200:
                            alerts_found = check_res.json()
                            if len(alerts_found) == 0:
                                # ISSUE ALERT & LOG IT
                                print(f"FIRING NEW ALERT: {route['route_name']}!")
                                
                                log_body = {
                                    "user_id": route["user_id"],
                                    "route_id": route["id"],
                                    "affected_link_ids": jammed_links,
                                    "is_dismissed": False
                                }
                                post_res = await client.post(f"{SUPABASE_URL}/rest/v1/traffic_alerts", headers=headers, json=log_body)
                                print(f"DEBUG DB POST: Status {post_res.status_code} | Body: {post_res.text}")
                            else:
                                print(f"Cooldown active. Found {len(alerts_found)} recent alerts in DB.")
                        else:
                            print(f"DB Check Failed!")

            except Exception as e:
                print(f"Scheduler Error: {e}")

            # Sleep for 60 seconds
            await asyncio.sleep(60)

tracked_incidents = []
active_incidents = {}

MAX_GAP = 15

async def poll_incidents():
    global active_incidents, tracked_incidents
    LTA_INCIDENTS_URL = "https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents"
    LTA_HEADERS = {
        "AccountKey": LTA_API_KEY, 
        "accept": "application/json"
    }
    while True:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(LTA_INCIDENTS_URL, headers=LTA_HEADERS)
                data = response.json()
            
            now = datetime.now()
            new_snapshots = data.get('value', [])

            for snap in new_snapshots:
                s_lat, s_lon = snap.get('Latitude'), snap.get('Longitude')
                s_type = snap.get('Type', 'Unknown') 
                
                if not s_lat or not s_lon: continue

                best_match = None
                for inc in tracked_incidents:
                    dist = sqrt((s_lat - inc['lat'])**2 + (s_lon - inc['lon'])**2)
                    if dist < 0.002: 
                        best_match = inc
                        break
                
                if best_match:
                    best_match['last_seen'] = now
                    # Update type if it changed
                    best_match['type'] = s_type 
                else:
                    best_link = find_nearest_link(s_lat, s_lon) 
                    tracked_incidents.append({
                        'lat': s_lat, 'lon': s_lon,
                        'start': now, 'last_seen': now,
                        'link_id': best_link,
                        'type': s_type 
                    })

            # PRUNE EXPIRED INCIDENTS 
            tracked_incidents = [
                inc for inc in tracked_incidents 
                if (now - inc['last_seen']).total_seconds() / 60.0 <= MAX_GAP
            ]

            active_incidents = {
                inc['link_id']: {
                    "start": inc['start'], 
                    "type": inc.get('type', 'Unknown')
                } 
                for inc in tracked_incidents
            }

            print(f"[{now.strftime('%H:%M')}] {len(active_incidents)} active incidents (Gap-filtered).")

        except Exception as e:
            print(f"Polling Error: {e}")
        
        await asyncio.sleep(120)

def find_nearest_link(lat, lon):
    # find link_id for an incident
    best_lid = None
    min_dist = float('inf')
    for lid, m in road_meta_dict.items():
        d = (lat - m['mid_lat'])**2 + (lon - m['mid_lon'])**2
        if d < min_dist:
            min_dist = d
            best_lid = lid
    return best_lid


def assemble_features(link_id, rain_mm, active_incidents):

    # Get history and immediately apply the padding fix
    vals = live_speedbands.get(link_id, [6, 6, 6, 6]) 
    
    if len(vals) < 4:
        # If we only have [5], turn it into [5, 5, 5, 5]
        current_val = vals[0] if len(vals) > 0 else 6
        vals = vals + [current_val] * (4 - len(vals))
    
    # Now unpack safely
    sb, sb5, sb10, sb15 = vals[0:4]

    # Get Static Context
    meta = road_meta_dict.get(link_id, {})
    
    # Incident Logic
    neighbors = neighbor_map.get(link_id, [])
    nearby_links = [link_id] + neighbors
    
    is_inc = 0
    mins_since = -1
    has_accident = 0
    has_roadwork = 0
    has_breakdown = 0
    start_times = []
    
    # Loop through nearby links to find incidents and their types
    for l in nearby_links:
        if l in active_incidents:
            is_inc = 1
            inc_data = active_incidents[l]
            start_times.append(inc_data["start"])
            
            itype = str(inc_data.get("type", "")).upper()
            if "ACCIDENT" in itype: has_accident = 1
            if "ROADWORKS" in itype or "WORKS" in itype: has_roadwork = 1
            if "VEHICLE" in itype or "BREAKDOWN" in itype: has_breakdown = 1

    if start_times:
        earliest_start = min(start_times) 
        delta = datetime.now() - earliest_start
        mins_since = delta.total_seconds() / 60.0

    # 4. Construct the row in exact order
    feature_row = {
        "sb": sb,
        "sb_tm5": sb5,
        "sb_tm10": sb10,
        "sb_tm15": sb15,
        "delta_0_5": sb - sb5,
        "delta_5_10": sb5 - sb10,
        "delta_10_15": sb10 - sb15,
        "mid_lat": meta.get("mid_lat", 0),
        "mid_lon": meta.get("mid_lon", 0),
        "acceleration": (sb - sb5) - (sb5 - sb10),
        "link_dist_proxy": meta.get("link_dist_proxy", 0),
        "rain_mm": rain_mm,
        "is_raining": 1 if rain_mm > 0 else 0,
        "road_category": int(meta.get("road_category", 1)),
        "is_weekend": 1 if datetime.now().weekday() >= 5 else 0,
        "is_peak": 1 if datetime.now().hour in [7, 8, 9, 17, 18, 19] else 0,
        "incident_nearby": is_inc,
        "mins_since_nearby_start": mins_since, 
        "nearby_accident": has_accident, 
        "nearby_roadwork": has_roadwork,
        "nearby_breakdown": has_breakdown
    }
    
    return pd.DataFrame([feature_row])

def build_master_feature_dataframe(current_rain_mm, active_incidents):
    all_rows = []
    now = datetime.now()
    
    is_weekend = 1 if now.weekday() >= 5 else 0
    is_peak = 1 if now.hour in [7, 8, 9, 17, 18, 19] else 0
    is_raining = 1 if current_rain_mm > 0 else 0

    for link_id, meta in road_meta_dict.items():

        vals = live_speedbands.get(link_id, [6, 6, 6, 6])
        if len(vals) < 4:
            current_val = vals[0] if len(vals) > 0 else 6
            vals = vals + [current_val] * (4 - len(vals))
        

        sb, sb5, sb10, sb15 = vals[0:4]


        is_inc = 0
        has_accident = 0
        has_breakdown = 0
        has_roadwork = 0
        mins_since = -1
        start_times = []

        neighbors = neighbor_map.get(link_id, [])
        nearby_links = [link_id] + neighbors

        for l in nearby_links:
            if l in active_incidents:
                is_inc = 1
                inc_data = active_incidents[l]
                if "start" in inc_data:
                    start_times.append(inc_data["start"])
                
                itype = str(inc_data.get("type", "")).upper()
                if "ACCIDENT" in itype: has_accident = 1
                if "ROADWORKS" in itype or "WORKS" in itype: has_roadwork = 1
                if "VEHICLE" in itype or "BREAKDOWN" in itype: has_breakdown = 1

        if start_times:
            earliest_start = min(start_times)
            delta = now - earliest_start
            mins_since = delta.total_seconds() / 60.0


        all_rows.append({
            "link_id": link_id, 
            "sb": sb,
            "sb_tm5": sb5,
            "sb_tm10": sb10,
            "sb_tm15": sb15,
            "delta_0_5": sb - sb5,
            "delta_5_10": sb5 - sb10,
            "delta_10_15": sb10 - sb15,
            "mid_lat": meta.get("mid_lat", 0),
            "mid_lon": meta.get("mid_lon", 0),
            "acceleration": (sb - sb5) - (sb5 - sb10),
            "link_dist_proxy": meta.get("link_dist_proxy", 0),
            "rain_mm": current_rain_mm,
            "is_raining": is_raining,
            "road_category": int(meta.get("road_category", 1)),
            "is_weekend": is_weekend,
            "is_peak": is_peak,
            "incident_nearby": is_inc,
            "mins_since_nearby_start": mins_since, 
            "nearby_accident": has_accident, 
            "nearby_roadwork": has_roadwork,
            "nearby_breakdown": has_breakdown
        })

    return pd.DataFrame(all_rows)

async def precompute_global_t15():
    global GLOBAL_T15_CACHE
    all_features_df = build_master_feature_dataframe(current_rain_mm, active_incidents)

    chunk_size = 10000
    temp_cache = {}

    for i in range(0, len(all_features_df), chunk_size):
        chunk_df = all_features_df.iloc[i:i + chunk_size].copy()

        # Build DMatrix for this chunk
        dm_chunk = xgb.DMatrix(chunk_df[GATEKEEPER_FEATURES])

        # Run the inference 
        gk_probs = models["gatekeeper"].predict(dm_chunk)
        router_probs = models["router"].predict(dm_chunk)
        ascent_mags = models["ascent"].predict(dm_chunk)
        descent_mags = models["descent"].predict(dm_chunk)

        for idx, row in enumerate(chunk_df.itertuples()):
            link_id = int(row.link_id)
            current_sb = int(row.sb)
            gk_prob = float(gk_probs[idx])
            is_jam = router_probs[idx] > 0.5
            mag = float(descent_mags[idx]) if is_jam else float(ascent_mags[idx])

            # Re-use prediction logic here
            if gk_prob < 0.25:
                final_val = current_sb
                trend_label = "Stable"
                conf_label = "Moderate"
            elif mag < ML_SPECIALIST_THRESHOLD:
                final_val = current_sb
                trend_label = "Stable"
                conf_label = "Low"
            else:
                change = max(1, int(round(mag)))
                final_val = current_sb - change if is_jam else current_sb + change

                if is_jam:
                    trend_label = "Major Jam Ahead" if mag >= 1.5 else "Minor Jam Ahead"
                else:
                    trend_label = "Major Recovery" if mag >= 1.5 else "Minor Recovery"
                
                if mag >= 3.0: conf_label = "High"
                elif mag >= 1.5: conf_label = "Moderate"
                else: conf_label = "High"

            final_val = int(np.clip(final_val, 1, 8))

            temp_cache[link_id] = {
                "current_val": current_sb,
                "predicted_val": final_val,
                "tier": "Free Flow" if final_val > 5 else "Congested",
                "trend": trend_label,
                "conf": conf_label,
                "mag": float(mag)
            }

        del chunk_df
        del dm_chunk
        gc.collect()

    GLOBAL_T15_CACHE = temp_cache
    print("Precomputed T+15 links")

    

        


app = FastAPI(title="FAST Compute API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("### LOADED THIS APP.PY WITH /api/route ###")

# YH's original api_server.py part

@app.on_event("startup")
def startup_event() -> None:
    # ML 模型在服务启动时加载，避免每次请求重复初始化。
    load_or_train()
    if LTA_API_KEY:
        asyncio.create_task(lightweight_poller())
        asyncio.create_task(alert_scheduler())
        asyncio.create_task(poll_incidents())
        # Add this to print RAM usage
        process = psutil.Process(os.getpid())
        ram_mb = process.memory_info().rss / (1024 * 1024)
        print(f"--- SERVER STARTED ---")
        print(f"Current RAM Usage: {ram_mb:.2f} MB")
        global LOCAL_ROADS_JSON
        LOCAL_ROADS_JSON = load_local_road_snapshot()
        ram_mb = process.memory_info().rss / (1024 * 1024)
        print(f"Current RAM Usage after Local Roads: {ram_mb:.2f} MB")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/compute/normalize-incidents")
def compute_normalize_incidents(body: PayloadModel) -> Dict[str, Any]:
    return normalize_incidents(body.payload)


@app.post("/compute/enrich-incidents-with-cameras")
def compute_enrich_incidents_with_cameras(body: PayloadModel) -> Dict[str, Any]:
    return enrich_incidents_with_cameras(body.payload)


@app.post("/compute/analyze-events-for-route")
def compute_analyze_events_for_route(body: PayloadModel) -> Dict[str, Any]:
    return analyze_events_for_route(body.payload)


@app.post("/compute/evaluate-route-events")
def compute_evaluate_route_events(body: PayloadModel) -> Dict[str, Any]:
    return evaluate_route_events(body.payload)


@app.post("/compute/plan-routes")
def compute_plan_routes(body: PayloadModel) -> Dict[str, Any]:
    return plan_routes(body.payload)


@app.post("/compute/ml-traffic-impact")
def compute_ml_traffic_impact(body: PayloadModel) -> Dict[str, Any]:
    return predict(body.payload)


# JR's ML part

def require_user(authorization: str | None):

    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not Logged In")
    r = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "Authorization": authorization,
            "apikey": SUPABASE_API_KEY
        },
        timeout=5,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    return r.json()

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def root():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/success")
def success():
    return FileResponse(str(STATIC_DIR / "index.html"))

@app.get("/api/incidents")
def get_incidents(authorization: str | None = Header(default=None)):

    num_incidents = 150

    if not LTA_API_KEY:
        return load_placeholder_incidents(num_incidents, reason="missing_lta_api_key")


    user = require_user(authorization)
    url_incidents = "https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents"
    headers = {
        "AccountKey": LTA_API_KEY,
        "accept": "application/json"
    }

    try:
        response = requests.get(url_incidents, headers=headers, timeout=5)
        response.raise_for_status()
        data = response.json()
        raw_incidents = data.get("value", [])

        incidents = []
        for inc in raw_incidents:
            lat = inc.get("Latitude")
            lon = inc.get("Longitude")

            # Get closest link_id, to approximate affected road links. Store
            # additional info to display in backend
            matched_link_id, road_name = find_nearest_link_id(lat, lon)
            prediction_tp15 = "N/A"
            current_sb = "N/A"
            if matched_link_id:
                history = live_speedbands.get(matched_link_id, [])
                if history:
                    current_sb = history[0]
                prediction_tp15 = predict_for_link(matched_link_id)
            inc["matched_link_id"] = matched_link_id
            inc["matched_road_name"] = road_name
            inc["current_speed_band"] = current_sb 
            inc["predicted_speed_band_tp15"] = prediction_tp15
            incidents.append(inc)
        return {"incidents": incidents[:num_incidents], "user_id": user["id"]}
    except Exception:
        return load_placeholder_incidents(num_incidents, reason="lta_request_failed")

@app.post("/api/habit-routes")
def save_habit_route(
    payload: HabitRouteIn,
    authorization: str | None = Header(default=None)
):
    user = require_user(authorization)

    body = {
        "user_id": user["id"],
        "route_name": payload.route_name,
        "from_label": payload.from_label,
        "to_label": payload.to_label,
        "coords_json": payload.coords_json,
        "distance_m": payload.distance_m,
        "link_ids": payload.link_ids,     
    }

    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/habit_routes",
        headers=supabase_headers(authorization),
        json=body,
        timeout=10
    )

    if r.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Save failed: {r.text}")

    return {"saved": True}

# Habit routes get endpoint
@app.get("/api/habit-routes")
def get_habit_routes(authorization: str | None = Header(default=None)):
    user = require_user(authorization)

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/habit_routes",
        headers=supabase_headers(authorization),
        params={
            "user_id": f"eq.{user['id']}",
            "select": "*",
            "order": "created_at.desc"
        },
        timeout=10
    )

    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Load failed: {r.text}")

    return {"routes": r.json()}

# Habit Routes update endpoint
@app.patch("/api/habit-routes/{route_id}")
def update_route_settings(
    route_id: int,
    payload: RouteSettingsUpdate,
    authorization: str | None = Header(default=None)
):
    user = require_user(authorization)

    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/habit_routes",
        headers = supabase_headers(authorization),
        params={
            "id": f"eq.{route_id}",
            "user_id": f"eq.{user['id']}"
        },
        json=payload.dict(),
        timeout=10
    )

    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"Update failed: {r.text}")
    
    return {"updated": True}

# Habit Routes delete endpoint
@app.delete("/api/habit-routes/{route_id}")
def delete_habit_route(
    route_id: int,
    authorization: str | None = Header(default=None)
):
    user = require_user(authorization)

    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/habit_routes",
        headers=supabase_headers(authorization),
        params={
            "id": f"eq.{route_id}",
            "user_id": f"eq.{user['id']}"
        },
        timeout=10
    )

    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"Delete failed: {r.text}")

    return {"deleted": True}

# Insert Saved Places to Database
@app.post("/api/saved-places")
def create_saved_place(payload: SavedPlaceIn, authorization: str | None = Header(default=None)):
    user = require_user(authorization)

    body = {
        "user_id": user["id"],
        "place_name": payload.place_name,
        "label": payload.label,
        "lat": payload.lat,
        "lon": payload.lon
    }
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/saved_places",
        headers=supabase_headers(authorization),
        json=body,
        timeout=10
    )
    if r.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Save failed: {r.text}")

    return {"saved": True}

# Retrieve Saved Places from Database
@app.get("/api/saved-places")
def get_saved_places(authorization: str | None = Header(default=None)):
    user = require_user(authorization)

    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/saved_places",
        headers=supabase_headers(authorization),
        params={
            "user_id": f"eq.{user['id']}",
            "select": "*",
            "order": "created_at.desc"
        },
        timeout=10
    )

    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Load failed: {r.text}")

    return {"places": r.json()}

@app.delete("/api/saved-places/{place_id}")
def delete_saved_place(
    place_id: int,
    authorization: str | None = Header(default=None)
):
    user = require_user(authorization)

    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/saved_places",
        headers=supabase_headers(authorization),
        params={
            "id": f"eq.{place_id}",
            "user_id": f"eq.{user['id']}"
        },
        timeout=10
    )

    if r.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=f"Delete failed: {r.text}")

    return {"deleted": True}

# If unable to access LTA API for some reason
def load_placeholder_incidents(num_incidents: int, reason: str):
    try:
        with open(STATIC_DIR / "placeholder_incidents.json", "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            incidents = data
        else:
            incidents = data.get("value", [])
        return {
            "source": "placeholder",
            "incidents": incidents[:num_incidents],
            "reason": reason
        }
    except Exception as e:
        return {
            "incidents": [],
            "reason": "Failed to load.."
        }

# Routing function from OneMap API. To obtain the coordinates from street names or postal code.
@app.get("/api/geocode")
def geocode(q: str = Query(..., min_length=2)):
    r = requests.get(
        ONEMAP_SEARCH_URL,
        params={
            "searchVal": q,
            "returnGeom": "Y",
            "getAddrDetails": "Y",
            "pageNum": 1,
        },
        headers={
            "Authorization": ONEMAP_TOKEN
        },
        timeout = 5,
    )

    data = r.json()
    results = []
    for it in data.get("results", []):
        lat = it.get("LATITUDE")
        lon = it.get("LONGITUDE")
        if lat and lon:
            results.append({
                "label": it.get("ADDRESS") or it.get("SEARCHVAL"),
                "postal": it.get("POSTAL"),
                "lat": float(lat),
                "lon": float(lon),
            })

    return JSONResponse({"results": results[:8]})

# Perform actual routing logic using A*
@app.get("/api/route")
def api_route(fromLat: float, fromLon: float, toLat: float, toLon: float):
    try:
        # Calculate bounding box with a small padding
        padding = 0.02
        s = min(fromLat, toLat) - padding
        n = max(fromLat, toLat) + padding
        w = min(fromLon, toLon) - padding
        e = max(fromLon, toLon) + padding

        # The exact Overpass query used in Node server
        overpass_query = f"""
        [out:json][timeout:25];
        (
          way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$"]({s},{w},{n},{e});
        );
        out body geom;
        """
        
        # Fetch the roads
        res = requests.post("https://overpass-api.de/api/interpreter", data={"data": overpass_query}, timeout=30)
        roads_json = res.json()

        print("2. Feeding map to teammate's A* Engine...")
        payload = {
            "roads": roads_json,
            "start": {"lat": fromLat, "lon": fromLon},
            "end": {"lat": toLat, "lon": toLon},
            "signalPoints": [] # LTA traffic light 
        }

        # Run the routing
        py_result = plan_routes(payload)
        
        if not py_result.get("routes"):
            return {"routes": []}

        print("3. Mapping Overpass routes to LTA Links...")
        routes_out = []
        for r in py_result["routes"]:
            coords = r["coords"]
            
            match_info = match_route_to_lta_links(coords)
            
            routes_out.append({
                "id": r.get("id", "custom"),
                "label": r.get("label", "Route"),
                "coords": coords,
                "match_info": match_info, 
                "estMinutes": r.get("estMinutes", 0),
                "totalDist": r.get("totalDist", 0)
            })

        return {"routes": routes_out}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
    

# --- SIMULATE PREDICTIONS ENDPOINT ---
@app.post("/api/hijack-predict")
def hijack_predict(payload: HijackPayload):
    sb_history = live_speedbands.get(str(payload.link_id), [6, 6, 6, 6])
    features = assemble_features(payload.link_id, payload.rain_mm, [])
    if features is None or features.empty:
        return {"error": "Could not build features"}
    
    features = features.iloc[0].to_dict()
    
    # OVERWRITE using simulation inputs
    features["sb"] = payload.sb
    features["sb_tm5"] = payload.sb_tm5
    features["sb_tm10"] = payload.sb_tm10
    features["sb_tm15"] = payload.sb_tm15
    
    features["incident_nearby"] = payload.incident_nearby
    features["nearby_accident"] = payload.nearby_accident
    features["nearby_roadwork"] = payload.nearby_roadwork
    features["nearby_breakdown"] = payload.nearby_breakdown
    
    # Use the timer
    features["mins_since_nearby_start"] = payload.mins_since_nearby_start
    
    # Environment & Context
    features["rain_mm"] = payload.rain_mm
    features["is_raining"] = 1 if payload.rain_mm > 0 else 0
    features["is_peak"] = payload.is_peak
    features["is_weekend"] = payload.is_weekend

    # Recalculate deltas
    features["delta_0_5"] = features["sb"] - features["sb_tm5"]
    features["delta_5_10"] = features["sb_tm5"] - features["sb_tm10"]
    features["delta_10_15"] = features["sb_tm10"] - features["sb_tm15"]
    features["acceleration"] = features["delta_0_5"] - features["delta_5_10"]

    input_df = pd.DataFrame([features])[GATEKEEPER_FEATURES]
    dm = xgb.DMatrix(input_df) 

    gk_prob = models["gatekeeper"].predict(dm)[0]
    is_jam = models["router"].predict(dm)[0] > 0.5
    
    if is_jam:
        mag = models["descent"].predict(dm)[0]
    else:
        mag = models["ascent"].predict(dm)[0]

    if gk_prob < 0.25:
        final_val = payload.sb
        trend_label = "Stable"
        conf_label = "Moderate"
    elif mag < 0.4:
        final_val = payload.sb
        trend_label = "Stable"
        conf_label = "Low"
    else:
        change = max(1, int(round(mag)))
        final_val = payload.sb - change if is_jam else payload.sb + change
        
        if is_jam:
            trend_label = "Major Jam Ahead" if mag >= 1.5 else "Minor Slowdown"
        else:
            trend_label = "Major Recovery" if mag >= 1.5 else "Minor Speedup"
            
        if mag >= 3.0: conf_label = "High"
        elif mag >= 1.5: conf_label = "Moderate"
        else: conf_label = "High"

    final_val = int(np.clip(final_val, 1, 8)) 
    # print(f"DEBUG: GK Prob: {gk_prob:.2f} | Is Jam: {is_jam} | Mag: {mag:.2f}")

    return {
        "current_val": payload.sb,
        "predicted_val": final_val,
        "trend": trend_label,
        "conf": conf_label,
        "mag": float(mag)
    }
# --- END SIMULATE PREDICTIONS ---

# -- SIMULATE FOR HISTORICAL RECORD --
@app.post("/api/analyze-simulated-route")
def analyze_simulated_route(req: HijackRouteRequest):
    
    
    BAND_TO_KMH = {1: 7, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 85}

    matched_links = []
    curr_eta = 0.0
    predicted_eta = 0.0
    large_changes = []
    worst_val = 8
    worst_link = None
    status = "No Delays"

    

    for payload in req.links:
        
        f = payload.dict()

        f["delta_0_5"] = f["sb"] - f["sb_tm5"]
        f["delta_5_10"] = f["sb_tm5"] - f["sb_tm10"]
        f["delta_10_15"] = f["sb_tm10"] - f["sb_tm15"]
        f["acceleration"] = f["delta_0_5"] - f["delta_5_10"]

        print("SIM LINK:", f["link_id"], flush=True)

        input_df = pd.DataFrame([f])[GATEKEEPER_FEATURES] 
        dm = xgb.DMatrix(input_df)

        is_jam = models["router"].predict(dm)[0] > 0.5
        mag = models["descent"].predict(dm)[0] if is_jam else models["ascent"].predict(dm)[0]

        current_sb = int(f["sb"])

        if mag < ML_SPECIALIST_THRESHOLD:
            final_val = current_sb
            trend_label = "Stable"
            conf_label = "Low"
        else:
            change = max(1, int(round(mag)))
            final_val = current_sb - change if is_jam else current_sb + change

            if is_jam:
                trend_label = "Major Jam Ahead" if mag >= 1.5 else "Minor Slowdown"
            else:
                trend_label = "Major Recovery" if mag >= 1.5 else "Minor Speedup"

            if mag >= 3.0:
                conf_label = "High"
            elif mag >= 1.5:
                conf_label = "Moderate"
            else:
                conf_label = "Low"

        final_val = int(np.clip(final_val, 1, 8))

        drop = current_sb - final_val
        logger = logging.getLogger("uvicorn.error")
        logger.warning("Simulation called")
        logger.warning(
            "link=%s sb=%s is_jam=%s mag=%.2f final=%s drop=%s",
            f["link_id"],
            current_sb,
            is_jam,
            float(mag),
            final_val,
            drop,
        )

        dist_m = float(f.get("segment_len_m", 500.0))
        curr_kmh = BAND_TO_KMH.get(current_sb, 45)
        pred_kmh = BAND_TO_KMH.get(final_val, 45)

        curr_eta += (dist_m / 1000.0) / curr_kmh * 60.0
        predicted_eta += (dist_m / 1000.0) / pred_kmh * 60.0

        if final_val < worst_val:
            worst_val = final_val
            worst_link = int(f["link_id"])

        if (current_sb - final_val) >= 2:
            large_changes.append({
                "road_name": f.get("road_name", "Unknown Road"),
                "link_id": int(f["link_id"]),
                "predicted_band": final_val,
                "change": int(current_sb - final_val)
            })
        
        matched_links.append({
            "link_id": int(f["link_id"]),
            "road_name": f.get("road_name", None),
            "segment_len_m": dist_m,
            "prediction": {
                "current_val": current_sb,
                "predicted_val": final_val,
                "mag": float(mag),
                "trend": trend_label,
                "conf": conf_label,
                "drop": int(drop),
                "is_jam": bool(is_jam)
            }
        })

    delay = predicted_eta - curr_eta
    if delay > 2:
        status = "Delay"

    summary = {
        "curr_eta": round(curr_eta, 1),
        "predicted_eta": round(predicted_eta, 1),
        "delay": round(max(0.0, delay), 1),
        "worst_band": worst_val,
        "worst_link": worst_link,
        "large_changes": large_changes[:3],
        "status": status
    }

    return {
        "coords": req.coords_json,
        "match_info": {
            "matched_links": matched_links,
            "segment_matches": matched_links
        },
        "specialist_threshold": ML_SPECIALIST_THRESHOLD,
        "summary": summary
    }
# END SIMULATE FOR HISTORICAL RECORD

# HELPER FUNCTION, APPROXIMATE DISTANCE IN METERS
def approx_meters(lat1, lon1, lat2, lon2):
    """
    Fast local distance approximation in meters, good enough for Singapore-scale matching.
    """
    mean_lat = math.radians((lat1 + lat2) / 2.0)
    dx = (lon2 - lon1) * 111320.0 * math.cos(mean_lat)
    dy = (lat2 - lat1) * 110540.0
    return math.sqrt(dx * dx + dy * dy)

# Bearing deg to check the route direction
def bearing_deg(lat1, lon1, lat2, lon2):
    """
    Bearing of a segment in degrees 0..360.
    """
    mean_lat = math.radians((lat1 + lat2) / 2.0)
    dx = (lon2 - lon1) * math.cos(mean_lat)
    dy = (lat2 - lat1)
    ang = math.degrees(math.atan2(dx, dy))
    return (ang + 360.0) % 360.0

# Calculate absolute smallest angle difference to compare if roads are 
# in the same direction
def bearing_diff_deg(a, b):
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d)

# For the generated route, approximate routes that exists in LTA road_links
# Because the system is only able to retrieve ML input data from LTA road links
# it approximates based on distance, and segment direction
def match_route_to_lta_links(route_coords, max_midpoint_dist_m=35.0, max_bearing_diff_deg=35.0):

    matched = []
    segment_matches = []
    total_route_len_m = 0.0
    covered_len_m = 0.0

    # Loop through road segments
    # Break each road segment into point A -> point B
    for i in range(len(route_coords) - 1):
        lat1, lon1 = route_coords[i]
        lat2, lon2 = route_coords[i + 1]

        # Calculate segment length
        seg_len_m = approx_meters(lat1, lon1, lat2, lon2)
        # If segment is too short, skip it.. (to be tuned)
        if seg_len_m < 5:
            segment_matches.append(None)
            continue

        total_route_len_m += seg_len_m

        seg_mid_lat = (lat1 + lat2) / 2.0
        seg_mid_lon = (lon1 + lon2) / 2.0
        seg_bearing = bearing_deg(lat1, lon1, lat2, lon2)

        # cheap bounding-box
        lat_pad = 0.0005  
        lon_pad = 0.0005   

        # Filter only road link within bounding box to optimize the search
        candidates = road_links_df[
            (road_links_df["mid_lat"].between(seg_mid_lat - lat_pad, seg_mid_lat + lat_pad)) &
            (road_links_df["mid_lon"].between(seg_mid_lon - lon_pad, seg_mid_lon + lon_pad))
        ].copy()

        if candidates.empty:
            segment_matches.append(None)
            continue

        # score candidates by midpoint distance + bearing similarity
        best = None
        best_score = None

        dists = np.sqrt(
            (candidates["mid_lat"] - seg_mid_lat)**2 + 
            (candidates["mid_lon"] - seg_mid_lon)**2
        ) * 111000

        close_candidates = candidates[dists < max_midpoint_dist_m]

        # Evaluate each candidate
        # Check the candidate's midpoint against route segment's midpoint
        for _, row in close_candidates.iterrows():
            dist_m = approx_meters(seg_mid_lat, seg_mid_lon, row["mid_lat"], row["mid_lon"])
            if dist_m > max_midpoint_dist_m:
                continue

            link_bearing = bearing_deg(
                row["start_lat"], row["start_lon"],
                row["end_lat"], row["end_lon"]
            )

            # allow either direction because LTA link direction may differ from route drawing direction
            diff1 = bearing_diff_deg(seg_bearing, link_bearing)
            diff2 = bearing_diff_deg(seg_bearing, (link_bearing + 180.0) % 360.0)
            bdiff = min(diff1, diff2)

            if bdiff > max_bearing_diff_deg:
                continue

            score = dist_m + 0.7 * bdiff

            if best_score is None or score < best_score:
                best_score = score

                current_sb = live_speedbands.get(int(row["link_id"]), [None])[0]
                best = {
                    "link_id": int(row["link_id"]),
                    "road_name": str(row["road_name"]) if pd.notna(row["road_name"]) else None,
                    "road_category": int(row["road_category"]) if pd.notna(row["road_category"]) else None,
                    "prediction": predict_for_link(int(row["link_id"])),
                    "current_band": int(current_sb) if current_sb is not None else None,
                    "dist_m": round(dist_m, 2),
                    "bearing_diff_deg": round(bdiff, 2),
                    "segment_len_m": round(seg_len_m, 2)
                }

        if best is not None:
            covered_len_m += seg_len_m
            matched.append(best)
            segment_matches.append(best)
        else:
            segment_matches.append(None)

    # deduplicate consecutive repeats
    deduped = []
    for item in matched:
        if not deduped or deduped[-1]["link_id"] != item["link_id"]:
            deduped.append(item)
        else:
            deduped[-1]["segment_len_m"] += item["segment_len_m"]

    coverage_ratio = covered_len_m / total_route_len_m if total_route_len_m > 0 else 0.0

    return {
        "matched_links": deduped,
        "segment_matches": segment_matches,
        "total_route_len_m": round(total_route_len_m, 1),
        "covered_len_m": round(covered_len_m, 1),
        "coverage_ratio": round(coverage_ratio, 3)
    }

# Helper function to get input data for road links
SG_TZ = timezone(timedelta(hours=8))

road_spatial_dict = road_links_df.set_index("link_id")[["mid_lat", "mid_lon"]].to_dict(orient="index")
def predict_for_link(link_id: int):

    if link_id in GLOBAL_T15_CACHE:
        return GLOBAL_T15_CACHE[link_id]
    
    vals = live_speedbands.get(link_id, [8, 8, 8, 8])
    if not vals: 
        return None
    
    current_sb = int(vals[0])
    # assemble_features returns a DF with all 21 columns
    input_df = assemble_features(link_id, current_rain_mm, active_incidents)
    
    dm = xgb.DMatrix(input_df)

    # Traffic Tier Helper
    def get_tier_label(b):
        if b <= 3: return "Heavy Congestion"
        if b <= 5: return "Moderate Traffic"
        return "Free Flow"

    # RUN THE ENGINE
    gk_prob = models["gatekeeper"].predict(dm)[0]
    is_jam = models["router"].predict(dm)[0] > 0.5
    mag = models["descent"].predict(dm)[0] if is_jam else models["ascent"].predict(dm)[0]
    # CALCULATE TREND & CONFIDENCE
    if gk_prob < 0.25:
        final_val = current_sb
        trend_label = "Stable"
        conf_label = "Moderate"
    elif mag < ML_SPECIALIST_THRESHOLD:
        final_val = current_sb
        trend_label = "Stable"
        conf_label = "Low"
    else:
        change = max(1, int(round(mag)))
        final_val = current_sb - change if is_jam else current_sb + change
        
        if is_jam:
            trend_label = "Major Jam Ahead" if mag >= 1.5 else "Minor Slowdown"
        else:
            trend_label = "Major Recovery" if mag >= 1.5 else "Minor Speedup"
            
        if mag >= 3.0: conf_label = "High"
        elif mag >= 1.5: conf_label = "Moderate"
        else: conf_label = "High"

    final_val = int(np.clip(final_val, 1, 8))
    
    print(f"DEBUG [{link_id}]: GK Prob: {gk_prob:.2f} | Mag: {mag:.2f} | Trend: {trend_label}")
    return {
        "current_val": current_sb,
        "predicted_val": final_val,
        "tier": "Free Flow" if final_val > 5 else "Congested",
        "trend": trend_label,
        "conf": conf_label,
        "mag": float(mag)
    }

# For Incidents Mapping to Road_link
def find_nearest_link_id(inc_lat, inc_lon):
    # Search within ~110m box
    pad = 0.001 
    candidates = road_links_df[
        (road_links_df["mid_lat"].between(inc_lat - pad, inc_lat + pad)) &
        (road_links_df["mid_lon"].between(inc_lon - pad, inc_lon + pad))
    ]
    
    if candidates.empty:
        return None, "Ummapped Road"
        
    # Pick the absolute closest by distance
    best_id = None
    min_dist = 9999
    for _, row in candidates.iterrows():
        d = approx_meters(inc_lat, inc_lon, row["mid_lat"], row["mid_lon"])
        if d < min_dist:
            min_dist = d
            best_id = int(row["link_id"])
            best_name = str(row["road_name"]) if pd.notna(row["road_name"]) else "LTA Road"
    return best_id, best_name

# Helper to call Supabase REST table
def supabase_headers(user_jwt: str):
    return {
        "apikey": SUPABASE_API_KEY,
        "Authorization": user_jwt,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

# This receives coords and recalculates the match-info
@app.post("/api/habit-routes/analyze")
def analyze_habit_route(payload: dict[str, Any],
    authorization: str | None = Header(default=None)
):
    require_user(authorization)

    coords = payload.get("coords_json")

    if not coords or not isinstance(coords, list) or len(coords) < 2:
        raise HTTPException(status_code=400, detail="coords_json must contain 2 coordinates")
    try:
        match_info = match_route_to_lta_links(coords)
        # Get all link_ids 
        links = match_info["matched_links"]

        # Use median speed of each speedband for ETA calculation
        BAND_TO_KMH = {
            1: 7,
            2: 15,
            3: 25,
            4: 35,
            5: 45,
            6: 55,
            7: 65,
            8: 85
        }

        # New Per-Route Analytics 
        # Show road links with slow speedbands and road links with >2 drops
        # And calculate ETA using median speed
        predicted_eta = 0.0
        curr_eta = 0.0
        predicted_bottlenecks = []
        large_changes = []
        worst_val = 8
        worst_link = None
        status = "Stable"

        for link in links:
            dist = link["segment_len_m"]
            pred = link.get("prediction")
            if not pred:
                continue

            curr_sb = pred["current_val"]
            pred_sb = pred["predicted_val"]

            # Calculate approx ETA 
            # Convert kmh to mins using median speed mapping
            curr_kmh = BAND_TO_KMH.get(curr_sb)
            pred_kmh = BAND_TO_KMH.get(pred_sb)

            curr_mins = (dist / 1000) / curr_kmh * 60
            pred_mins = (dist / 1000) / pred_kmh * 60

            curr_eta += curr_mins
            predicted_eta += pred_mins

            # Get worst speedband
            if pred_sb < worst_val:
                worst_val = pred_sb
                worst_link = link["link_id"]

            # Get bottlenecks (<=3 speedbands)
            if pred_sb <= 3:
                predicted_bottlenecks.append({
                    "road_name": link.get("road_name", "Unknown Road"),
                    "link_id": link["link_id"],
                    "predicted_band": pred_sb
                })
            
            # Get segments with predicted large changes >=2
            if (curr_sb - pred_sb) >= 2:
                large_changes.append({
                    "road_name": link.get("road_name", "Unknown Road"),
                    "link_id": link["link_id"],
                    "predicted_band": pred_sb,
                    "change": int(curr_sb - pred_sb)
                })

        delay = predicted_eta - curr_eta
        if delay > 1:
            status = "Slowing down"
        
        summary = {
            "curr_eta": round(curr_eta, 1),
            "predicted_eta": round(predicted_eta, 1),
            "delay": round(max(0, predicted_eta - curr_eta)),
            "worst_band": worst_val,
            "worst_link": worst_link,
            "large_changes": large_changes[:3],
            "status": status
        }

        return {
            "coords": coords,
            "match_info": match_info,
            "specialist_threshold": ML_SPECIALIST_THRESHOLD,
            "summary": summary
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error")
    
# Alerts endpoint
@app.get("/api/my-alerts")
def get_my_alerts(authorization: str | None = Header(default=None)):
    user = require_user(authorization)
    
    # Fetch alerts that belong to this user and haven't been dismissed
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/traffic_alerts?user_id=eq.{user['id']}&is_dismissed=eq.false&order=created_at.desc",
        headers=supabase_headers(authorization)
    )
    
    if r.status_code == 200:
        return r.json()
    return []

@app.post("/api/debug-single-row")
def debug_single_row(req: DebugRowRequest):
    f = req.row.copy()

    # recompute derived (safe)
    f["delta_0_5"] = f["sb"] - f["sb_tm5"]
    f["delta_5_10"] = f["sb_tm5"] - f["sb_tm10"]
    f["delta_10_15"] = f["sb_tm10"] - f["sb_tm15"]
    f["acceleration"] = f["delta_0_5"] - f["delta_5_10"]

    # build model input
    input_df = pd.DataFrame([f])[GATEKEEPER_FEATURES]
    dm = xgb.DMatrix(input_df)

    # raw model outputs
    gk_prob = float(models["gatekeeper"].predict(dm)[0])
    router_prob = float(models["router"].predict(dm)[0])
    descent_mag = float(models["descent"].predict(dm)[0])
    ascent_mag = float(models["ascent"].predict(dm)[0])

    is_jam = router_prob > 0.5
    chosen_mag = descent_mag if is_jam else ascent_mag

    current_sb = int(f["sb"])

    # final decision (same as your pipeline)
    if gk_prob < GATEKEEPER_THRESHOLD:
        final_val = current_sb
    elif chosen_mag < ML_SPECIALIST_THRESHOLD:
        final_val = current_sb
    else:
        change = max(1, int(round(chosen_mag)))
        final_val = current_sb - change if is_jam else current_sb + change

    final_val = int(np.clip(final_val, 1, 8))
    drop = current_sb - final_val

    return {
        "link_id": int(f["link_id"]),
        "sb": current_sb,

        "gk_prob": gk_prob,
        "router_prob": router_prob,
        "is_jam": is_jam,

        "descent_mag": descent_mag,
        "ascent_mag": ascent_mag,
        "chosen_mag": chosen_mag,

        "thresholds": {
            "gatekeeper": GATEKEEPER_THRESHOLD,
            "specialist": ML_SPECIALIST_THRESHOLD
        },

        "final_val": final_val,
        "drop": drop,

        "features_used": {k: f[k] for k in GATEKEEPER_FEATURES}
    }

@app.post("/api/habit-routes/historical")
async def get_historical_plan(req: HistoricalPlanRequest):
    # Extract unique IDs to query DuckDB
    unique_links = list({seg.link_id for seg in req.segment_sequence if seg})
    
    if not unique_links:
        return {"summary": {"status": "Unknown", "predicted_eta": 0}, "match_info": {"segment_matches": []}}

    links_str = ",".join(map(str, unique_links))

    query = f"""
        SELECT 
            CAST(link_id AS INTEGER) as link_id, 
            CAST(typical_sb AS INTEGER) as typical_sb, 
            CAST(confidence_pct AS INTEGER) as confidence_pct 
        FROM read_parquet('{str(PLAN_MODEL_PATH)}')
        WHERE dow = {req.day} 
          AND time_bucket = {req.bucket}
          AND link_id IN ({links_str})
    """
    
    try:
        df = duckdb.sql(query).df()
        lookup = df.set_index('link_id').to_dict('index') if not df.empty else {}

        segment_matches = []
        total_delay_mins = 0
        

        # ETA Stuff estimation
        BAND_TO_KMH = {1: 7, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 85}
        segment_matches = []
        predicted_eta_mins = 0.0 
        
        # Rebuild the map sequence with Real Road Names
        for seg in req.segment_sequence:
            if seg and seg.link_id in lookup:
                band = lookup[seg.link_id]['typical_sb']
                conf = lookup[seg.link_id]['confidence_pct']
                
                conf_str = "High" if conf >= 70 else ("Medium" if conf >= 40 else "Low")
                

                # Calculate ETA 
                dist_m = 500.0 
                speed_kmh = BAND_TO_KMH.get(band, 45)
                
                # (Dist in km / Speed in kmh) * 60 minutes
                travel_time = (dist_m / 1000.0) / speed_kmh * 60.0
                predicted_eta_mins += travel_time
                
                if band <= 3: total_delay_mins += 0.2
                elif band <= 5: total_delay_mins += 0.05
                
                segment_matches.append({
                    "link_id": seg.link_id,
                    "road_name": seg.road_name, # REAL NAME RESTORED!
                    "prediction": {
                        "current_val": band,
                        "predicted_val": band,
                        "trend": "Typical Historical Steady",
                        "tier": f"Typical Band {band}",
                        "conf": conf_str,
                        "mag": 0
                    }
                })
            else:
                segment_matches.append(None)

        # Realistic Base ETA Math
        final_eta = round(predicted_eta_mins, 1)

        avg_band = df['typical_sb'].mean() if not df.empty else 8
        status = "Free Flow" if avg_band > 5 else ("Moderate" if avg_band > 3 else "Congested")

        return {
            "summary": {
                "status": status,
                "predicted_eta": final_eta
            },
            "match_info": {
                "segment_matches": segment_matches
            }
        }
        
    except Exception as e:
        print(f"DuckDB Query Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load historical plan")
        
    except Exception as e:
        print(f"DuckDB Query Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load historical plan")
    

# EXPRESSWAYS analysis
@app.get("/api/expressway-forecast")
def get_expressway_forecast():
    # Map full names to short display codes
    exp_mapping = {
        "PAN ISLAND EXPRESSWAY": "PIE",
        "AYER RAJAH EXPRESSWAY": "AYE",
        "CENTRAL EXPRESSWAY": "CTE",
        "TAMPINES EXPRESSWAY": "TPE",
        "SELETAR EXPRESSWAY": "SLE",
        "KALLANG-PAYA LEBAR EXPRESSWAY": "KPE",
        "BUKIT TIMAH EXPRESSWAY": "BKE",
        "EAST COAST PARKWAY": "ECP",
        "MARINA COASTAL": "MCE",
        "KRANJI EXPRESSWAY": "KJE"
    }

    # Convert category to string to ensure the filter works
    cat1_df = road_links_df[road_links_df['road_category'].astype(str) == '1']
    
    forecasts = {}

    for full_name, short_code in exp_mapping.items():
        # Get all link_ids for this specific expressway
        df_filtered = cat1_df[cat1_df['road_name'].str.contains(full_name, na=False)]

        link_ids = df_filtered['link_id'].unique().tolist()
        if not link_ids:
            continue

        lon_min, lon_max = df_filtered['mid_lon'].min(), df_filtered['mid_lon'].max()
        lat_min, lat_max = df_filtered['mid_lat'].min(), df_filtered['mid_lat'].max()

        if (lon_max - lon_min) > (lat_max - lat_min):
            axis = "mid_lon"
            inc_axis = "lon"
            names = ["West", "Central", "East"]
        else:
            axis = "mid_lat"
            inc_axis = "lat"
            names = ["South", "Central", "North"]

        bins = np.linspace(df_filtered[axis].min(), df_filtered[axis].max(), 4)

        sector_stats = {name: {"jammed": 0, "recovering": 0, "speeds": [], "incidents": []} for name in names}
        sector_incidents = []
        for _, link in df_filtered.iterrows():
            lid = int(link['link_id'])
            if lid not in GLOBAL_T15_CACHE:
                continue
            pred = GLOBAL_T15_CACHE[lid]
            
            

            idx = np.digitize(link[axis], bins)
            idx = min(max(idx, 1), 3)
            sector_name = names[idx - 1]

            sector_min = bins[idx-1]
            sector_max = bins[idx]

            if lid in active_incidents:
                incident = active_incidents[lid]
                if incident not in sector_stats[sector_name]["incidents"]:
                    sector_stats[sector_name]["incidents"].append(incident)

            # Compute the statistics of each expressway segment
            if pred['predicted_val'] <= 3:
                sector_stats[sector_name]["jammed"] += 1

            if pred['predicted_val'] > pred['current_val']:
                sector_stats[sector_name]["recovering"] += 1

            sector_stats[sector_name]["speeds"].append(pred["predicted_val"])

        formatted_sectors = []
        for name, data in sector_stats.items():
            formatted_sectors.append({
                "name": name,
                "avg_speed": int(round(np.mean(data["speeds"]))) if data["speeds"] else None,
                "jammed_count": data["jammed"],
                "recovering_count": data["recovering"],
                "incidents": data["incidents"],
                "incidents_count": len(data["incidents"])
            })

        forecasts[short_code] = {
            "full_name": full_name,
            "status": "ONLINE",
            "sectors": formatted_sectors
        }

    return forecasts



# TO HANDLE ROUTE RECALCULATIONS TO AVOID JAMMED SEGMENTS
def subset_roads_by_bbox(roads, s, w, n, e, margin_deg=0.015):
    if not isinstance(roads, dict):
        return {"elements": []}
    
    s2 = s - margin_deg
    w2 = w - margin_deg
    n2 = n + margin_deg
    e2 = e + margin_deg

    filtered = []
    for el in roads.get("elements", []):
        if el.get("type") != "way":
            continue

        bounds = el.get("bounds", {})

        if bounds:
            if (bounds['minlat'] <= n2 and bounds['maxlat'] >= s2 and
                bounds['minlon'] <= e2 and bounds['maxlon'] >= w2):
                filtered.append(el)
                continue

        geom = el.get("geometry") or []
        if not geom:
            continue
    
        hit = False
        for p in geom:
            lat_val = p.get("lat")
            lon_val = p.get("lon")
            if lat_val is None or lon_val is None:
                continue
            lat, lon = float(lat_val), float(lon_val)
            if s2 <= lat <= n2 and w2 <= lon <= e2:
                hit = True
                break

        if hit:
            filtered.append(el)

    return {
        "version": roads.get("version"),
        "generator": roads.get("generator"),
        "osm3s": roads.get("osm3s"),
        "elements": filtered
    }


# Helper fallback function to call Overpass
def fetch_roads_from_overpass(s, w, n, e):
    overpass_query = f"""
    [out:json][timeout:25];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$"]({s},{w},{n},{e});
    );
    out body geom;
    """

    res = requests.post(
        "https://overpass-api.de/api/interpreter",
        data={"data": overpass_query},
        timeout=30
    )

    print("Overpass status:", res.status_code, flush=True)
    print("Overpass text preview:", res.text[:300], flush=True)

    if res.status_code != 200:
        return {"elements": []}, f"Overpass returned {res.status_code}"

    content_type = res.headers.get("Content-Type", "")
    if "json" not in content_type.lower():
        return {"elements": []}, f"Overpass returned non-JSON: {content_type}"

    try:
        return res.json(), None
    except Exception as e:
        return {"elements": []}, f"Invalid Overpass JSON: {e}"

@app.post("/api/recalculate")
async def handle_recalculate(request: RerouteRequest):


    try:
        payload = request.dict()

        start = payload["start"]
        end = payload["end"]
        padding = 0.005
        s = min(start["lat"], end["lat"]) - padding
        n = max(start["lat"], end["lat"]) + padding
        w = min(start["lon"], end["lon"]) - padding
        e = max(start["lon"], end["lon"]) + padding

        print("A: request received", flush=True)

        local_meta = {
            lid: data for lid, data in road_meta_dict.items()
            if s <= data['mid_lat'] <= n and w <= data['mid_lon'] <= e
        }
        payload["road_meta"] = local_meta

        roads_json = subset_roads_by_bbox(LOCAL_ROADS_JSON, s, w, n, e, margin_deg=0.015)
        print("Local subset elements:" ,len(roads_json.get("elements", [])), flush=True)

        payload["roads"] = roads_json
        payload["t15_cache"] = GLOBAL_T15_CACHE

        print("B: before recalculate_route", flush=True)


        result = recalculate_route(payload)

        print("Local candidate count:", len(result.get("routes", []) or []), flush=True)
        print("C: after recalculate_route", flush=True)
        if not isinstance(result, dict):
            return {"routes": [], "error": "recalculate_route returned invalid result"}
        candidates = result.get("routes", [])
        if not candidates:
            print("Local subset found no route, falling back to Overpass", flush=True)

            roads_json, overpass_error = fetch_roads_from_overpass(s, w, n, e)
            if overpass_error:
                return {"routes": [], "error": overpass_error}

            payload["roads"] = roads_json
            print("B2: before fallback recalculate_route", flush=True)
            result = recalculate_route(payload)
            print("C2 after fallback", flush=True)
            candidates = result.get("routes", [])
            if not isinstance(result, dict):
                return {"routes": [], "error": "recalculate_route returned invalid result after fallback"}        
            

        if not isinstance(candidates, list):
            return {"routes": [], "error": "recalculate_route returned invalid routes"}
        print("RECALC start:", start)
        print("RECALC end:", end)
        print("RECALC blocked:", payload.get("blocked_edges"))
        print("RECALC roads elements:", len(roads_json.get("elements", [])))

        if not candidates:
            return {"routes": []}
        BAND_TO_KMH = {1: 7, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 85}

        plans = []
        for plan in candidates:
            try:
                plain_coords = [[p["lat"], p["lon"]] for p in plan["coords"]]
                analysis = match_route_to_lta_links(plain_coords)

                # Calculate T+15 ETA for candidate routes
                true_total_minutes = 0
                for link in analysis["matched_links"]:
                    if not isinstance(link, dict):
                        continue
                    pred = link.get("prediction")
                    if not isinstance(pred, dict):
                        continue


                    pred_band = pred.get("predicted_val")
                    if pred_band is None:
                        continue
                    speed_kmh = BAND_TO_KMH.get(pred_band, 35)
                    true_total_minutes += (link["segment_len_m"] / 1000) / speed_kmh * 60.0

                plan["estMinutes"] = round(true_total_minutes, 2)
                plan["plain_coords"] = plain_coords
                plans.append(plan)
            except Exception as plan_err:
                print(f"Skipping bad reroute candidate: {plan_err}", flush=True)
                traceback.print_exc()
                continue
            
        plans.sort(key=lambda x: x["estMinutes"])

        return {"routes": plans}

    except Exception as e:
        print(f"Error in rerouting: {e}", flush=True)
        traceback.print_exc()
        return {"routes": [], "error": str(e)}


def get_sector(row):
    name = str(row.get('road_name', '')).upper()
    lon = row.get('mid_lon', 0)
    lat = row.get('mid_lat', 0)
    
    # --- EAST-WEST ROADS (Use Longitude) ---
    if "PAN ISLAND" in name:
        if lon < 103.73: return "Jurong"
        if lon < 103.82: return "Bt Timah"
        if lon < 103.88: return "Toa Payoh"
        if lon < 103.94: return "Bedok"
        return "Changi"
        
    if "AYER RAJAH" in name:
        if lon < 103.72: return "Tuas/Jurong"
        if lon < 103.80: return "Clementi"
        return "City/Keppel"

    if "EAST COAST" in name:
        if lon < 103.88: return "Marina/City"
        if lon < 103.93: return "Marine Parade"
        return "Bedok/Changi"

    if "TAMPINES" in name:
        if lon < 103.89: return "Seletar/Sengkang"
        if lon < 103.93: return "Punggol/Pasir Ris"
        return "Tampines/Loyang"

    if "SELETAR" in name:
        if lon < 103.79: return "Woodlands"
        if lon < 103.83: return "Mandai"
        return "Yishun/Seletar"

    if "KRANJI" in name:
        if lon < 103.74: return "Jurong/Tengah"
        if lon < 103.76: return "Choa Chu Kang"
        return "Bt Panjang"

    if "MARINA COASTAL" in name:
        if lon < 103.86: return "Keppel"
        return "Marina South"

    # --- NORTH-SOUTH ROADS (Use Latitude) ---
    if "CENTRAL" in name: 
        if lat < 1.31: return "CBD"
        if lat < 1.35: return "Bishan"
        return "Ang Mo Kio"

    if "BUKIT TIMAH" in name:
        if lat < 1.37: return "Bt Panjang"
        if lat < 1.41: return "Mandai"
        return "Woodlands"

    if "KALLANG-PAYA" in name:
        if lat < 1.33: return "Kallang (Tunnel)"
        if lat < 1.36: return "Paya Lebar"
        return "Hougang/Sengkang"

    return "Main"

# For Incident Hotspots dashboard
@app.get("/api/hotspots")
def get_dashboard_hotspots():
    return {
        "status": "success",
        "data": hotspots_cache
    }
