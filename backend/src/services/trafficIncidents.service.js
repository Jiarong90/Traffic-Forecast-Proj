const fs = require('fs/promises');
const config = require('../../config');
const { incidentCameraMatchCache, mockIncidentRuntime } = require('../state');
const { nowIso, toNumber, toNumOrNull, distanceMeters, deriveIncidentArea } = require('../utils/common');
const { withCache } = require('./cache.service');
const { callFastApiJson, runPythonCompute } = require('./python.service');

function inferImpactByType(type, message = '') {
  const t = `${type || ''} ${message || ''}`.toLowerCase();
  if (/(accident|collision|crash|fire|fatal)/.test(t)) return { spreadRadiusKm: 2.2, minMin: 50, maxMin: 110 };
  if (/(roadwork|construction|road works|works)/.test(t)) return { spreadRadiusKm: 1.5, minMin: 45, maxMin: 95 };
  if (/(breakdown|stalled|vehicle breakdown)/.test(t)) return { spreadRadiusKm: 1.2, minMin: 25, maxMin: 60 };
  if (/(heavy traffic|congestion|jam)/.test(t)) return { spreadRadiusKm: 1.0, minMin: 20, maxMin: 45 };
  return { spreadRadiusKm: 0.9, minMin: 15, maxMin: 35 };
}

function buildIncidentImpactMeta(raw) {
  const inferred = inferImpactByType(raw?.type, raw?.message);
  const ltaMin = toNumOrNull(raw?.estimatedImpactMin ?? raw?.estimated_impact_min ?? raw?.impactMin ?? raw?.impact_min);
  const ltaMax = toNumOrNull(raw?.estimatedImpactMax ?? raw?.estimated_impact_max ?? raw?.impactMax ?? raw?.impact_max);
  const radius = toNumOrNull(raw?.spreadRadiusKm ?? raw?.spread_radius_km ?? raw?.radiusKm ?? raw?.radius_km);
  let minMin = ltaMin ?? inferred.minMin;
  let maxMin = ltaMax ?? inferred.maxMin;
  if (maxMin < minMin) [minMin, maxMin] = [maxMin, minMin];
  return {
    spreadRadiusKm: Number((radius ?? inferred.spreadRadiusKm).toFixed(1)),
    estimatedDurationMin: Math.max(1, Math.round(minMin)),
    estimatedDurationMax: Math.max(Math.round(minMin), Math.round(maxMin))
  };
}

function getImpactFromIncidentRow(row) {
  return buildIncidentImpactMeta({
    type: row.Type || row.type,
    message: row.Message || row.message,
    estimated_impact_min: row.estimated_impact_min,
    estimated_impact_max: row.estimated_impact_max
  });
}

function buildMockIncidentRecord(row, now, overrides = {}) {
  const impact = getImpactFromIncidentRow(row);
  return {
    id: String(row.incident_id || row.id || '').trim(),
    type: row.Type || row.type || 'Incident',
    message: row.Message || row.message || 'Mock incident',
    lat: toNumber(row.Latitude ?? row.lat),
    lon: toNumber(row.Longitude ?? row.lon),
    createdAt: now,
    riskLevel: row.risk_level || 'Medium',
    lifecycleState: overrides.lifecycleState || 'Active',
    source: 'mock',
    estimatedDurationMin: impact.estimatedDurationMin,
    estimatedDurationMax: impact.estimatedDurationMax,
    spreadRadiusKm: impact.spreadRadiusKm,
    notes: overrides.notes ?? (row.notes || '')
  };
}

async function normalizeIncidentListLocal(list, prefix, defaultCreatedAt = nowIso()) {
  return (list || [])
    .map((x, idx) => {
      const message = x.Message || x.message || x.Description || x.Type || '';
      const lat = toNumber(x.Latitude ?? x.latitude ?? x.Lat);
      const lon = toNumber(x.Longitude ?? x.longitude ?? x.Lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const impact = buildIncidentImpactMeta({
        type: x.Type || x.type,
        message,
        estimated_impact_min: x.estimated_impact_min ?? x.EstimatedImpactMin,
        estimated_impact_max: x.estimated_impact_max ?? x.EstimatedImpactMax,
        spread_radius_km: x.spread_radius_km ?? x.SpreadRadiusKm
      });
      return {
        id: x.IncidentID || x.id || `${prefix}-incident-${idx + 1}`,
        message,
        type: x.Type || x.type || 'Incident',
        lat,
        lon,
        createdAt: x.CreatedAt || x.Created || x.updated_at || defaultCreatedAt,
        estimatedDurationMin: impact.estimatedDurationMin,
        estimatedDurationMax: impact.estimatedDurationMax,
        spreadRadiusKm: impact.spreadRadiusKm
      };
    })
    .filter(Boolean);
}

async function normalizeIncidentList(list, prefix) {
  try {
    const payload = { list: Array.isArray(list) ? list : [], prefix, defaultCreatedAt: nowIso() };
    const result = await callFastApiJson('/compute/normalize-incidents', payload, 10000);
    if (Array.isArray(result?.value)) return result.value;
    throw new Error('FastAPI normalize_incidents returned invalid format');
  } catch (err) {
    try {
      const result = await runPythonCompute('normalize_incidents', { list: Array.isArray(list) ? list : [], prefix, defaultCreatedAt: nowIso() }, 10000);
      if (Array.isArray(result?.value)) return result.value;
      throw new Error('Python normalize_incidents returned invalid format');
    } catch (fallbackErr) {
      console.warn(`FastAPI incident normalization fell back to Node.js: ${err.message}; python fallback: ${fallbackErr.message}`);
      return normalizeIncidentListLocal(list, prefix);
    }
  }
}

async function loadMockIncidentSpecs() {
  return withCache('incident-mock-specs', 60 * 1000, async () => {
    const raw = await fs.readFile(config.INCIDENT_MOCK_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const value = Array.isArray(parsed?.value) ? parsed.value : [];
    const absentPolls = Math.max(1, parseInt(parsed?.resolution_absent_polls || '2', 10) || 2);
    return { value, absentPolls };
  });
}

async function fetchMockIncidentsWithResolution() {
  const spec = await loadMockIncidentSpecs();
  const step = mockIncidentRuntime.step++;
  const now = nowIso();
  const active = [];
  let resolvedNow = 0;
  let clearingNow = 0;

  for (const row of spec.value) {
    const id = String(row.incident_id || row.id || '').trim();
    if (!id) continue;
    const presentUntil = Number.isFinite(Number(row.present_until_step)) ? Number(row.present_until_step) : -1;
    const alwaysPresent = presentUntil < 0;
    const presentNow = alwaysPresent || step <= presentUntil;
    const prev = mockIncidentRuntime.stateById.get(id) || { absentStreak: 0, resolved: false, seenCount: 0 };
    const next = { ...prev };
    if (presentNow) {
      next.absentStreak = 0;
      next.resolved = false;
      next.seenCount = (next.seenCount || 0) + 1;
      next.lastSeenAt = now;
      const nearEnd = !alwaysPresent && step >= Math.max(0, presentUntil - 1);
      const lifecycleState = nearEnd ? 'Clearing' : 'Active';
      if (lifecycleState === 'Clearing') clearingNow += 1;
      active.push(buildMockIncidentRecord(row, now, { lifecycleState }));
    } else {
      next.absentStreak = (next.absentStreak || 0) + 1;
      if (next.absentStreak >= spec.absentPolls) {
        if (!next.resolved) resolvedNow += 1;
        next.resolved = true;
        next.resolvedAt = now;
      } else if (!next.resolved) {
        clearingNow += 1;
        active.push({
          ...buildMockIncidentRecord(row, now, { lifecycleState: 'Clearing', notes: `${row.notes || ''}; missing ${next.absentStreak}/${spec.absentPolls}` }),
          message: `[Clearing check] ${row.Message || row.message || 'Mock incident'}`
        });
      }
    }
    mockIncidentRuntime.stateById.set(id, next);
  }

  return {
    value: active,
    meta: {
      source: 'mock',
      pollStep: step,
      resolutionAbsentPolls: spec.absentPolls,
      activeCount: active.length,
      clearingCount: clearingNow,
      resolvedCount: resolvedNow,
      generatedAt: now
    }
  };
}

async function fetchTrafficIncidentsRaw() {
  return withCache('data-gov-traffic-incidents', config.INCIDENT_SOURCE_TTL_MS, async () => {
    if (config.LTA_ACCOUNT_KEY) {
      try {
        const ltaResp = await fetch(config.LTA_TRAFFIC_INCIDENTS_API, {
          headers: { AccountKey: config.LTA_ACCOUNT_KEY, accept: 'application/json' }
        });
        if (ltaResp.ok) {
          const ltaData = await ltaResp.json();
          const ltaIncidents = await normalizeIncidentList(ltaData?.value, 'lta');
          if (ltaIncidents.length > 0) return ltaIncidents;
        }
      } catch (_) { }
    }

    const response = await fetch(config.TRAFFIC_INCIDENTS_API);
    if (!response.ok) throw new Error(`data.gov.sg incidents API error: ${response.status}`);
    const data = await response.json();
    return normalizeIncidentList((data.value || data.items || data || []), 'dgov');
  });
}

function toPythonRealtimeCameras(cameras) {
  return (cameras || []).map((cam) => ({
    CameraID: cam.CameraID,
    Latitude: toNumber(cam.Latitude),
    Longitude: toNumber(cam.Longitude),
    ImageLink: cam.ImageLink || null,
    Name: cam.Name || null
  }));
}

function stableIncidentMatchKey(inc) {
  const lat = Number(inc?.lat);
  const lon = Number(inc?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${Math.round(lat * 10000)}:${Math.round(lon * 10000)}`;
}

function cameraCoord(cam) {
  return { lat: parseFloat(cam?.Latitude), lon: parseFloat(cam?.Longitude) };
}

function safeNearestRealtimeCamera(inc, cameras) {
  const incLat = Number(inc?.lat);
  const incLon = Number(inc?.lon);
  if (!Number.isFinite(incLat) || !Number.isFinite(incLon)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const cam of cameras || []) {
    const c = cameraCoord(cam);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const d = distanceMeters(incLat, incLon, c.lat, c.lon);
    if (!Number.isFinite(d)) continue;
    if (d < bestDist) {
      bestDist = d;
      best = cam;
    }
  }
  if (!best || bestDist > 2000) return null;
  return { ...best, dist: bestDist };
}

function attachNearestRealtimeCameraLocal(incidents, cameras) {
  const normalizedCameras = Array.isArray(cameras) ? cameras : [];
  const now = Date.now();
  const staleMs = 5 * 60 * 1000;
  return incidents.map((inc) => {
    const key = stableIncidentMatchKey(inc);
    const cached = key ? incidentCameraMatchCache.get(key) : null;
    let nearest = safeNearestRealtimeCamera(inc, normalizedCameras);
    if (!nearest && cached && (now - cached.time) <= staleMs) nearest = cached.camera;
    if (key && nearest) incidentCameraMatchCache.set(key, { time: now, camera: nearest });
    const impact = buildIncidentImpactMeta(inc);
    return {
      id: inc.id,
      type: inc.type,
      message: inc.message,
      area: deriveIncidentArea(inc.message, inc.lat, inc.lon),
      lat: inc.lat,
      lon: inc.lon,
      createdAt: inc.createdAt,
      spreadRadiusKm: inc.spreadRadiusKm ?? impact.spreadRadiusKm,
      estimatedDurationMin: inc.estimatedDurationMin ?? impact.estimatedDurationMin,
      estimatedDurationMax: inc.estimatedDurationMax ?? impact.estimatedDurationMax,
      imageLink: nearest?.ImageLink || null,
      cameraName: nearest?.Name || null,
      cameraDistanceMeters: nearest?.dist ? Math.round(nearest.dist) : null
    };
  });
}

async function attachNearestRealtimeCamera(incidents, cameras) {
  try {
    const payload = { incidents: Array.isArray(incidents) ? incidents : [], cameras: toPythonRealtimeCameras(cameras) };
    const result = await callFastApiJson('/compute/enrich-incidents-with-cameras', payload, 10000);
    if (Array.isArray(result?.value)) return result.value;
    throw new Error('FastAPI returned invalid data format');
  } catch (err) {
    try {
      const payload = { incidents: Array.isArray(incidents) ? incidents : [], cameras: toPythonRealtimeCameras(cameras) };
      const result = await runPythonCompute('enrich_incidents_with_cameras', payload, 10000);
      if (Array.isArray(result?.value)) return result.value;
      throw new Error('Python returned invalid data format');
    } catch (fallbackErr) {
      console.warn(`FastAPI incident matching fell back to Node.js: ${err.message}; python fallback: ${fallbackErr.message}`);
      return attachNearestRealtimeCameraLocal(incidents, cameras);
    }
  }
}

module.exports = {
  fetchTrafficIncidentsRaw,
  fetchMockIncidentsWithResolution,
  attachNearestRealtimeCamera
};
