// Route option cards and route polyline selection.
  function renderRouteCards() {
    const container = document.getElementById("route-cards");
    const title = document.getElementById("route-options-title");
    if (!container) return;
    if (title) title.textContent = `ROUTE OPTIONS (${state.routePlans.length}) · SORTED BY TIME`;

    const currentFastestId = state.routeContext?.currentFastestId || null;
    const enriched = state.routePlans.map((r) => {
      const eva = state.routeContext?.evaluation?.evaluations?.get(r.id) || { eventDelayMin: 0 };
      const totalMinutes = r.estMinutes + eva.eventDelayMin * 0.7;
      const trafficLevel = eva.eventDelayMin > 18 ? "Heavy" : eva.eventDelayMin > 8 ? "Moderate" : "Light";
      const routeLabel = r.id === currentFastestId ? "FASTEST NOW" : (ROUTE_LABELS[r.id] || r.id.toUpperCase());
      const routeIncidents = (eva.hits || []).length;
      const routeCameras = (state.cameras || []).filter((cam) => cam.hasRealtimeImage && distanceToRouteMeters(r.coords, cam.lat, cam.lon) <= 250).length;
      const cost = computeTripCostMetrics(r.totalDist || 0, r.coords || []);
      return { r, eva, totalMinutes, trafficLevel, routeLabel, routeIncidents, routeCameras, cost };
    });

    const minTotal = Math.min(...enriched.map(x => x.totalMinutes));
    const minDist = Math.min(...enriched.map(x => x.r.totalDist));
    const minLights = Math.min(...enriched.map(x => x.r.trafficLights));
    const avgTotal = enriched.reduce((sum, x) => sum + x.totalMinutes, 0) / Math.max(1, enriched.length);

    const sorted = enriched.slice().sort((a, b) => a.totalMinutes - b.totalMinutes);

    function getStatusTag(item) {
      if (Math.abs(item.totalMinutes - minTotal) < 1e-6) return "Fastest by time";
      if (Math.abs(item.r.totalDist - minDist) < 1e-6) return "Shortest distance";
      if (item.r.trafficLights === minLights) return "Fewest traffic signals";
      const dev = Math.abs(item.totalMinutes - avgTotal);
      const minDev = Math.min(...sorted.map(x => Math.abs(x.totalMinutes - avgTotal)));
      if (Math.abs(dev - minDev) < 1e-6) return "Balanced average";
      return "Balanced route";
    }

    const canSaveHabitRoute = Boolean(window.getFastAuth && window.getFastAuth()?.token);
    container.innerHTML = sorted.map((item, idx) => {
      const r = item.r;
      const eva = item.eva;
      const totalMinutes = item.totalMinutes;
      const trafficLevel = item.trafficLevel;
      const routeLabel = item.routeLabel;
      const statusTag = getStatusTag(item);
      const cost = item.cost;
      // Edited by JR here - added new "Save Habit Route" button
      return `
      <div class="route-card route-card-${r.id} ${r.id === state.selectedRouteId ? "selected" : ""}" data-route-id="${r.id}">
        ${canSaveHabitRoute ? `<button type="button" class="save-habit-btn" data-save-id="${r.id}" title="Save as Habit Route">SAVE</button>` : ""}
        <div class="route-card-main">${Math.round(totalMinutes)} mins</div>
        <div class="route-card-erp">+${Math.round(eva.eventDelayMin)} mins delay</div>
        <div class="route-card-status">#${idx + 1} · ${statusTag}</div>
        <div class="route-card-metrics">Distance ${(r.totalDist / 1000).toFixed(1)} km · Lights ${r.trafficLights}</div>
        <div class="route-card-metrics">Incidents ${item.routeIncidents} · Cameras ${item.routeCameras}</div>
        <div class="route-card-costs">
          <div class="route-card-cost-row"><span>Fuel Cost</span><span>S$${cost.fuelCost.toFixed(2)}</span></div>
          <div class="route-card-cost-row"><span>Fuel Used</span><span>${cost.litres.toFixed(2)} L</span></div>
          <div class="route-card-cost-row"><span>ERP Charges</span><span>S$${cost.erpCost.toFixed(2)}</span></div>
          <div class="route-card-cost-row"><span>Total Estimated Cost</span><span>S$${cost.totalCost.toFixed(2)}</span></div>
        </div>
      </div>
    `;
    }).join("");

    container.querySelectorAll(".route-card").forEach((el) => {
      el.addEventListener("click", () => {


        const id = el.getAttribute("data-route-id");
        selectRoute(id);
      });
    });

    // For save btn logic to add habit routes
    container.querySelectorAll(".save-habit-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation(); // Stop from selecting route on map
        const routeId = btn.getAttribute("data-save-id");
        const routeObj = state.routePlans.find(r => r.id === routeId);
        if (routeObj) {
          await saveRouteAsHabit(routeObj, btn);
        }
      });
    });
  }

  // 在规划地图绘制路线折线，并突出选中路线
  function drawRoutes(startGeo, endGeo, options) {
    if (!state.plannerMap || !state.routeLayer || !state.plannerLayer) return;
    const preserveView = Boolean(options && options.preserveView);
    state.routeLayer.clearLayers();
    state.routePolylines.clear();
    state.plannerLayer.clearLayers();

    state.routePlans.forEach((r) => {
      const line = L.polyline(r.coords, {
        color: r.color || ROUTE_COLORS[r.id] || "#2563eb",
        weight: r.id === state.selectedRouteId ? 6 : 4,
        opacity: r.id === state.selectedRouteId ? 0.95 : 0.55
      }).addTo(state.routeLayer);
      line.routeId = r.id;
      state.routePolylines.set(r.id, line);
    });

    const selected = state.routePlans.find(r => r.id === state.selectedRouteId) || state.routePlans[0];
    if (selected) {
      if (!preserveView) {
        const bounds = L.latLngBounds(selected.coords.map(c => [c[0], c[1]]));
        state.plannerMap.fitBounds(bounds.pad(0.05));
      }
      showRouteDetails(selected);
    }
  }

  // 用户点击路线卡片后的联动：高亮折线 + 刷新详情 + 同步 Alerts
  function selectRoute(routeId) {
    state.selectedRouteId = routeId;
    const selected = state.routePlans.find(r => r.id === routeId);
    if (!selected) return;
    showRouteDetails(selected);
    renderRouteCards();
    if (state.routeLayer) {
      state.routeLayer.eachLayer((layer) => {
        const id = layer.routeId;
        layer.setStyle({
          weight: id === routeId ? 6 : 4,
          opacity: id === routeId ? 0.95 : 0.55
        });
      });
    }
    refreshRouteFeedbackMarkersForSelectedRoute();
    renderAlertsPanels();
  }

  // 获取并标准化摄像头数据（聚合来源由后端负责）
