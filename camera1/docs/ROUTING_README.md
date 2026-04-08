# ROUTING README

## Current Route Planning Flow

1. User enters start and destination
2. Start supports:
   - postal code
   - place name
   - MRT station
   - current location
3. Frontend calls:
   - `POST /api/route-plan`
4. Node prepares request context
5. FastAPI / Python computes route candidates
6. Three route options are returned:
   - fastest
   - fewer lights
   - balanced

## Current Route Planner Features

### Route cards

Each route card currently shows:
- ETA
- delay
- distance
- lights
- incidents count
- cameras count
- fuel cost
- fuel used
- ERP charges
- total estimated cost

### Cost controls

`TRIP COST ESTIMATE` currently supports:
- vehicle type
- fuel grade
- fuel consumption
- saved vehicle selection from Settings

### After route confirmation

After clicking `USE THIS ROUTE`:
- start pin appears
- destination pin appears
- live red-dot navigation starts
- travelled part turns grey
- remaining route keeps route color
- route incidents appear on map
- route cameras appear on map
- nearest live camera can be toggled

### Habit routes integration

Saved habit routes can now be loaded into the planner.

Current behavior:
- `LOAD` fills start and destination
- switches back to planner tab
- runs full route calculation again

## Chatbot Routing

`FASTbot` can trigger route planning.

Current supported flow:
- ask for a route
- bot switches to `Route Planner`
- fills start / destination
- directly triggers route calculation

## Current Location

Current location can come from:
- Android mobile upload source
- browser fallback

Android guide:
- [/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md](/Users/apple/Desktop/fyp_demo/ANDROID_GPS_USAGE.md)

## Notes

- Route analytics can partially degrade if FastAPI is down.
- Dashboard analytics and route analytics are no longer fully independent; both rely on the combined FastAPI service for advanced blocks.
