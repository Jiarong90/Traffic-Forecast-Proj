const fs = require('fs/promises');
const config = require('../../config');
const { sourceCache } = require('../state');
const { toNumber } = require('../utils/common');
const { withCache } = require('./cache.service');
const { fetchJsonWithTimeout } = require('./dataSource.service');

function roundRoadCacheCoord(value) {
  return Number(toNumber(value).toFixed(3));
}

function makeRoadNetworkCacheKey(s, w, n, e) {
  return ['road-network', roundRoadCacheCoord(s), roundRoadCacheCoord(w), roundRoadCacheCoord(n), roundRoadCacheCoord(e)].join(':');
}

function buildRoutePlanFriendlyError(error) {
  const raw = String(error?.message || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('overpass')
    || lower.includes('road network')
    || lower.includes('timed out')
    || lower.includes('aborterror')
    || /\b504\b/.test(raw)
    || /\b502\b/.test(raw)
    || /\b503\b/.test(raw)
  ) {
    return {
      status: 503,
      error: 'Route planning temporarily unavailable',
      details: 'Road network service timed out while preparing the route. Please retry in 30-60 seconds or choose a shorter route.',
      retryable: true
    };
  }
  return {
    status: 500,
    error: 'Python route planning failed',
    details: raw || 'Unknown route planning error',
    retryable: false
  };
}

function pointWithinBbox(lat, lon, s, w, n, e) {
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

function subsetRoadNetworkByBbox(roads, s, w, n, e, marginDeg = 0.004) {
  const elements = Array.isArray(roads?.elements) ? roads.elements : [];
  const s2 = s - marginDeg;
  const w2 = w - marginDeg;
  const n2 = n + marginDeg;
  const e2 = e + marginDeg;
  const filtered = elements.filter((el) => {
    const geom = Array.isArray(el?.geometry) ? el.geometry : [];
    if (!geom.length) return false;
    return geom.some((p) => pointWithinBbox(Number(p?.lat), Number(p?.lon), s2, w2, n2, e2));
  });
  if (!filtered.length) return null;
  return { version: roads?.version, generator: roads?.generator, osm3s: roads?.osm3s, elements: filtered };
}

async function loadLocalRoadNetworkSnapshot() {
  return withCache('local-road-network-sg', config.LOCAL_ROAD_NETWORK_TTL_MS, async () => {
    const raw = await fs.readFile(config.LOCAL_ROAD_NETWORK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.elements) || !parsed.elements.length) {
      throw new Error('Local road network snapshot is empty');
    }
    return parsed;
  });
}

async function fetchRoadNetworkByBbox(s, w, n, e) {
  const cacheKey = makeRoadNetworkCacheKey(s, w, n, e);
  const now = Date.now();
  const cached = sourceCache.get(cacheKey);
  if (cached && now - cached.time < config.ROAD_NETWORK_CACHE_TTL_MS) return cached.value;
  try {
    const localRoads = await loadLocalRoadNetworkSnapshot();
    const localSubset = subsetRoadNetworkByBbox(localRoads, s, w, n, e);
    if (Array.isArray(localSubset?.elements) && localSubset.elements.length) {
      sourceCache.set(cacheKey, { time: now, value: localSubset });
      return localSubset;
    }
  } catch (localErr) {
    console.warn(`Local road network snapshot unavailable, falling back to Overpass: ${localErr.message}`);
  }
  const overpassQuery = `
[out:json][timeout:25];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$"](${s},${w},${n},${e});
);
out body geom;
  `.trim();
  const endpoints = [config.OVERPASS_API, 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const resp = await fetchJsonWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
      }, config.OVERPASS_FETCH_TIMEOUT_MS);
      if (!resp.ok) throw new Error(`Overpass API error: ${resp.status} (${endpoint})`);
      const data = await resp.json();
      if (!Array.isArray(data?.elements) || !data.elements.length) throw new Error(`Overpass returned empty road network (${endpoint})`);
      sourceCache.set(cacheKey, { time: now, value: data });
      return data;
    } catch (err) {
      lastErr = err?.name === 'AbortError' ? new Error(`Road network service timed out (${endpoint})`) : err;
    }
  }
  if (cached && now - cached.time < config.ROAD_NETWORK_STALE_TTL_MS) {
    console.warn(`Using stale cached road network for ${cacheKey} after Overpass failure: ${lastErr?.message || 'unknown error'}`);
    return cached.value;
  }
  throw lastErr || new Error('Failed to fetch Overpass road network');
}

module.exports = {
  buildRoutePlanFriendlyError,
  fetchRoadNetworkByBbox
};
