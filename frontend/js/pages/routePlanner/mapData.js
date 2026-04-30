// Route planner data fetchers, map overlays, geocoding, and endpoint weather popups.
async function fetchCameras() {
  const res = await fetch("/api/cameras?max=4000");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load cameras");
  return (data.value || []).map((cam, i) => ({
    id: cam.CameraID || `cam-${i}`,
    name: cam.Name || `Camera ${i + 1}`,
    source: cam.Source || "Unknown",
    lat: parseFloat(cam.Latitude),
    lon: parseFloat(cam.Longitude),
    imageLink: cam.ImageLink || null,
    hasRealtimeImage: Boolean(cam.HasRealtimeImage && cam.ImageLink)
  })).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
}

async function fetchOneMotoringErpMarkers() {
  const res = await fetch("/api/onemotoring/erp");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load ERP markers");
  return Array.isArray(data.value) ? data.value : [];
}

async function fetchOneMotoringPgsMarkers() {
  const res = await fetch("/api/onemotoring/pgs");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load PGS markers");
  return Array.isArray(data.value) ? data.value : [];
}

async function fetchHotspotMarkers() {
  const res = await window.fastAuthFetch("/api/ml/map-hotspots");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to load hotspots");
  return json.data || [];
}

function formatRateLine(label, value) {
  const safe = String(value || "").trim();
  if (!safe) return "";
  return `<div><strong>${label}: </strong>${escapeHtml(safe)}</div>`;
}

function renderLocalErpRatesTable(localRates) {
  const rows = Array.isArray(localRates) ? localRates : [];
  if (!rows.length) return "";
  return `
      <div style="margin-top:8px;">
        <div style="font-weight:700;margin-bottom:6px;">ERP price bands</div>
        <div style="max-height:180px;overflow:auto;border:1px solid #dbeafe;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;background:#fff;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Time</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.time || "")}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.price || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
}

function drawErpMarkers() {
  if (!state.liveMap || !state.liveErpLayer) return;
  state.liveErpLayer.clearLayers();
  if (!state.mapErpVisible) return;
  (state.mapErpItems || []).forEach((item) => {
    const localRatesHtml = renderLocalErpRatesTable(item.localRates);
    const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "ERP Gantry")}</div>
          ${item.gantryNo ? `<div style="margin-bottom:6px;"><strong>Gantry No: </strong>${escapeHtml(item.gantryNo)}</div>` : ``}
          ${localRatesHtml || ``}
          ${!localRatesHtml ? `<div>Pricing unavailable.</div>` : ``}
        </div>
      `;
    L.marker([item.lat, item.lon], {
      icon: getMapPoiIcon("erp")
    }).bindPopup(popupHtml).addTo(state.liveErpLayer);
  });
}

function drawPgsMarkers() {
  if (!state.liveMap || !state.livePgsLayer) return;
  state.livePgsLayer.clearLayers();
  if (!state.mapPgsVisible) return;
  (state.mapPgsItems || []).forEach((item) => {
    const rates = item.rates || null;
    const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "PGS Car Park")}</div>
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || "PGS Car Park")}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;" />` : ``}
          <div><strong>Available lots: </strong>${escapeHtml(item.availability || "N/A")}</div>
          <div><strong>Updated at: </strong>${escapeHtml(item.availabilityUpdatedAt || "N/A")}</div>
          ${rates ? `
            <hr style="border:none;border-top:1px solid #dbeafe;margin:8px 0;" />
            <div style="font-weight:700;margin-bottom:4px;">Official parking rates</div>
            ${formatRateLine("Weekdays before 5/6pm", rates.weekdayBefore)}
            ${formatRateLine("Weekdays after 5/6pm", rates.weekdayAfter)}
            ${formatRateLine("Saturdays", rates.saturday)}
            ${formatRateLine("Sundays / Public Holidays", rates.sunday)}
          ` : `<div style="margin-top:8px;">Official parking rate data not matched for this location.</div>`}
        </div>
      `;
    L.marker([item.lat, item.lon], {
      icon: getMapPoiIcon("pgs")
    }).bindPopup(popupHtml).addTo(state.livePgsLayer);
  });
}

async function toggleMapErpLayer() {
  if (!state.mapErpItems.length) {
    state.mapErpItems = await fetchOneMotoringErpMarkers();
  }
  state.mapErpVisible = !state.mapErpVisible;
  renderMapErpToggleButton();
  drawErpMarkers();
}

async function toggleMapPgsLayer() {
  if (!state.mapPgsItems.length) {
    state.mapPgsItems = await fetchOneMotoringPgsMarkers();
  }
  state.mapPgsVisible = !state.mapPgsVisible;
  renderMapPgsToggleButton();
  drawPgsMarkers();
}


let allLandmarksCache = null;

async function loadAllLandmarks() {
  if (allLandmarksCache) return allLandmarksCache;

  const res = await window.fastAuthFetch("/api/ml/vms-landmarks");
  if (!res.ok) throw new Error("Failed to load landmarks");

  allLandmarksCache = await res.json();
  return allLandmarksCache;
}

function getExpresswayCodeFromRoadName(roadName) {
  const name = String(roadName || "").toUpperCase();

  const mapping = {
    "PAN ISLAND EXPRESSWAY": "PIE",
    "AYER RAJAH EXPRESSWAY": "AYE",
    "CENTRAL EXPRESSWAY": "CTE",
    "TAMPINES EXPRESSWAY": "TPE",
    "SELETAR EXPRESSWAY": "SLE",
    "KALLANG-PAYA LEBAR EXPRESSWAY": "KPE",
    "BUKIT TIMAH EXPRESSWAY": "BKE",
    "EAST COAST PARKWAY": "ECP",
    "MARINA COASTAL": "MCE",
    "KRANJI EXPRESSWAY": "KJE"
  };

  for (const fullName in mapping) {
    if (name.includes(fullName)) return mapping[fullName];
  }

  return "";
}

function findNearestLandmarkToPoint(lat, lon, landmarks, maxDistanceMeters = 1200) {
  lat = Number(lat);
  lon = Number(lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Array.isArray(landmarks) || !landmarks.length) return null;

  let best = null;
  let bestDistance = Infinity;

  landmarks.forEach(lm => {
    const lmLat = Number(lm.lat);
    const lmLon = Number(lm.lon);

    if (!Number.isFinite(lmLat) || !Number.isFinite(lmLon)) return;

    const d = distanceMeters(lat, lon, lmLat, lmLon);

    if (d < bestDistance) {
      bestDistance = d;
      best = lm;
    }
  });

  if (!best || bestDistance > maxDistanceMeters) return null;

  return {
    label: best.label || best.landmark_name || "Nearby landmark",
    distance_m: Math.round(bestDistance)
  };
}

function buildHotspotDisplayName(item, nearest) {
  const code = getExpresswayCodeFromRoadName(item.road_name);

  if (nearest?.label) {
    return code
      ? `${code} near ${nearest.label}`
      : `${item.road_name || "Road"} near ${nearest.label}`;
  }

  return item.road_name || "Unknown Road";
}
async function drawHotspotMarkers() {
  if (!state.liveMap || !state.liveHotspotsLayer) return;

  state.liveHotspotsLayer.clearLayers();

  if (!state.mapHotspotsVisible) return;

  let landmarks = [];

  try {
    landmarks = await loadAllLandmarks();
  } catch (err) {
    console.warn("Landmarks unavailable for hotspots:", err);
  }

  (state.mapHotspotsItems || []).forEach((item) => {
    const accidents = Number(item.accidents || 0);
    const breakdowns = Number(item.breakdowns || 0);
    const totalIncidents = accidents + breakdowns;

    let color = "#f97316";
    let label = "MODERATE FREQUENCY";

    if (totalIncidents >= 15) {
      color = "#ef4444";
      label = "HIGH FREQUENCY";
    }

    const nearest = findNearestLandmarkToPoint(
      item.mid_lat,
      item.mid_lon,
      landmarks,
      1200
    );

    const displayName = buildHotspotDisplayName(item, nearest);

    const popupHtml = `
      <div class="hotspot-popup">
        <div class="hotspot-popup-kicker ${totalIncidents >= 15 ? "high" : "moderate"}">
          ${label} ZONE
        </div>

        <div class="hotspot-popup-title">
          ${escapeHtml(displayName)}
        </div>

        ${nearest ? `
          <div class="hotspot-popup-subtitle">
            Nearest landmark · ${escapeHtml(nearest.label)} (${nearest.distance_m}m)
          </div>
        ` : ""}

        <div class="hotspot-popup-divider"></div>

        <div class="hotspot-popup-row">
          <span>Accidents</span>
          <strong>${accidents || 0}</strong>
        </div>

        <div class="hotspot-popup-row">
          <span>Breakdowns</span>
          <strong>${breakdowns || 0}</strong>
        </div>

        <div class="hotspot-popup-note">
          Frequent incident activity recorded near this stretch.
        </div>
      </div>
    `;

    const hotspotIcon = L.divIcon({
      html: `
        <div style="
          width: 10px; 
          height: 10px; 
          background-color: ${color}; 
          border: 1.5px solid white; 
          border-radius: 50%; 
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
        "></div>
      `,
      className: "",
      iconSize: [13, 13],
      iconAnchor: [6, 6]
    });

    L.marker([item.mid_lat, item.mid_lon], { icon: hotspotIcon })
      .bindPopup(popupHtml)
      .addTo(state.liveHotspotsLayer);
  });
}
// 地理编码：支持邮编/地名/MRT（后端做多源解析）
async function geocodeLocation(inputText) {
  const r = await fetch(`/api/geocode?q=${encodeURIComponent(inputText)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Geocode failed");
  return {
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    display: d.display || inputText,
    postal: d.postal || "",
    address: d.address || d.display || inputText
  };
}

async function reverseGeocodeLocation(lat, lon) {
  const r = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Reverse geocode failed");
  return {
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    display: d.display || "Current Location",
    postal: d.postal || "",
    address: d.address || d.display || "Current Location"
  };
}

async function getRouteEndpointWeather(lat, lon) {
  const r = await fetch(`/api/weather/current?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Weather fetch failed");
  return d;
}

function formatWeatherLabel(desc) {
  return String(desc || "--").split(" ").map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "").join(" ");
}

async function buildRouteEndpointPopupHtml(label, fallbackGeo) {
  const lat = Number(fallbackGeo?.lat);
  const lon = Number(fallbackGeo?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return `<div style="font-size:12px;max-width:260px;"><strong>${escapeHtml(label)}</strong></div>`;
  }
  const [place, weather] = await Promise.all([
    reverseGeocodeLocation(lat, lon).catch(() => ({
      display: fallbackGeo?.display || label,
      postal: fallbackGeo?.postal || "",
      address: fallbackGeo?.address || fallbackGeo?.display || label
    })),
    getRouteEndpointWeather(lat, lon).catch(() => null)
  ]);
  const rawTitle = String(place.display || fallbackGeo?.display || label).trim();
  const rawAddress = String(place.address || fallbackGeo?.address || "").trim();
  let title = rawTitle;
  if (label === "Start" && String(fallbackGeo?.display || "").trim() === "Current Location") {
    let locationName = rawTitle;
    if (!locationName || locationName.toLowerCase() === "current location") {
      const firstAddressPart = rawAddress ? rawAddress.split(",")[0].trim() : "";
      locationName = firstAddressPart || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
    title = `Current Location: ${locationName}`;
  }
  const postal = place.postal || fallbackGeo?.postal || "";
  const weatherText = weather ? `${weather.temp}°C · ${formatWeatherLabel(weather.desc)}` : "Weather unavailable";
  return `
      <div style="font-size:12px;max-width:280px;line-height:1.5;">
        <div><strong>${escapeHtml(label)}</strong></div>
        <div><strong>Name: </strong>${escapeHtml(title)}</div>
        ${postal ? `<div><strong>Postal Code: </strong>${escapeHtml(postal)}</div>` : ""}
        <div><strong>Weather: </strong>${escapeHtml(weatherText)}</div>
      </div>
    `;
}
