// Route Planner detail panel and confirmed route cleanup.

  // 右侧路线详情面板（普通规划）
  async function showRouteDetails(route) {
    if (!route) return;

    // + Route Analysis 
    state.currSelectedRoute = route;
    const analysisData = await drawHabitRouteOnMap(route);
    const summary = analysisData ? analysisData.summary : null;


    const eva = state.routeContext?.evaluation?.evaluations?.get(route.id) || { eventDelayMin: 0, hitCount: 0 };
    const currentFastestId = state.routeContext?.currentFastestId || null;
    const nearbyCameras = (state.routeContext?.events || []).filter(e => distanceToRouteMeters(route.coords, e.lat, e.lon) <= 350).reduce((sum, e) => sum + (e.cameras?.length ? 1 : 0), 0);
    const totalMinutes = summary ? summary.curr_eta : (route.estMinutes + eva.eventDelayMin * 0.7);
    const trafficLevel = eva.eventDelayMin > 18 ? "Heavy" : eva.eventDelayMin > 8 ? "Moderate" : "Light";


    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const title = route.id === currentFastestId ? "FASTEST NOW" : (ROUTE_LABELS[route.id] || route.id.toUpperCase());
    setText("route-detail-title", title);
    setText("route-detail-time", `${Math.round(totalMinutes)} mins`);
    setText("route-detail-distance", `${(route.totalDist / 1000).toFixed(1)} km`);
    setText("route-detail-delay", `+${Math.round(eva.eventDelayMin)} mins`);
    setText("route-detail-lights", `${route.trafficLights} signals`);
    setText("route-detail-type", route.id === "fastest" ? "Expressway priority" : route.id === "fewerLights" ? "Intersection-light avoidance" : "Balanced urban route");
    setText("route-detail-speed", `Average speed: ${(route.totalDist / 1000 / (Math.max(totalMinutes, 1) / 60)).toFixed(1)} km/h`);
    setText("route-detail-cameras", `Cameras available: ${nearbyCameras}`);

    if (summary) {
      setText("route-detail-t15-eta", `${summary.predicted_eta} mins`);
      setText("route-detail-hotspots", `${state.habitRouteChatContext?.intelligence?.hotspot_count || 0} detected`);
    } else {
      setText("route-detail-t15-eta", "--");
      setText("route-detail-hotspots", "--");
    }
    updateTripCost(route.totalDist || 0, route.coords || []);

    const trafficEl = document.getElementById("route-detail-traffic");
    if (trafficEl) {
      const dotColor = trafficLevel === "Heavy" ? "red" : trafficLevel === "Moderate" ? "orange" : "green";
      trafficEl.innerHTML = `<span class="dot ${dotColor}"></span> ${trafficLevel}`;
    }
    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      const inUse = state.confirmedRouteId === route.id;
      confirmBtn.textContent = inUse ? "ROUTE IN USE" : "USE THIS ROUTE";
      confirmBtn.disabled = inUse;
      confirmBtn.setAttribute("data-route-id", route.id);
    }
  }

  function resetRouteDetailPanel() {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("route-detail-title", "FASTEST");
    setText("route-detail-time", "--");
    setText("route-detail-distance", "--");
    setText("route-detail-delay", "--");
    setText("route-detail-lights", "--");
    setText("route-detail-type", "--");
    setText("route-detail-speed", "Average speed: --");
    setText("route-detail-cameras", "Cameras available: --");
    resetCostPanel();
    const trafficEl = document.getElementById("route-detail-traffic");
    if (trafficEl) trafficEl.innerHTML = `<span class="dot green"></span> --`;
    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      confirmBtn.textContent = "USE THIS ROUTE";
      confirmBtn.disabled = true;
      confirmBtn.removeAttribute("data-route-id");
    }
  }

  function clearConfirmedRouteTracking() {
    state.confirmedRouteId = null;
    state.confirmedRoutePlan = null;
    state.confirmedRouteOriginalStartGeo = null;
    state.confirmedRouteEndGeo = null;
    state.confirmedRouteLastReplanAt = 0;
    state.confirmedTravelledCoords = [];
    state.confirmedLastLiveCoord = null;
    state.routeNearestCameraVisible = false;
    if (state.routeLiveWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(state.routeLiveWatchId);
    }
    if (state.mobileLocationPollId != null) {
      clearInterval(state.mobileLocationPollId);
    }
    state.mobileLocationPollId = null;
    state.routeLiveWatchId = null;
    state.routeLiveMarker = null;
    if (state.routeConfirmProgressLayer) state.routeConfirmProgressLayer.clearLayers();
    if (state.routeConfirmMarkerLayer) state.routeConfirmMarkerLayer.clearLayers();
    if (state.routeConfirmPoiLayer) state.routeConfirmPoiLayer.clearLayers();
    if (state.routeNearestCameraLayer) state.routeNearestCameraLayer.clearLayers();
    renderRouteCameraToggleButton();
  }
