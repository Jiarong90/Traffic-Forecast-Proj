# ROUTING README

## Current Route Planning Flow

The current route planning flow is:

1. User enters start and destination
2. Start supports:
   - postal code
   - place name
   - MRT station
   - current location
3. Frontend calls `POST /api/route-plan`
4. Node.js prepares the route request
5. FastAPI runs compute logic in `compute_engine.py`
6. Three route options are returned:
   - fastest
   - fewer lights
   - balanced

## Current Route Planner Features

Each route card shows:
- ETA
- delay
- distance
- traffic lights
- incidents count
- cameras count

The preference button can switch among:
- FASTEST ROUTE
- FEWER LIGHTS
- BALANCED

After selecting and confirming a route:
- start pin is placed
- destination pin is placed
- a red live-location marker follows the user
- route-related camera points are shown
- route-related incident points are shown
- start/destination popup shows place name and weather

## Local Road Network

Route planning now prefers the local Singapore road network snapshot:

- `camera1/data/sg-road-network-overpass.json`

This reduces timeout issues from live Overpass requests.

## Related APIs

- `GET /api/geocode`
- `GET /api/reverse-geocode`
- `GET /api/weather/current`
- `POST /api/route-plan`
- `POST /api/route-events/analyze`
- `POST /api/route-events/evaluate`

## Notes

- FastAPI should be running before route planning is tested.
- Current location depends on browser geolocation permission.
