# Android GPS Usage Guide

This guide explains how to use an Android phone as the live location source for the FAST demo, so that the route planner and live navigation on the Mac can follow the phone's real GPS position instead of relying on the Mac browser's own location.

## What this feature does

When enabled, the Android phone continuously uploads its live GPS coordinates to the local FAST backend. The Mac browser then uses that mobile position as the primary location source for:

- `Current Location` in `Route Planner`
- live red-dot navigation tracking
- route deviation detection
- automatic rerouting

The Mac browser location is only used as a fallback when the Android location source is not available.

## Before you start

Make sure you have:

- a Mac running this FAST project
- an Android phone with browser location permission enabled
- `cloudflared` installed on the Mac
- both devices connected to the internet

## Step 1: Start the FAST backend on the Mac

Open Terminal on the Mac.

### Terminal 1: Start Node.js

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

### Terminal 2: Start FastAPI

If your route planning stack uses FastAPI, start it as well:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

## Step 2: Start a secure HTTPS tunnel

Android browsers require a secure HTTPS origin for geolocation. Because the local Mac server is normally running on `http://localhost:3000`, you must expose it through `cloudflared`.

### Terminal 3: Start cloudflared

```bash
cloudflared tunnel --url http://localhost:3000
```

When it starts successfully, it will print a temporary HTTPS address like:

```text
https://xxxxx.trycloudflare.com
```

This is the mobile-accessible address for this session.

Important:

- this address is not permanent
- every time you restart `cloudflared`, the address may change
- always use the latest address printed in the terminal

## Step 3: Open the Android mobile location page

On the Android phone, open:

```text
https://xxxxx.trycloudflare.com/ui2/mobile-location.html
```

Replace `xxxxx.trycloudflare.com` with the current tunnel address shown by `cloudflared`.

## Step 4: Start sharing location from Android

On the Android page:

1. tap `START SHARING`
2. allow browser location permission when prompted

If successful, the mobile page will start uploading live location updates to the FAST backend.

## Step 5: Verify that the Mac is receiving Android location

On the Mac, open:

[http://localhost:3000/api/mobile-location/latest](http://localhost:3000/api/mobile-location/latest)

If the Android phone is connected and uploading, you should see JSON similar to:

```json
{
  "lat": 1.3549309,
  "lon": 103.7528975,
  "accuracy": 16.69,
  "timestamp": 1774964800123,
  "source": "mobile",
  "deviceName": "Android Phone",
  "fresh": true
}
```

The important fields are:

- `"source": "mobile"`
- `"fresh": true`

That means the FAST demo is currently receiving live Android GPS coordinates.

## Step 6: Use Route Planner with Android live location

Open the main demo on the Mac:

[http://localhost:3000/ui2/](http://localhost:3000/ui2/)

Then:

1. go to `Route Planner`
2. click the start input field
3. choose `Current Location`
4. enter the destination
5. generate routes
6. click `USE THIS ROUTE`

At this point:

- the red dot should follow the Android phone position
- the travelled part of the route turns grey
- the remaining part stays in the route color
- if the phone moves off the route, the system can reroute from the current live position

## How to stop Android location sharing

On the Android mobile page, tap:

- `STOP`

This stops browser GPS tracking on the phone and clears the live mobile location on the backend.

You can verify that sharing has stopped by checking:

[http://localhost:3000/api/mobile-location/latest](http://localhost:3000/api/mobile-location/latest)

It should return:

```json
{
  "lat": null,
  "lon": null,
  "accuracy": null,
  "timestamp": null,
  "source": "none",
  "deviceName": "",
  "fresh": false
}
```

## How to use it again later

To use the Android GPS feature again:

1. make sure `npm start` is running
2. make sure `npm run start:fastapi` is running if needed
3. make sure `cloudflared tunnel --url http://localhost:3000` is running
4. open the latest tunnel URL on Android:

```text
https://xxxxx.trycloudflare.com/ui2/mobile-location.html
```

5. tap `START SHARING`

## Common problems

### 1. Android page says geolocation is not allowed

If you see an error like:

```text
Only secure origins are allowed
```

you are probably opening the mobile page through plain HTTP instead of HTTPS.

Use the `cloudflared` HTTPS address, not:

```text
http://localhost:3000
http://172.x.x.x:3000
```

### 2. Android page says upload failed

This usually means the backend was not restarted after the mobile-location API was added, or the tunnel points to the wrong running server.

Check that:

- `npm start` is running
- the latest tunnel URL is being used
- [http://localhost:3000/api/mobile-location/latest](http://localhost:3000/api/mobile-location/latest) returns JSON

### 3. Mac still shows browser location timeout

If `Route Planner -> Current Location` still fails, check:

- whether the Android phone is still sharing
- whether the mobile page is still open
- whether `/api/mobile-location/latest` returns `"fresh": true`

If mobile sharing stops, the Mac will eventually fall back to browser geolocation.

### 4. The Android phone was working before, but now no live coordinates are coming in

This usually happens because:

- the phone page was closed
- the browser was backgrounded
- the phone screen was locked for too long
- `cloudflared` was restarted and the old URL is no longer valid

If needed, reopen the latest mobile page URL and tap `START SHARING` again.

## Quick-start summary

Each time you want to use Android GPS as the live source:

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
npm start
```

```bash
cd /Users/apple/Desktop/fyp_demo/camera1
source .venv/bin/activate
npm run start:fastapi
```

```bash
cloudflared tunnel --url http://localhost:3000
```

Then on Android open:

```text
https://xxxxx.trycloudflare.com/ui2/mobile-location.html
```

Tap:

```text
START SHARING
```

Then on the Mac use:

- `Route Planner`
- `Current Location`
- `USE THIS ROUTE`

