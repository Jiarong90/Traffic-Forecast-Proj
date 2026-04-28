// Map View rendering, layer toggles, and feedback markers.

// 懒加载初始化两张地图：实时地图 + 规划地图
function ensureMaps() {
  const MAP_DEFAULT_ZOOM = 12;
  const MAP_MIN_ZOOM = 12;
  const SG_BOUNDS = L.latLngBounds(
    [1.15, 103.55],
    [1.50, 104.15]
  );
  if (!state.liveMap && document.getElementById("liveMap")) {
    state.liveMap = L.map("liveMap", {
      center: SG_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      zoomControl: false,
      preferCanvas: true
    });
    L.control.zoom({ position: "bottomright" }).addTo(state.liveMap);
    L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
      attribution: "&copy; OneMap Singapore",
      maxZoom: 18,
      minZoom: MAP_MIN_ZOOM
    }).addTo(state.liveMap);
    state.liveLayer = L.layerGroup().addTo(state.liveMap);
    state.liveIncidentLayer = L.layerGroup().addTo(state.liveMap);
    state.liveErpLayer = L.layerGroup().addTo(state.liveMap);
    state.livePgsLayer = L.layerGroup().addTo(state.liveMap);
    state.feedbackMapLayer = L.layerGroup().addTo(state.liveMap);
  }

  if (!state.plannerMap && document.getElementById("plannerMap")) {
    state.plannerMap = L.map("plannerMap", {
      center: SG_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      maxBounds: SG_BOUNDS,
      zoomControl: false,
      preferCanvas: true
    });
    L.control.zoom({ position: "bottomright" }).addTo(state.plannerMap);
    L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
      attribution: "&copy; OneMap Singapore",
      maxZoom: 18,
      minZoom: MAP_MIN_ZOOM
    }).addTo(state.plannerMap);
    state.plannerLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeFeedbackLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeConfirmProgressLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeConfirmMarkerLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeConfirmPoiLayer = L.layerGroup().addTo(state.plannerMap);
    state.routeNearestCameraLayer = L.layerGroup().addTo(state.plannerMap);
  }

  // For Habit Routes add-on
  if (!state.habitRoutesMap && document.getElementById("habitRoutesMap")) {
    state.habitRoutesMap = L.map("habitRoutesMap", {
      center: SG_CENTER,
      zoom: 11,
      zoomControl: false,
      preferCanvas: true
    });

    L.control.zoom({ position: "bottomright" }).addTo(state.habitRoutesMap);

    L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png", {
      attribution: "&copy; OneMap Singapore",
      maxZoom: 18,
      minZoom: 10
    }).addTo(state.habitRoutesMap);

    state.habitRoutesBaseLayer = L.layerGroup().addTo(state.plannerMap);
    state.habitRoutePolylineLayer = L.layerGroup().addTo(state.plannerMap);
    state.habitRoutePinLayer = L.layerGroup().addTo(state.plannerMap);
    state.previewDetourLayer = L.featureGroup().addTo(state.plannerMap);
    state.expresswayLayerGroup = L.layerGroup().addTo(state.liveMap);
    state.currentImpactLayer = L.layerGroup().addTo(state.liveMap);
    state.incidentMarkerLayer = L.layerGroup().addTo(state.plannerMap);

    // Hotspots
    state.liveHotspotsLayer = L.layerGroup().addTo(state.liveMap);
  }
}

// 地图点击摄像头后的弹窗展示（名称、来源、实时图）
function openLiveCamera(c) {
  if (!state.liveMap) return;
  const content = `
      <div style="font-size:12px;max-width:260px;">
        <strong>${c.name}</strong><br/>
        <span>${c.source}</span><br/>
        ${c.imageLink ? `<img src="${c.imageLink}" alt="${c.name}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
      </div>
    `;
  L.popup().setLatLng([c.lat, c.lon]).setContent(content).openOn(state.liveMap);
  state.liveMap.setView([c.lat, c.lon], Math.max(state.liveMap.getZoom(), 14));
}

// Map View 主渲染：左侧列表 + 右侧地图点位保持同一数据源
function renderLiveMapAndList() {
  if (!state.liveMap || !state.liveLayer) return;
  state.liveLayer.clearLayers();
  const sidebar = document.querySelector("#map-view .sidebar.active-reports");
  const reportList = document.getElementById("camera-report-list");
  const liveCount = document.getElementById("map-live-count");
  if (!state.mapCamerasVisible) {
    if (sidebar) sidebar.classList.add("hidden");
    if (reportList) reportList.innerHTML = "";
    if (liveCount) liveCount.textContent = "0";
    return;
  }
  if (sidebar) sidebar.classList.remove("hidden");
  const realtime = state.cameras.filter(c => c.hasRealtimeImage);
  const mapPoints = realtime.slice(0, 90);
  const list = realtime.slice(0, 90);

  mapPoints.forEach((c) => {
    const marker = L.marker([c.lat, c.lon], {
      icon: getMapPoiIcon("camera")
    }).addTo(state.liveLayer);
    marker.on("click", () => openLiveCamera(c));
  });

  if (reportList) {
    reportList.innerHTML = list.map((c, i) => `
        <div class="report-card ${i % 3 === 0 ? "accident" : i % 3 === 1 ? "roadwork" : "breakdown"}" data-camera-id="${c.id}">
          <span class="report-icon ${i % 3 === 0 ? "accident" : i % 3 === 1 ? "roadwork" : "breakdown"}"></span>
          <div class="report-body">
            <span class="report-type">LIVE CAMERA</span>
            <p>${c.name}</p>
            <span class="report-time">${c.source}</span>
          </div>
          <span class="severity-tag ${i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low"}">${i % 3 === 0 ? "HIGH" : i % 3 === 1 ? "MEDIUM" : "LOW"}</span>
        </div>
      `).join("");
    reportList.querySelectorAll(".report-card").forEach((card) => {
      card.addEventListener("click", () => {
        const cam = list.find(x => x.id === card.getAttribute("data-camera-id"));
        if (cam) openLiveCamera(cam);
      });
    });
  }

  if (liveCount) liveCount.textContent = String(mapPoints.length);
}

function renderMapCameraToggleButton() {
  const btn = document.getElementById("map-toggle-cameras-btn");
  if (!btn) return;
  btn.innerHTML = state.mapCamerasVisible
    ? `<span class="dot red"></span> HIDE LIVE MONITORING`
    : `<span class="dot red"></span> SHOW LIVE MONITORING`;
}

function toggleMapCamerasVisibility() {
  state.mapCamerasVisible = !state.mapCamerasVisible;
  renderMapCameraToggleButton();
  renderLiveMapAndList();
}

// 实时事故显示开关按钮文案同步
function renderMapIncidentToggleButton() {
  const btn = document.getElementById("map-toggle-incidents-btn");
  if (!btn) return;
  btn.innerHTML = state.mapIncidentsVisible
    ? `<span class="icon-warning red"></span> HIDE LTA INCIDENTS`
    : `<span class="icon-warning red"></span> SHOW LTA INCIDENTS`;
}

function renderMapFeedbackToggleButton() {
  const btn = document.getElementById("map-toggle-feedback-btn");
  if (!btn) return;
  btn.classList.remove("hidden");
  btn.innerHTML = state.feedbackMapVisible
    ? `<span class="icon-pin"></span> HIDE USER FEEDBACK`
    : `<span class="icon-pin"></span> SHOW USER FEEDBACK`;
}

function renderMapErpToggleButton() {
  const btn = document.getElementById("map-toggle-erp-btn");
  if (!btn) return;
  btn.innerHTML = state.mapErpVisible
    ? `<span class="icon-info"></span> HIDE ERP`
    : `<span class="icon-info"></span> SHOW ERP`;
}

function renderMapPgsToggleButton() {
  const btn = document.getElementById("map-toggle-pgs-btn");
  if (!btn) return;
  btn.innerHTML = state.mapPgsVisible
    ? `<span class="icon-pin"></span> HIDE PGS`
    : `<span class="icon-pin"></span> SHOW PGS`;
}

function renderMapHotspotsToggleButton() {
  const btn = document.getElementById("map-toggle-hotspots-btn");
  if (!btn) return;
  btn.innerHTML = state.mapHotspotsVisible
    ? `<span class="icon-warning"></span> HIDE HOTSPOTS`
    : `<span class="icon-warning"></span> SHOW HOTSPOTS`;
}

// 在 Map View 绘制 LTA 实时事故点
function drawLiveIncidentMarkers(incidents) {
  if (!state.liveIncidentLayer) return;
  state.liveIncidentLayer.clearLayers();
  (incidents || []).forEach((it) => {
    const lat = Number(it?.lat);
    const lon = Number(it?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const marker = L.marker([lat, lon], {
      icon: getMapPoiIcon("incident")
    }).addTo(state.liveIncidentLayer);
    const popupHtml = `
        <div style="font-size:12px;max-width:280px;">
          <div><strong>Incident Type: </strong>${escapeHtml(it.type || "Traffic incident")}</div>
          <div><strong>Location: </strong>${escapeHtml(it.area || "Unknown")}</div>
          <div><strong>Elapsed Time: </strong>${escapeHtml(getIncidentElapsedText(it))}</div>
          <div><strong>Estimated Clear Time: </strong>${escapeHtml(getIncidentEstimatedClearText(it))}</div>
          <div><strong>Estimated Impact Time: </strong>${escapeHtml(getIncidentDurationText(it))}</div>
        </div>
      `;
    marker.bindPopup(popupHtml, { maxWidth: 300 });
    marker.on("click", function () { openIncidentMlPanel(it); });
  });
}


// 拉取地图事故数据（用于地图点位，不带复杂详情）
async function fetchLiveIncidentsForMap() {
  const resp = await fetch("/api/incidents?source=live&withImagesOnly=0&max=120");
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Failed to load live incidents");
  return data.value || [];
}

// 显示/隐藏地图事故图层
async function toggleMapIncidentsLayer() {
  if (!state.liveIncidentLayer) return;
  if (state.mapIncidentsVisible) {
    state.mapIncidentsVisible = false;
    state.liveIncidentLayer.clearLayers();
    if (state.mapIncidentElapsedTimer) {
      clearInterval(state.mapIncidentElapsedTimer);
      state.mapIncidentElapsedTimer = null;
    }
    renderMapIncidentToggleButton();
    return;
  }
  const incidents = await fetchLiveIncidentsForMap();
  state.mapLiveIncidents = incidents;
  state.mapIncidentsVisible = true;
  drawLiveIncidentMarkers(incidents);
  if (state.mapIncidentElapsedTimer) clearInterval(state.mapIncidentElapsedTimer);
  state.mapIncidentElapsedTimer = setInterval(() => {
    if (!state.mapIncidentsVisible) return;
    drawLiveIncidentMarkers(state.mapLiveIncidents);
  }, 60 * 1000);
  renderMapIncidentToggleButton();
}

function getFeedbackMarkerColor(item) {
  const severity = String(item?.severity || "").toUpperCase();
  if (severity === "HIGH") return "#ef4444";
  if (severity === "MEDIUM") return "#f59e0b";
  if (severity === "LOW") return "#22c55e";
  return "#2563eb";
}

async function loadFeedbackMapItems() {
  const auth = window.getFastAuth ? window.getFastAuth() : null;
  if (!auth || !auth.token) {
    state.feedbackMapItems = [];
    return [];
  }
  const resp = await window.fastAuthFetch("/api/feedback/locations?limit=300");
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "Failed to load feedback locations");
  state.feedbackMapItems = Array.isArray(data.value) ? data.value : [];
  return state.feedbackMapItems;
}

function drawFeedbackMapMarkers() {
  if (!state.feedbackMapLayer) return;
  state.feedbackMapLayer.clearLayers();
  if (!state.feedbackMapVisible) return;
  const items = (Array.isArray(state.feedbackMapItems) ? state.feedbackMapItems : [])
    .filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)));
  items.forEach((item) => {
    const color = getFeedbackMarkerColor(item);
    const marker = L.circleMarker([Number(item.latitude), Number(item.longitude)], {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: color,
      fillOpacity: 0.95
    }).addTo(state.feedbackMapLayer);
    marker.bindPopup(`
        <div style="font-size:12px;max-width:300px;">
          <div><strong>Submitted:</strong> ${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
          <div><strong>Location:</strong> ${escapeHtml(item.location || "-")}</div>
          <div><strong>Type:</strong> ${escapeHtml(item.conditionType || "-")}</div>
          <div><strong>Severity:</strong> ${escapeHtml(item.severity || "-")}</div>
          <div><strong>Feedback:</strong> ${escapeHtml(item.comment || "-")}</div>
        </div>
      `);
  });
}

async function refreshFeedbackMapLayer() {
  if (!state.feedbackMapVisible) return;
  await loadFeedbackMapItems();
  drawFeedbackMapMarkers();
}

async function toggleFeedbackMapLayer() {
  const auth = window.getFastAuth ? window.getFastAuth() : null;
  if (!auth || !auth.token) {
    window.location.hash = "login";
    return;
  }
  state.feedbackMapVisible = !state.feedbackMapVisible;
  if (state.feedbackMapVisible) {
    await loadFeedbackMapItems();
  } else if (state.feedbackMapLayer) {
    state.feedbackMapLayer.clearLayers();
  }
  drawFeedbackMapMarkers();
  renderMapFeedbackToggleButton();
}
