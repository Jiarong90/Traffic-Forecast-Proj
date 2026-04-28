# FAST Frontend JavaScript Layout

Runtime JavaScript is loaded from `frontend/index.html` using the recommended structure:

- `app.js`: final frontend bootstrap
- `auth.js`: navigation, auth, profile, settings and membership runtime
- `state.js`: shared runtime state, route constants and map icon constants
- `utils.js`: shared auth, geometry, incident formatting, route-event and geolocation helpers
- `pages/dashboard.js`: dashboard incident overview, recent updates and evidence cards
- `pages/mapView.js`: Map View map setup, live cameras, LTA incidents and user feedback map layer
- `pages/alerts.js`: Alerts lists, traffic news feed, AI incident details and traffic impact prediction
- `pages/adminUsers.js`: admin user table and user feedback history table
- `pages/routePlanner.js`: route planner orchestration and page/event binding
- `pages/routePlanner/preferences.js`: saved places/routes panel and route preference switching
- `pages/routePlanner/details.js`: selected route detail panel and confirmed route cleanup
- `pages/routePlanner/mapData.js`: route map POIs, cameras, incidents, ERP and PGS markers
- `pages/routePlanner/tripCost.js`: vehicle, fuel, ERP and route cost calculation
- `pages/routePlanner/routeCards.js`: route option cards
- `pages/routePlanner/liveNavigation.js`: confirmed route tracking, live location and reroute flow
- `pages/routePlanner/feedbackModal.js`: road feedback modal and submission flow
- `pages/weather.js`: weather search, current location, forecast and advice runtime
- `features/reroute.js`: habit routes, route intelligence and reroute runtime
- `features/chatbot.js`: expressway analytics, hotspots, chatbot and admin recording runtime

Empty placeholder files were removed after the structural migration. Larger runtime blocks are being split by page/feature while preserving classic browser script loading behavior.
