module.exports = function registerRoutePlanningRoutes(ctx) {
  const {
    app,
    nowIso,
    loadLtaSignalGeoJsonCameras,
    callFastApiJson,
    runPythonCompute,
    fetchRoadNetworkByBbox,
    toNumber,
    buildRoutePlanFriendlyError
  } = ctx;
// Python backend route planning using A*, returning three route options: fastest, fewer traffic lights, and balanced.
// Python 后端路线规划（A*），返回 3 条路线：时间优先/少红绿灯/均衡
app.post('/api/route-plan', async (req, res) => {
  try {
      /**
   * Main Python route planning entry point.
   *
   * Flow:
   * 1) Validate start and end coordinates from the frontend.
   * 2) Fetch the road network within the bounding box and traffic signal points.
   * 3) Call the Python route planner to generate three candidate routes.
   * 4) Return the routes with metadata such as engine, signal count, and generation time.
   *
   * Note:
   * - This endpoint only handles basic route generation.
   * - Event evaluation is handled by /api/route-events/* endpoints.
   */
    const start = req.body?.start || {};
    const end = req.body?.end || {};
    const startLat = toNumber(start.lat);
    const startLon = toNumber(start.lon);
    const endLat = toNumber(end.lat);
    const endLon = toNumber(end.lon);
    if (!Number.isFinite(startLat) || !Number.isFinite(startLon) || !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
      return res.status(400).json({ error: 'Invalid start/end coordinates, expected {start:{lat,lon}, end:{lat,lon}}' });
    }

    const padding = Math.max(0.01, Math.min(0.08, toNumber(req.body?.paddingDeg) || 0.02));
    const s = Math.min(startLat, endLat) - padding;
    const n = Math.max(startLat, endLat) + padding;
    const w = Math.min(startLon, endLon) - padding;
    const e = Math.max(startLon, endLon) + padding;

    const [roads, ltaSignals] = await Promise.all([
      fetchRoadNetworkByBbox(s, w, n, e),
      loadLtaSignalGeoJsonCameras()
    ]);
    const signalPoints = (ltaSignals || [])
      .map((x) => ({ lat: toNumber(x.Latitude), lon: toNumber(x.Longitude) }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    const payload = {
      roads,
      start: { lat: startLat, lon: startLon },
      end: { lat: endLat, lon: endLon },
      signalPoints
    };
    const avoidPointsRaw = Array.isArray(req.body?.avoidPoints) ? req.body.avoidPoints : [];
    const avoidPoints = avoidPointsRaw.slice(0, 80).map((point) => {
      const lat = toNumber(point?.lat);
      const lon = toNumber(point?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        lat,
        lon,
        type: String(point?.type || 'traffic-obstacle').slice(0, 40),
        label: String(point?.label || 'Traffic obstacle').slice(0, 120),
        radiusMeters: Math.max(80, Math.min(800, toNumber(point?.radiusMeters) || toNumber(req.body?.avoidRadiusMeters) || 320)),
        penaltyMultiplier: Math.max(4, Math.min(60, toNumber(point?.penaltyMultiplier) || toNumber(req.body?.avoidPenaltyMultiplier) || 20))
      };
    }).filter(Boolean);
    const blockedEdgesRaw = Array.isArray(req.body?.blockedEdges)
      ? req.body.blockedEdges
      : (Array.isArray(req.body?.blocked_edges) ? req.body.blocked_edges : []);
    const blockedEdges = blockedEdgesRaw.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 120);
    if (avoidPoints.length) payload.avoidPoints = avoidPoints;
    if (blockedEdges.length) payload.blockedEdges = blockedEdges;
    const avoidRadiusMeters = toNumber(req.body?.avoidRadiusMeters);
    const avoidPenaltyMultiplier = toNumber(req.body?.avoidPenaltyMultiplier);
    if (Number.isFinite(avoidRadiusMeters)) payload.avoidRadiusMeters = avoidRadiusMeters;
    if (Number.isFinite(avoidPenaltyMultiplier)) payload.avoidPenaltyMultiplier = avoidPenaltyMultiplier;
    let pyResult;
    let engine = 'fastapi';
    try {
      pyResult = await callFastApiJson('/compute/plan-routes', payload, 15000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route planning fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('plan_routes', payload, 15000);
      engine = 'python-fallback';
    }

    if (!Array.isArray(pyResult?.routes) || !pyResult.routes.length) {
      return res.status(404).json({ error: 'No available route found' });
    }
    res.json({
      routes: pyResult.routes,
      meta: {
        engine,
        signalCount: signalPoints.length,
        avoidPointCount: avoidPoints.length,
        blockedEdgeCount: blockedEdges.length,
        generatedAt: nowIso()
      }
    });
  } catch (e) {
    console.error('Python route planning failure details:', e.message);
    const friendly = buildRoutePlanFriendlyError(e);
    res.status(friendly.status).json({
      error: friendly.error,
      details: friendly.details,
      retryable: friendly.retryable
    });
  }
});

// 路线事件相关性筛选（Python）
app.post('/api/route-events/analyze', async (req, res) => {
  try {
    /**
     * 路线事件筛选（Python）
     *
     * 输入：routeCoords + events + userLoc
     * 输出：与当前路线阶段相关的事件（用于后续评分）
     */
    const routeCoords = Array.isArray(req.body?.routeCoords) ? req.body.routeCoords : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const userLoc = req.body?.userLoc || null;
    const payload = {
      routeCoords,
      events,
      userLoc
    };
    let pyResult;
    try {
      pyResult = await callFastApiJson('/compute/analyze-events-for-route', payload, 10000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route-event analyze fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('analyze_events_for_route', payload, 10000);
    }
    res.json({
      value: Array.isArray(pyResult?.value) ? pyResult.value : []
    });
  } catch (e) {
    res.status(500).json({ error: 'Python route-event analyze failed', details: e.message });
  }
});

// 路线事件评分/拥堵评估（Python）
app.post('/api/route-events/evaluate', async (req, res) => {
  try {
    /**
     * 路线事件评分（Python）
     *
     * 输入：候选路线 + 事件列表
     * 输出：
     * - recommendedRouteId（综合推荐）
     * - currentFastestId（考虑事件延误后的当前最快）
     * - evaluations（每条路线命中与评分明细）
     */
    const routes = Array.isArray(req.body?.routes) ? req.body.routes : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const payload = {
      routes,
      events
    };
    let pyResult;
    try {
      pyResult = await callFastApiJson('/compute/evaluate-route-events', payload, 10000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route-event evaluate fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('evaluate_route_events', payload, 10000);
    }
    res.json({
      recommendedRouteId: pyResult?.recommendedRouteId || null,
      currentFastestId: pyResult?.currentFastestId || null,
      evaluations: Array.isArray(pyResult?.evaluations) ? pyResult.evaluations : []
    });
  } catch (e) {
    res.status(500).json({ error: 'Python route-event evaluate failed', details: e.message });
  }
});

// 获取新加坡道路网络（Overpass 接口）
app.get('/api/roads', async (req, res) => {
  const { minLat, minLon, maxLat, maxLon } = req.query;
  const bbox = [minLat, minLon, maxLat, maxLon].map(parseFloat);
  if (bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }
  const [s, w, n, e] = bbox;
  try {
    const data = await fetchRoadNetworkByBbox(s, w, n, e);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load road data', details: e.message });
  }
});
};
