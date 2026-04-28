const fs = require('fs/promises');
const config = require('../../config');
const { realtimeCameraFallback } = require('../state');
const { downsample } = require('../utils/common');
const { withCache } = require('./cache.service');

async function fetchTrafficImageCameras() {
  const cameras = await withCache('data-gov-traffic-images', 45 * 1000, async () => {
    const response = await fetch(config.TRAFFIC_IMAGES_API);
    if (!response.ok) {
      throw new Error(`data.gov.sg API error: ${response.status}`);
    }
    const data = await response.json();
    return (data.items || [])
      .flatMap((item) => (item.cameras || []).map((cam) => ({
        CameraID: `dgov-${cam.camera_id}`,
        Latitude: cam.location?.latitude,
        Longitude: cam.location?.longitude,
        ImageLink: cam.image,
        Name: `LTA Traffic Camera ${cam.camera_id}`,
        Source: 'data.gov.sg Traffic Images',
        HasRealtimeImage: true
      })));
  });
  realtimeCameraFallback.time = Date.now();
  realtimeCameraFallback.value = Array.isArray(cameras) ? cameras : [];
  return cameras;
}

async function loadLtaSignalGeoJsonCameras() {
  return withCache('lta-signal-geojson', config.STATIC_SOURCE_TTL_MS, async () => {
    const content = await fs.readFile(config.LTA_SIGNAL_GEOJSON_PATH, 'utf-8');
    const geo = JSON.parse(content);
    const features = downsample((geo.features || []), config.MAX_LTA_SIGNAL_POINTS);
    return features
      .filter((f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates))
      .map((f, idx) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const uniq = p.UNIQUE_ID ?? p.OBJECTID_1 ?? idx;
        return {
          CameraID: `lta-signal-${uniq}`,
          Latitude: lat,
          Longitude: lon,
          Name: p.TYP_NAM ? `LTA signal point (${p.TYP_NAM})` : `LTA signal point ${uniq}`,
          Source: 'LTA Traffic Signal GeoJSON',
          HasRealtimeImage: false,
          Note: 'No realtime image (public point only)'
        };
      });
  });
}

function parseKmlCoordinates(kmlText) {
  const points = [];
  const placemarks = kmlText.match(/<Placemark[\s\S]*?<\/Placemark>/g) || [];
  for (const pm of placemarks) {
    const coordMatch = pm.match(/<coordinates>\s*([^<]+)\s*<\/coordinates>/i);
    if (!coordMatch) continue;
    const [lonRaw, latRaw] = coordMatch[1].split(',').map((s) => s.trim());
    const lon = parseFloat(lonRaw);
    const lat = parseFloat(latRaw);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const nameMatch = pm.match(/<name>\s*([^<]+)\s*<\/name>/i);
    points.push({ lat, lon, name: nameMatch ? nameMatch[1].trim() : null });
  }
  return points;
}

async function fetchSpfRedLightCameras() {
  return withCache('spf-red-light', config.STATIC_SOURCE_TTL_MS, async () => {
    let pollResp = await fetch(config.SPF_RED_LIGHT_API);
    if (!pollResp.ok) {
      pollResp = await fetch(config.SPF_RED_LIGHT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    }
    if (!pollResp.ok) throw new Error(`SPF dataset API error: ${pollResp.status}`);
    const pollData = await pollResp.json();
    const fileUrl = pollData?.data?.url;
    if (!fileUrl) throw new Error('SPF dataset did not return download URL');
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) throw new Error(`SPF dataset file download failed: ${fileResp.status}`);
    const kml = await fileResp.text();
    const points = downsample(parseKmlCoordinates(kml), config.MAX_SPF_POINTS);
    return points.map((p, idx) => ({
      CameraID: `spf-redlight-${idx + 1}`,
      Latitude: p.lat,
      Longitude: p.lon,
      Name: p.name ? `SPF red-light camera (${p.name})` : `SPF red-light camera ${idx + 1}`,
      Source: 'Singapore Police Force Red Light Cameras',
      HasRealtimeImage: false,
      Note: 'No realtime image (public point only)'
    }));
  });
}

async function fetchOsmCameraLocations() {
  return withCache('osm-cameras', config.STATIC_SOURCE_TTL_MS, async () => {
    const query = `
[out:json][timeout:25];
(
  node["man_made"="surveillance"]["surveillance:type"~"camera"](${config.SG_BBOX});
  node["highway"="speed_camera"](${config.SG_BBOX});
);
out body;
    `.trim();
    const resp = await fetch(config.OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
    const data = await resp.json();
    const elements = downsample((data.elements || []), config.MAX_OSM_POINTS);
    return elements
      .filter((el) => el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number')
      .map((el, idx) => ({
        CameraID: `osm-camera-${el.id || idx}`,
        Latitude: el.lat,
        Longitude: el.lon,
        Name: el.tags?.name || `OSM public camera point ${el.id || idx}`,
        Source: 'OpenStreetMap Camera Nodes',
        HasRealtimeImage: false,
        Note: 'No realtime image (public point only)'
      }));
  });
}

module.exports = {
  fetchTrafficImageCameras,
  loadLtaSignalGeoJsonCameras,
  fetchSpfRedLightCameras,
  fetchOsmCameraLocations
};
