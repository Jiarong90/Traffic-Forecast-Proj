// Route planner live navigation, route feedback, and route camera markers.
  function renderRouteCameraToggleButton() {
    const btn = document.getElementById("route-view-cameras-btn");
    if (!btn) return;
    btn.textContent = state.routeNearestCameraVisible ? "HIDE LIVE CAMERA" : "VIEW LIVE CAMERAS";
  }

  function getNearestRealtimeCameraForLiveLocation() {
    const liveLoc = state.confirmedLastLiveCoord || (state.userLocation && Number.isFinite(state.userLocation.lat) && Number.isFinite(state.userLocation.lon)
      ? { lat: state.userLocation.lat, lon: state.userLocation.lon }
      : null);
    if (!liveLoc) return null;
    let best = null;
    let bestDistance = Infinity;
    (state.cameras || []).forEach((cam) => {
      if (!cam.hasRealtimeImage) return;
      const d = haversine(liveLoc.lat, liveLoc.lon, cam.lat, cam.lon);
      if (d < bestDistance) {
        bestDistance = d;
        best = cam;
      }
    });
    if (!best) return null;
    return { camera: best, distanceMeters: bestDistance, liveLoc };
  }

  function toggleRouteNearestLiveCamera() {
    if (!state.routeNearestCameraLayer) return;
    if (state.routeNearestCameraVisible) {
      state.routeNearestCameraLayer.clearLayers();
      state.routeNearestCameraVisible = false;
      renderRouteCameraToggleButton();
      return;
    }
    const nearest = getNearestRealtimeCameraForLiveLocation();
    if (!nearest) {
      alert("No nearby live camera found for your current location.");
      return;
    }
    const cam = nearest.camera;
    state.routeNearestCameraLayer.clearLayers();
    const marker = L.marker([cam.lat, cam.lon], {
      icon: getMapPoiIcon("camera")
    }).addTo(state.routeNearestCameraLayer);
    marker.bindPopup(`
      <div style="font-size:12px;max-width:260px;">
        <strong>${escapeHtml(cam.name)}</strong><br/>
        <span>${escapeHtml(cam.source || "Unknown source")}</span><br/>
        <span>Distance from live location: ${Math.round(nearest.distanceMeters)} m</span><br/>
        ${cam.imageLink ? `<img src="${escapeHtml(cam.imageLink)}" alt="${escapeHtml(cam.name)}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
      </div>
    `).openPopup();
    if (state.plannerMap) {
      state.plannerMap.flyTo([cam.lat, cam.lon], Math.max(state.plannerMap.getZoom(), 14), { duration: 0.8 });
    }
    state.routeNearestCameraVisible = true;
    renderRouteCameraToggleButton();
  }

  function getRouteFeedbackColor(item) {
    const severity = String(item?.severity || "").toUpperCase();
    if (severity === "HIGH") return "#ef4444";
    if (severity === "MEDIUM") return "#f59e0b";
    if (severity === "LOW") return "#22c55e";
    return "#2563eb";
  }

  async function loadRouteFeedbackItems() {
    const auth = window.getFastAuth ? window.getFastAuth() : null;
    if (!auth || !auth.token) {
      state.routeFeedbackItems = [];
      state.routeFeedbackLoadedAt = 0;
      return [];
    }
    const now = Date.now();
    if (Array.isArray(state.routeFeedbackItems) && state.routeFeedbackItems.length && now - Number(state.routeFeedbackLoadedAt || 0) < 30000) {
      return state.routeFeedbackItems;
    }
    const resp = await window.fastAuthFetch("/api/feedback/locations?limit=300");
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to load route feedback points");
    state.routeFeedbackItems = Array.isArray(data.value) ? data.value : [];
    state.routeFeedbackLoadedAt = now;
    return state.routeFeedbackItems;
  }

  function getActiveRouteForFeedback() {
    return state.confirmedRoutePlan
      || state.routePlans.find((r) => r.id === state.selectedRouteId)
      || state.routePlans[0]
      || null;
  }

  function drawRouteFeedbackMarkers(route) {
    if (!state.routeFeedbackLayer) return;
    state.routeFeedbackLayer.clearLayers();
    if (!route || !Array.isArray(route.coords) || route.coords.length < 2) return;
    const matches = (Array.isArray(state.routeFeedbackItems) ? state.routeFeedbackItems : [])
      .filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
      .filter((item) => distanceToRouteMeters(route.coords, Number(item.latitude), Number(item.longitude)) <= 250);
    matches.forEach((item) => {
      const marker = L.circleMarker([Number(item.latitude), Number(item.longitude)], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: getRouteFeedbackColor(item),
        fillOpacity: 0.96
      }).addTo(state.routeFeedbackLayer);
      marker.bringToFront();
      marker.bindPopup(`
        <div style="font-size:12px;max-width:300px;">
          <div><strong>User Feedback</strong></div>
          <div><strong>Submitted:</strong> ${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
          <div><strong>Location:</strong> ${escapeHtml(item.location || "-")}</div>
          <div><strong>Type:</strong> ${escapeHtml(item.conditionType || "-")}</div>
          <div><strong>Severity:</strong> ${escapeHtml(item.severity || "-")}</div>
          <div><strong>Comment:</strong> ${escapeHtml(item.comment || "-")}</div>
        </div>
      `);
    });
  }

  async function refreshRouteFeedbackMarkersForSelectedRoute() {
    if (!state.routeFeedbackLayer) return;
    const route = getActiveRouteForFeedback();
    state.routeFeedbackLayer.clearLayers();
    if (!route) return;
    try {
      await loadRouteFeedbackItems();
      drawRouteFeedbackMarkers(route);
    } catch (err) {
      console.error("Failed to refresh route feedback markers:", err);
      state.routeFeedbackLayer.clearLayers();
    }
  }
  window.refreshRouteFeedbackMarkersForSelectedRoute = refreshRouteFeedbackMarkersForSelectedRoute;

  function redrawConfirmedRouteProgress(lat, lon) {
    if (!state.routeConfirmProgressLayer || !state.confirmedRoutePlan) return { offRoute: false };
    state.routeConfirmProgressLayer.clearLayers();
    const route = state.confirmedRoutePlan;
    const progress = splitRouteProgress(route.coords, lat, lon);
    if (progress.remaining.length >= 2) {
      L.polyline(progress.remaining, {
        color: route.color || ROUTE_COLORS[route.id] || "#2563eb",
        weight: 6,
        opacity: 0.95
      }).addTo(state.routeConfirmProgressLayer);
    }
    if (progress.travelled.length >= 2) {
      L.polyline(progress.travelled, {
        color: "#94a3b8",
        weight: 6,
        opacity: 0.95
      }).addTo(state.routeConfirmProgressLayer);
    }
    return { offRoute: Number(progress.distanceToRoute) > 90 };
  }

  async function recalculateConfirmedRouteFromLiveLocation(lat, lon) {
    if (!state.confirmedRouteEndGeo) return;
    const now = Date.now();
    if (now - state.confirmedRouteLastReplanAt < 6000) return;
    state.confirmedRouteLastReplanAt = now;
    const hintEl = document.getElementById("route-planning-hint");

    const liveStartGeo = { lat, lon, display: "Current Location" };
    const endGeo = state.confirmedRouteEndGeo;
    const userLoc = { lat, lon };
    const plans = await fetchRoutePlansFromPython(liveStartGeo, endGeo, 0.03);
    if (!plans.length) throw new Error("No valid route plan generated during rerouting.");

    const realtimeCameras = state.cameras.filter((c) => c.hasRealtimeImage);
    const liveRouteEvents = mapLiveIncidentsToRouteEvents(state.dashboardIncidents);
    const defaultRoute = plans.find((r) => r.id === "fastest") || plans[0];
    const baseCoords = getRouteCoords(defaultRoute, liveStartGeo, endGeo);
    const relevantEvents = await analyzeEventsViaBackend(liveRouteEvents, userLoc, baseCoords);
    const eventsWithCameras = attachEventCameras(relevantEvents, realtimeCameras);
    const evaluation = await evaluateRoutesByEventsViaBackend(plans, eventsWithCameras);
    const currentFastestId = evaluation.currentFastestId || deriveCurrentFastestId(plans, evaluation) || plans[0].id;

    state.routePlans = plans;
    state.routeContext = {
      userLoc,
      events: eventsWithCameras,
      evaluation,
      startGeo: liveStartGeo,
      endGeo,
      currentFastestId,
      generatedAt: new Date().toISOString()
    };
    state.selectedRouteId = evaluation.recommendedRouteId || getPreferredRouteId() || plans[0].id;
    drawRoutes(liveStartGeo, endGeo, { preserveView: true });
    applyRoutePreferenceSelection();
    renderRouteCards();
    const newSelected = state.routePlans.find((r) => r.id === state.selectedRouteId) || state.routePlans[0];
    state.confirmedRouteId = newSelected.id;
    state.confirmedRoutePlan = newSelected;
    renderConfirmedRouteContextPoints(newSelected);
    redrawConfirmedRouteProgress(lat, lon);
    await refreshRouteFeedbackMarkersForSelectedRoute();
    showRouteDetails(newSelected);
    if (hintEl) hintEl.textContent = "You left the planned route. Navigation has been recalculated from your live location.";
  }

  function updateConfirmedLiveMarker(lat, lon) {
    if (!state.routeConfirmMarkerLayer || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    state.userLocation = { lat: lat, lon: lon };
    const last = state.confirmedLastLiveCoord;
    if (!last || haversine(last.lat, last.lon, lat, lon) > 8) {
      state.confirmedTravelledCoords.push([lat, lon]);
      state.confirmedLastLiveCoord = { lat, lon };
    }
    if (!state.routeLiveMarker) {
      state.routeLiveMarker = L.circleMarker([lat, lon], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1
      }).bindPopup("Current Location").addTo(state.routeConfirmMarkerLayer);
      return;
    }
    state.routeLiveMarker.setLatLng([lat, lon]);
    const progressState = redrawConfirmedRouteProgress(lat, lon);
    if (progressState.offRoute && state.confirmedRouteEndGeo) {
      recalculateConfirmedRouteFromLiveLocation(lat, lon).catch((err) => {
        console.error("Route replanning failed:", err);
      });
    }
  }

  function startConfirmedRouteTracking() {
    let mobileMissCount = 0;
    if (state.mobileLocationPollId != null) {
      clearInterval(state.mobileLocationPollId);
      state.mobileLocationPollId = null;
    }
    if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(state.routeLiveWatchId);
      state.routeLiveWatchId = null;
    }

    function ensureBrowserFallbackWatch() {
      if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
      if (state.routeLiveWatchId != null) return;
      state.routeLiveWatchId = navigator.geolocation.watchPosition(
        function (pos) {
          updateConfirmedLiveMarker(Number(pos.coords.latitude), Number(pos.coords.longitude));
        },
        function (err) {
          console.error("Live route tracking failed:", err);
        },
        { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
      );
    }

    function stopBrowserFallbackWatch() {
      if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
        navigator.geolocation.clearWatch(state.routeLiveWatchId);
      }
      state.routeLiveWatchId = null;
    }

    state.mobileLocationPollId = setInterval(async () => {
      try {
        const mobileLoc = await fetchLatestMobileLocation();
        if (mobileLoc) {
          mobileMissCount = 0;
          stopBrowserFallbackWatch();
          updateConfirmedLiveMarker(Number(mobileLoc.lat), Number(mobileLoc.lon));
        } else {
          mobileMissCount += 1;
          if (mobileMissCount >= 15) ensureBrowserFallbackWatch();
        }
      } catch (err) {
        console.error("Mobile location polling failed:", err);
        mobileMissCount += 1;
        if (mobileMissCount >= 15) ensureBrowserFallbackWatch();
      }
    }, 1000);
  }

  function renderConfirmedRouteContextPoints(route) {
    if (!route || !state.routeConfirmPoiLayer) return;
    state.routeConfirmPoiLayer.clearLayers();

    const relatedCameras = (state.cameras || [])
      .filter((cam) => cam.hasRealtimeImage && distanceToRouteMeters(route.coords, cam.lat, cam.lon) <= 250)
      .slice(0, 18);

    relatedCameras.forEach((cam) => {
      L.marker([cam.lat, cam.lon], {
        icon: getMapPoiIcon("camera")
      })
        .bindPopup(`
          <div style="font-size:12px;max-width:260px;">
            <strong>${escapeHtml(cam.name)}</strong><br/>
            <span>${escapeHtml(cam.source || "Unknown source")}</span><br/>
            ${cam.imageLink ? `<img src="${escapeHtml(cam.imageLink)}" alt="${escapeHtml(cam.name)}" style="margin-top:6px;width:100%;border-radius:6px;" />` : "No realtime image"}
          </div>
        `)
        .addTo(state.routeConfirmPoiLayer);
    });

    const relatedEvents = (state.routeContext?.events || [])
      .filter((evt) => distanceToRouteMeters(route.coords, evt.lat, evt.lon) <= 350);

    relatedEvents.forEach((evt) => {
      const createdAt = evt.createdAt || new Date().toISOString();
      L.marker([evt.lat, evt.lon], {
        icon: getMapPoiIcon("incident")
      })
        .bindPopup(`
          <div style="font-size:12px;max-width:280px;">
            <div><strong>Incident Type: </strong>${escapeHtml(evt.label || evt.type || "Traffic incident")}</div>
            <div><strong>Location: </strong>${escapeHtml(evt.area || evt.message || "Along active route")}</div>
            <div><strong>Elapsed Time: </strong>${escapeHtml(getIncidentElapsedText({ message: evt.message, area: evt.area, createdAt: createdAt }))}</div>
            <div><strong>Estimated Clear Time: </strong>${escapeHtml(getIncidentEstimatedClearText({ message: evt.message, area: evt.area, createdAt: createdAt, estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)), estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)) }))}</div>
            <div><strong>Estimated Impact Time: </strong>${escapeHtml(getIncidentDurationText({ estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)), estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)) }))}</div>
          </div>
        `)
        .addTo(state.routeConfirmPoiLayer);
    });
  }

  async function confirmSelectedRouteUsage() {
    const route = state.routePlans.find((r) => r.id === state.selectedRouteId) || state.routePlans[0];
    const startGeo = state.routeContext?.startGeo;
    const endGeo = state.routeContext?.endGeo;
    const hintEl = document.getElementById("route-planning-hint");
    if (!route || !startGeo || !endGeo || !state.routeConfirmMarkerLayer) return;

    clearConfirmedRouteTracking();
    state.confirmedRouteId = route.id;
    state.confirmedRoutePlan = route;
    state.confirmedRouteOriginalStartGeo = startGeo;
    state.confirmedRouteEndGeo = endGeo;
    state.confirmedTravelledCoords = [[startGeo.lat, startGeo.lon]];
    state.confirmedLastLiveCoord = { lat: startGeo.lat, lon: startGeo.lon };

    const pinIcon = (label, bg) => L.divIcon({
      className: "route-pin-icon-wrap",
      html: `<div class="route-pin-icon" style="background:${bg}"><span>${label}</span></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -24]
    });

    const [startPopupHtml, endPopupHtml] = await Promise.all([
      buildRouteEndpointPopupHtml("Start", startGeo),
      buildRouteEndpointPopupHtml("Destination", endGeo)
    ]);

    L.marker([startGeo.lat, startGeo.lon], { icon: pinIcon("S", "#2563eb") })
      .bindPopup(startPopupHtml)
      .addTo(state.routeConfirmMarkerLayer);
    L.marker([endGeo.lat, endGeo.lon], { icon: pinIcon("D", "#10b981") })
      .bindPopup(endPopupHtml)
      .addTo(state.routeConfirmMarkerLayer);

    renderConfirmedRouteContextPoints(route);
    if (Array.isArray(route.coords) && route.coords.length >= 2) {
      redrawConfirmedRouteProgress(route.coords[0][0], route.coords[0][1]);
    }
    await refreshRouteFeedbackMarkersForSelectedRoute();

    try {
      const loc = await getUserLocation();
      if (loc) updateConfirmedLiveMarker(Number(loc.lat), Number(loc.lon));
    } catch (err) {
      console.error(err);
    }
    startConfirmedRouteTracking();
    renderRouteCameraToggleButton();
    if (hintEl) hintEl.textContent = "Navigation started. Start and destination are pinned. The red dot follows your live location.";
    showRouteDetails(route);
  }
