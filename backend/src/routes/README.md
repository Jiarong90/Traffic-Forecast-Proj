# FAST Node API Routes

`backend/server.js` is now only the startup entry.
`backend/src/app.js` creates the Express app and middleware.
`backend/src/context.js` injects shared helpers from `services/`, `utils/`, `db.js`, and `state.js`.
This folder contains API route registration modules using the recommended `*.routes.js` naming.

## Route Modules

- `auth.routes.js`: auth plus current user/profile/settings endpoints
- `admin.routes.js`: admin users, feedback, habit routes and route alerts
- `traffic.routes.js`: cameras, incidents, traffic news, geocode, OneMotoring ERP/PGS and mobile location endpoints
- `route.routes.js`: route planning, road network loading and route event analysis/evaluation
- `weather.routes.js`: weather, forecast, AI weather advice, AI incident summary and weather impact prediction
- `feedback.routes.js`: compatibility endpoints for recalculate, incident feedback proxy and incident prediction
- `ml.routes.js`: `/api/ml/*` FastAPI proxy gatekeeper
- `chat.routes.js`: FASTbot endpoint and Gemini function declarations
- `replay.routes.js`: admin route replay recording start/stop endpoints
- `index.js`: central route registration in the same order as the previous single-file server behavior
