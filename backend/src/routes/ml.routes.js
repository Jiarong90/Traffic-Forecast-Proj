module.exports = function registerMlProxyRoutes(ctx) {
  const {
    app,
    requireAuth,
    requireAdmin,
    getFastApiBaseUrl
  } = ctx;

// Add ML Listener
// Check all endpoints starting with /api/ml/*
const mlGatekeeper = (req, res, next) => {
  req.mlSubPath = req.params[0];
  req.mlQuery = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  const publicPaths = ['expressway-forecast', 'expressway-geometry', 'map-hotspots', 'hotspots', 'vms-landmarks', 'incident-predict'];

  const adminPaths = [
    'replay/start',
    'replay/stop',
    'replay/latest'
  ];

  if (publicPaths.includes(req.mlSubPath)) {
    console.log(`Public Access: ${req.mlSubPath}`);
    return next();
  }

  if (adminPaths.includes(req.mlSubPath)) {
    console.log(`Admin Access: ${req.mlSubPath}`);
    return requireAuth(req, res, () => requireAdmin(req, res, next));
  }

  console.log(`Protected Access: ${req.mlSubPath}`);
  return requireAuth(req, res, next);
};

const mlProxy = async (req, res) => {
  const fastApiBaseUrl = await getFastApiBaseUrl();
  const targetUrl = `${fastApiBaseUrl}/api/${req.mlSubPath}${req.mlQuery}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || ''
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = { error: `FastAPI returned non-JSON response for ${req.mlSubPath}` };
    }
    res.status(response.status).json(data);
  } catch (error) {
    console.error(`Service failed for ${req.mlSubPath}:`, error.message);
    res.status(500).json({ error: "Service Unreachable" });
  }
};

app.all('/api/ml/*', mlGatekeeper, mlProxy);
};
