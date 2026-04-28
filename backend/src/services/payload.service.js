const { trimText, deriveIncidentArea } = require('../utils/common');

function normalizeRouteItem(item, index) {
  const name = String(item?.name || `Route ${index + 1}`).trim().slice(0, 80);
  const start = String(item?.start || '').trim().slice(0, 160);
  const end = String(item?.end || '').trim().slice(0, 160);
  if (!start || !end) return null;
  return { name: name || `Route ${index + 1}`, start, end };
}

function normalizeUserSettings(payload) {
  const companyLocation = String(payload?.companyLocation || '').trim().slice(0, 160);
  const homeLocation = String(payload?.homeLocation || '').trim().slice(0, 160);
  const placesRaw = Array.isArray(payload?.frequentPlaces) ? payload.frequentPlaces.slice(0, 4) : [];
  const frequentPlaces = placesRaw.map((p, i) => {
    const name = String(p?.name || '').trim().slice(0, 40);
    const query = String(p?.query || '').trim().slice(0, 160);
    if (!name || !query) return null;
    return { name: name || `Place ${i + 1}`, query };
  }).filter(Boolean);
  const commuteToWorkTime = String(payload?.commuteToWorkTime || '').trim().slice(0, 10);
  const commuteToHomeTime = String(payload?.commuteToHomeTime || '').trim().slice(0, 10);
  const routesRaw = Array.isArray(payload?.frequentRoutes) ? payload.frequentRoutes.slice(0, 3) : [];
  const frequentRoutes = routesRaw.map((r, i) => normalizeRouteItem(r, i)).filter(Boolean);
  const vehiclesRaw = Array.isArray(payload?.vehicles) ? payload.vehicles.slice(0, 3) : [];
  const allowedTypes = new Set(['sedan', 'suv', 'mpv', 'motorcycle']);
  const allowedFuelGrades = new Set(['ron92', 'ron95', 'ron98']);
  const vehicles = vehiclesRaw.map((v, i) => {
    const name = String(v?.name || '').trim().slice(0, 30);
    const vehicleType = allowedTypes.has(String(v?.vehicleType || '').trim()) ? String(v.vehicleType).trim() : 'sedan';
    const fuelGrade = allowedFuelGrades.has(String(v?.fuelGrade || '').trim()) ? String(v.fuelGrade).trim() : 'ron95';
    const consumption = Number(v?.consumption);
    if (!name) return null;
    if (!Number.isFinite(consumption) || consumption < 2 || consumption > 30) return null;
    return {
      name: name || `Vehicle ${i + 1}`,
      vehicleType,
      fuelGrade,
      consumption: Math.round(consumption * 10) / 10
    };
  }).filter(Boolean);
  return {
    companyLocation,
    homeLocation,
    frequentPlaces,
    commuteToWorkTime,
    commuteToHomeTime,
    frequentRoutes,
    vehicles
  };
}

function normalizeUserProfilePayload(payload) {
  const genderRaw = trimText(payload?.gender, 20);
  const allowedGender = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
  const gender = allowedGender.has(genderRaw.toLowerCase()) ? genderRaw.toLowerCase() : '';
  const birthday = trimText(payload?.birthday, 20);
  return {
    bio: trimText(payload?.bio, 1000),
    gender,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : '',
    region: trimText(payload?.region, 120),
    profession: trimText(payload?.profession, 120),
    school: trimText(payload?.school, 160)
  };
}

function normalizeFeedbackPayload(payload) {
  const location = String(payload?.location || '').trim().slice(0, 200);
  const conditionType = String(payload?.conditionType || '').trim().toUpperCase().slice(0, 40);
  const severity = String(payload?.severity || '').trim().toUpperCase().slice(0, 20);
  const comment = String(payload?.comment || '').trim().slice(0, 1000);
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  return {
    location,
    conditionType,
    severity,
    comment,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null
  };
}

function validateFeedbackPayload(feedback) {
  if (!feedback.location) return 'Location is required';
  if (!feedback.comment) return 'Comment is required';
  const allowedTypes = new Set(['CONGESTION', 'ACCIDENT', 'ROAD WORK', 'CLEAR']);
  if (!allowedTypes.has(feedback.conditionType)) return 'Invalid condition type';
  const allowedSeverities = new Set(['LOW', 'MEDIUM', 'HIGH']);
  if (!allowedSeverities.has(feedback.severity)) return 'Invalid severity';
  return null;
}

function toPublicFeedbackRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    location: row.location,
    conditionType: row.condition_type,
    severity: row.severity,
    comment: row.comment,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    createdAt: row.created_at
  };
}

function normalizeHabitRouteCoords(input) {
  if (!Array.isArray(input)) return [];
  return input.map((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      const lat = Number(point[0]);
      const lon = Number(point[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
      return null;
    }
    if (point && typeof point === 'object') {
      const lat = Number(point.lat ?? point.latitude);
      const lon = Number(point.lon ?? point.lng ?? point.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    }
    return null;
  }).filter(Boolean);
}

function normalizeHabitRoutePayload(payload) {
  const coords = normalizeHabitRouteCoords(payload?.coords_json || payload?.coords);
  const routeName = String(payload?.route_name || '').trim().slice(0, 120);
  const fromLabel = String(payload?.from_label || payload?.from || '').trim().slice(0, 160);
  const toLabel = String(payload?.to_label || payload?.to || '').trim().slice(0, 160);
  const distanceM = Number(payload?.distance_m ?? payload?.distanceM ?? 0);
  const linkIdsRaw = Array.isArray(payload?.link_ids) ? payload.link_ids : [];
  const linkIds = linkIdsRaw.map((item) => String(item?.link_id || item || '').trim()).filter(Boolean).slice(0, 500);
  const alertEnabled = Boolean(payload?.alert_enabled);
  const alertStartTime = String(payload?.alert_start_time || '07:30').trim().slice(0, 5);
  const alertEndTime = String(payload?.alert_end_time || '09:00').trim().slice(0, 5);
  return {
    routeName: routeName || `${fromLabel || 'Start'} → ${toLabel || 'Destination'}`,
    fromLabel,
    toLabel,
    coords,
    distanceM: Number.isFinite(distanceM) ? distanceM : 0,
    linkIds,
    alertEnabled,
    alertStartTime,
    alertEndTime
  };
}

function validateHabitRoutePayload(payload) {
  if (!payload.fromLabel) return 'Start location is required';
  if (!payload.toLabel) return 'Destination is required';
  if (!Array.isArray(payload.coords) || payload.coords.length < 2) return 'Route coordinates are required';
  return null;
}

function validateHabitRouteTimes(startTime, endTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return 'Alert time window must use HH:MM format';
  }
  return null;
}

function toPublicHabitRouteRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    route_name: row.route_name,
    from_label: row.from_label,
    to_label: row.to_label,
    coords_json: Array.isArray(row.coords_json) ? row.coords_json : [],
    distance_m: Number(row.distance_m || 0),
    link_ids: Array.isArray(row.link_ids) ? row.link_ids : [],
    alert_enabled: Boolean(row.alert_enabled),
    alert_start_time: row.alert_start_time,
    alert_end_time: row.alert_end_time,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}

function parseTimeValue(timeText) {
  const match = String(timeText || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinAlertWindow(startTime, endTime, now = new Date()) {
  const start = parseTimeValue(startTime);
  const end = parseTimeValue(endTime);
  if (start === null || end === null) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function latLonToMeters(lat, lon, refLat, refLon) {
  const x = (lon - refLon) * 111320 * Math.cos(refLat * Math.PI / 180);
  const y = (lat - refLat) * 110540;
  return { x, y };
}

function pointToSegmentDistanceMeters(point, segA, segB) {
  const refLat = point[0];
  const refLon = point[1];
  const p = { x: 0, y: 0 };
  const a = latLonToMeters(segA[0], segA[1], refLat, refLon);
  const b = latLonToMeters(segB[0], segB[1], refLat, refLon);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-9) return Math.hypot(a.x, a.y);
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(projX - p.x, projY - p.y);
}

function distancePointToPolylineMeters(point, coords) {
  if (!Array.isArray(coords) || coords.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const segA = coords[i];
    const segB = coords[i + 1];
    const d = pointToSegmentDistanceMeters(point, segA, segB);
    if (d < best) best = d;
  }
  return best;
}

function classifyHabitSegment(incidentDistanceM) {
  if (incidentDistanceM <= 180) return { predBand: 2, currentBand: '2', status: 'Heavy Congestion', color: '#ef4444' };
  if (incidentDistanceM <= 450) return { predBand: 4, currentBand: '4', status: 'Moderate Traffic', color: '#eab308' };
  return { predBand: 6, currentBand: '6', status: 'Free Flow', color: '#22c55e' };
}

function buildHabitRouteAnalysis(coords, incidents) {
  const safeCoords = normalizeHabitRouteCoords(coords);
  const safeIncidents = Array.isArray(incidents) ? incidents.filter((item) => Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lon))) : [];
  const segmentMatches = [];
  const matchedLinks = [];

  for (let i = 0; i < safeCoords.length - 1; i += 1) {
    const segA = safeCoords[i];
    const segB = safeCoords[i + 1];
    let nearestIncident = null;
    let nearestDistance = Infinity;
    for (const incident of safeIncidents) {
      const d = pointToSegmentDistanceMeters([Number(incident.lat), Number(incident.lon)], segA, segB);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIncident = incident;
      }
    }

    const segmentId = `habit-seg-${i + 1}`;
    const traffic = classifyHabitSegment(nearestDistance);
    const roadName = nearestIncident && nearestDistance <= 600
      ? `Near ${deriveIncidentArea(nearestIncident.message, nearestIncident.lat, nearestIncident.lon)}`
      : `Route segment ${i + 1}`;

    const segmentMatch = {
      segment_index: i,
      link_id: segmentId,
      road_name: roadName,
      distance_m: Number.isFinite(nearestDistance) ? Math.round(nearestDistance) : null,
      incident_id: nearestIncident?.id || null,
      current_band: traffic.currentBand,
      pred_band: traffic.predBand,
      traffic_status: traffic.status,
      color: traffic.color
    };
    segmentMatches.push(segmentMatch);
    matchedLinks.push({ link_id: segmentId, road_name: roadName });
  }

  return {
    coords: safeCoords,
    match_info: {
      matched_links: matchedLinks,
      segment_matches: segmentMatches
    }
  };
}

module.exports = {
  normalizeRouteItem,
  normalizeUserSettings,
  normalizeUserProfilePayload,
  normalizeFeedbackPayload,
  validateFeedbackPayload,
  toPublicFeedbackRow,
  normalizeHabitRouteCoords,
  normalizeHabitRoutePayload,
  validateHabitRoutePayload,
  validateHabitRouteTimes,
  toPublicHabitRouteRow,
  isWithinAlertWindow,
  distancePointToPolylineMeters,
  buildHabitRouteAnalysis
};
