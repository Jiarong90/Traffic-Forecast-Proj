const registerMlRoutes = require('./ml.routes');
const registerAuthRoutes = require('./auth.routes');
const registerAdminRoutes = require('./admin.routes');
const registerTrafficRoutes = require('./traffic.routes');
const registerRouteRoutes = require('./route.routes');
const registerWeatherRoutes = require('./weather.routes');
const registerFeedbackRoutes = require('./feedback.routes');
const registerChatRoutes = require('./chat.routes');
const registerReplayRoutes = require('./replay.routes');

module.exports = function registerApiRoutes(ctx) {
  // Register concrete routes before the /api/ml/* wildcard proxy.
  registerAuthRoutes(ctx);
  registerAdminRoutes(ctx);
  registerTrafficRoutes(ctx);
  registerRouteRoutes(ctx);
  registerWeatherRoutes(ctx);
  registerFeedbackRoutes(ctx);
  registerReplayRoutes(ctx);
  registerChatRoutes(ctx);
  registerMlRoutes(ctx);
};
