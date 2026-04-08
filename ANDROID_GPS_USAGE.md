# Android GPS Usage Guide

This guide explains how to use an Android phone as the live GPS source for FAST.

## What It Drives

When Android location sharing is active, the demo can use the phone as the primary live location source for:
- `Current Location` in `Route Planner`
- live red-dot navigation
- route progress tracking
- rerouting after deviation
- weather lookup from current location

Mac/browser geolocation is only a fallback.

## Start The Demo

### Recommended

```bash
cd /Users/apple/Desktop/fyp_demo
./start.sh
```

### Manual

Terminal 1:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

Terminal 2:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

## Start HTTPS Tunnel

Android browsers require HTTPS for geolocation.

Use:

```bash
cloudflared tunnel --url http://localhost:3000
```

You will get a temporary address like:

```text
https://xxxxx.trycloudflare.com
```

This address changes whenever `cloudflared` is restarted.

## Android Page

Open on Android:

```text
https://xxxxx.trycloudflare.com/ui2/mobile-location.html
```

Then tap:
- `START SHARING`

## Verify Live Location

On the Mac, open:

- [http://localhost:3000/api/mobile-location/latest](http://localhost:3000/api/mobile-location/latest)

Expected success fields:

```json
{
  "source": "mobile",
  "fresh": true
}
```

## Use In The Demo

On the Mac:
- [http://localhost:3000/ui2/](http://localhost:3000/ui2/)

Then:
1. open `Route Planner`
2. choose `Current Location`
3. enter destination
4. calculate route
5. click `USE THIS ROUTE`

## Stop Sharing

On Android:
- tap `STOP`

The backend should return to:

```json
{
  "lat": null,
  "lon": null,
  "source": "none",
  "fresh": false
}
```

## Use Again Later

1. make sure Node is running
2. make sure FastAPI is running if needed
3. restart `cloudflared` if the old tunnel is gone
4. open the latest mobile page URL
5. tap `START SHARING`

## Common Issues

### Only secure origins are allowed

Cause:
- Android page opened through plain HTTP

Fix:
- use the latest `https://...trycloudflare.com/...` address

### Upload failed

Check:
- `npm start` is running
- `cloudflared` is running
- mobile page uses the current tunnel URL

### Current Location still times out

Check:
- `/api/mobile-location/latest` returns `"source": "mobile"` and `"fresh": true`
- the Android page is still open
- phone browser did not suspend the page in background
