  function clearCurrentRoutePlan() {
    const startInput = document.getElementById("route-start-postal");
    const endInput = document.getElementById("route-end-postal");
    const hintEl = document.getElementById("route-planning-hint");
    const cardsEl = document.getElementById("route-cards");
    const titleEl = document.getElementById("route-options-title");

    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
    if (hintEl) hintEl.textContent = "Current route cleared. Enter a new start and destination to plan again.";
    if (cardsEl) cardsEl.innerHTML = "";
    if (titleEl) titleEl.textContent = "ROUTE OPTIONS (0)";

    state.routePlans = [];
    state.selectedRouteId = null;
    state.routeContext = null;
    state.routeStartCurrentGeo = null;
    state.selectedAlertIncidentId = null;
    clearConfirmedRouteTracking();


    // ADDED BY JR - to clear loaded saved route layers
    if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
    if (state.habitRoutePinLayer) state.habitRoutePinLayer.clearLayers();
    if (state.previewDetourLayer) state.previewDetourLayer.clearLayers();
    // END

    if (state.routeLayer) state.routeLayer.clearLayers();
    if (state.routeFeedbackLayer) state.routeFeedbackLayer.clearLayers();
    if (state.plannerLayer) state.plannerLayer.clearLayers();
    state.routePolylines.clear();

    resetRouteDetailPanel();
    renderAlertsPanels();
  }

  // 渲染 3 条路线卡片，并按“含事件延误后的 ETA”排序

  // 新版路径规划入口：调用后端 /api/route-plan（Python A*）
  async function fetchRoutePlansFromPython(startGeo, endGeo, paddingDeg, options = {}) {
    const resp = await fetch("/api/route-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: { lat: startGeo.lat, lon: startGeo.lon },
        end: { lat: endGeo.lat, lon: endGeo.lon },
        paddingDeg: Number.isFinite(Number(paddingDeg)) ? Number(paddingDeg) : undefined,
        avoidPoints: Array.isArray(options.avoidPoints) ? options.avoidPoints : undefined,
        blockedEdges: Array.isArray(options.blockedEdges) ? options.blockedEdges : undefined,
        avoidRadiusMeters: Number.isFinite(Number(options.avoidRadiusMeters)) ? Number(options.avoidRadiusMeters) : undefined,
        avoidPenaltyMultiplier: Number.isFinite(Number(options.avoidPenaltyMultiplier)) ? Number(options.avoidPenaltyMultiplier) : undefined
      })
    });
    const data = await resp.json();
    if (!resp.ok) {
      const detail = data?.details ? `: ${data.details}` : "";
      throw new Error((data.error || "Python route-plan failed") + detail);
    }
    const routes = Array.isArray(data.routes) ? data.routes : [];
    return routes
      .map((r) => ({
        id: r.id,
        label: r.label || (ROUTE_LABELS[r.id] || String(r.id || "").toUpperCase()),
        color: r.color || ROUTE_COLORS[r.id] || "#2563eb",
        desc: r.desc || "",
        totalDist: Number(r.totalDist),
        estMinutes: Number(r.estMinutes),
        trafficLights: Math.max(0, Math.round(Number(r.trafficLights) || 0)),
        coords: (Array.isArray(r.coords) ? r.coords : []).map((c) => [Number(c[0]), Number(c[1])]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])),
        signature: r.signature || `${r.id || "route"}-${Math.random().toString(36).slice(2, 8)}`,
        path: []
      }))
      .filter((r) => r.id && Number.isFinite(r.totalDist) && Number.isFinite(r.estMinutes) && Array.isArray(r.coords) && r.coords.length >= 2);
  }

  // 普通路径规划主流程：
  // 1) 输入解析与地理编码
  // 2) 调后端 Python 生成 3 条路线
  // 3) 叠加事件评估并决定“当前最快”
  // 4) 刷新地图、路线卡片、详情与 Alerts
  async function calculateRoutes() {
    const btn = document.getElementById("route-calculate-btn");
    const hintEl = document.getElementById("route-planning-hint");
    const startInput = document.getElementById("route-start-postal");
    const endInput = document.getElementById("route-end-postal");
    const startQuery = (startInput?.value || "").trim();
    const endQuery = (endInput?.value || "").trim();

    // ADDED BY JR - Clear loaded saved routes
    if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
    if (state.habitRoutePinLayer) state.habitRoutePinLayer.clearLayers();
    if (state.previewDetourLayer) state.previewDetourLayer.clearLayers();

    if (!startQuery || !endQuery) {
      alert("Please enter start and destination (postal code or location name).");
      return;
    }

    if (btn) btn.disabled = true;
    const startedAt = Date.now();
    let waitSeconds = 0;
    let waitTimer = null;
    if (hintEl) {
      hintEl.textContent = `Planning route, estimated 10-20 seconds. You have waited ${waitSeconds} seconds.`;
      waitTimer = setInterval(() => {
        waitSeconds += 1;
        hintEl.textContent = `Planning route, estimated 10-20 seconds. You have waited ${waitSeconds} seconds.`;
      }, 1000);
    }
    try {
      const startGeoPromise = state.routeStartCurrentGeo && startQuery === "Current Location"
        ? Promise.resolve({ ...state.routeStartCurrentGeo, display: "Current Location" })
        : geocodeLocation(startQuery);
      // JR edit here - make geolocation optional? --
      const [startGeo, endGeo] = await Promise.all([startGeoPromise, geocodeLocation(endQuery)]);
      const userLoc = { lat: startGeo.lat, lon: startGeo.lon };
      const plans = await fetchRoutePlansFromPython(startGeo, endGeo, 0.03);
      if (!plans.length) throw new Error("No valid route plan generated.");

      const realtimeCameras = state.cameras.filter(c => c.hasRealtimeImage);
      const liveRouteEvents = mapLiveIncidentsToRouteEvents(state.dashboardIncidents);
      const defaultRoute = plans.find(r => r.id === "fastest") || plans[0];
      const baseCoords = getRouteCoords(defaultRoute, startGeo, endGeo);
      const relevantEvents = await analyzeEventsViaBackend(liveRouteEvents, userLoc, baseCoords);
      const eventsWithCameras = attachEventCameras(relevantEvents, realtimeCameras);
      const evaluation = await evaluateRoutesByEventsViaBackend(plans, eventsWithCameras);
      const currentFastestId = evaluation.currentFastestId || deriveCurrentFastestId(plans, evaluation) || plans[0].id;

      state.routePlans = plans;
      state.routeContext = {
        userLoc,
        events: eventsWithCameras,
        evaluation,
        startGeo,
        endGeo,
        currentFastestId,
        generatedAt: new Date().toISOString()
      };
      state.selectedRouteId = evaluation.recommendedRouteId || plans[0].id;
      clearConfirmedRouteTracking();

      drawRoutes(startGeo, endGeo);
      applyRoutePreferenceSelection();
      renderRouteCards();
      showRouteDetails(state.routePlans.find(r => r.id === state.selectedRouteId));
      refreshRouteFeedbackMarkersForSelectedRoute();
      renderAlertsPanels();
      const elapsedSeconds = Math.max(waitSeconds, Math.ceil((Date.now() - startedAt) / 1000));
      if (hintEl) hintEl.textContent = `Route planning completed. You waited ${elapsedSeconds} seconds. 3 routes are sorted by ETA.`;
    } catch (err) {
      alert(`Route calculation failed: ${err.message}`);
      const elapsedSeconds = Math.max(waitSeconds, Math.ceil((Date.now() - startedAt) / 1000));
      if (hintEl) hintEl.textContent = `Route planning failed after ${elapsedSeconds} seconds: ${err.message}`;
    } finally {
      if (waitTimer) clearInterval(waitTimer);
      if (btn) btn.disabled = false;
    }
  }

  // 统一绑定所有页面事件：按钮、tab、hash、列表项、dismiss 等
  function bindActions() {
    const calcBtn = document.getElementById("route-calculate-btn");
    if (calcBtn) calcBtn.addEventListener("click", calculateRoutes);

    const preferenceBtn = document.getElementById("route-preference-btn");
    if (preferenceBtn) {
      preferenceBtn.addEventListener("click", cycleRoutePreference);
    }

    const cancelBtn = document.getElementById("route-cancel-btn");
    if (cancelBtn) cancelBtn.addEventListener("click", clearCurrentRoutePlan);

    const confirmBtn = document.getElementById("route-confirm-btn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        confirmSelectedRouteUsage().catch((err) => {
          alert(`Failed to start navigation: ${err.message}`);
        });
      });
    }

    const startInput = document.getElementById("route-start-postal");
    const startSuggestions = document.getElementById("route-start-suggestions");
    const currentLocationOption = document.getElementById("route-start-current-option");
    if (startInput) {
      const maybeShowSuggestions = () => {
        const value = startInput.value.trim().toLowerCase();
        toggleRouteStartSuggestions(!value || "current location".includes(value));
      };
      startInput.addEventListener("focus", maybeShowSuggestions);
      startInput.addEventListener("click", maybeShowSuggestions);
      startInput.addEventListener("input", () => {
        if (startInput.value.trim() !== "Current Location") {
          state.routeStartCurrentGeo = null;
        }
        maybeShowSuggestions();
      });
      startInput.addEventListener("blur", () => {
        setTimeout(() => toggleRouteStartSuggestions(false), 120);
      });
    }
    if (currentLocationOption) {
      currentLocationOption.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      currentLocationOption.addEventListener("click", async () => {
        await useCurrentLocationAsRouteStart();
        toggleRouteStartSuggestions(false);
      });
    }
    document.addEventListener("click", (e) => {
      if (startSuggestions && startInput) {
        const inStartPicker = startSuggestions.contains(e.target) || startInput.contains(e.target);
        if (!inStartPicker) toggleRouteStartSuggestions(false);
      }
    });

    const viewCameraBtn = document.getElementById("route-view-cameras-btn");
    if (viewCameraBtn) {
      renderRouteCameraToggleButton();
      viewCameraBtn.addEventListener("click", () => {
        toggleRouteNearestLiveCamera();
      });
    }

    const adminUsersRefreshBtn = document.getElementById("admin-users-refresh-btn");
    if (adminUsersRefreshBtn) {
      adminUsersRefreshBtn.addEventListener("click", async () => {
        await renderAdminUsersPanel();
        await renderAdminFeedbackPanel();
      });
    }
    const feedbackTimeFilter = document.getElementById("admin-feedback-time-filter");
    const feedbackSeverityFilter = document.getElementById("admin-feedback-severity-filter");
    if (feedbackTimeFilter) {
      feedbackTimeFilter.addEventListener("change", () => {
        state.adminFeedbackFilters.timeRange = feedbackTimeFilter.value || "all";
        applyAdminFeedbackFilters();
      });
    }
    if (feedbackSeverityFilter) {
      feedbackSeverityFilter.addEventListener("change", () => {
        state.adminFeedbackFilters.severity = feedbackSeverityFilter.value || "all";
        applyAdminFeedbackFilters();
      });
    }
    const incidentSortBtn = document.getElementById("incident-sort-btn");
    if (incidentSortBtn) {
      incidentSortBtn.addEventListener("click", () => {
        state.incidentSortMode = state.incidentSortMode === "time" ? "severity" : "time";
        renderIncidentSortButton();
        renderIncidentUpdatesList();
      });
    }
    const dashboardUpdatesList = document.getElementById("dashboard-updates-list");
    if (dashboardUpdatesList) {
      dashboardUpdatesList.addEventListener("click", (event) => {
        const row = event.target.closest(".dashboard-update-item");
        if (!row) return;
        const incidentId = row.getAttribute("data-incident-id");
        highlightDashboardEvidenceCard(incidentId);
      });
    }
    const mapIncidentToggleBtn = document.getElementById("map-toggle-incidents-btn");
    if (mapIncidentToggleBtn) {
      mapIncidentToggleBtn.addEventListener("click", async () => {
        mapIncidentToggleBtn.disabled = true;
        try {
          await toggleMapIncidentsLayer();
        } catch (err) {
          alert(`Load LTA incidents failed: ${err.message}`);
        } finally {
          mapIncidentToggleBtn.disabled = false;
        }
      });
    }
    const mapErpToggleBtn = document.getElementById("map-toggle-erp-btn");
    if (mapErpToggleBtn) {
      mapErpToggleBtn.addEventListener("click", async () => {
        mapErpToggleBtn.disabled = true;
        try {
          await toggleMapErpLayer();
        } catch (err) {
          alert(`Load ERP markers failed: ${err.message}`);
        } finally {
          mapErpToggleBtn.disabled = false;
        }
      });
    }
    const mapPgsToggleBtn = document.getElementById("map-toggle-pgs-btn");
    if (mapPgsToggleBtn) {
      mapPgsToggleBtn.addEventListener("click", async () => {
        mapPgsToggleBtn.disabled = true;
        try {
          await toggleMapPgsLayer();
        } catch (err) {
          alert(`Load PGS markers failed: ${err.message}`);
        } finally {
          mapPgsToggleBtn.disabled = false;
        }
      });
    }
    const mapCameraToggleBtn = document.getElementById("map-toggle-cameras-btn");
    if (mapCameraToggleBtn) {
      mapCameraToggleBtn.addEventListener("click", () => {
        toggleMapCamerasVisibility();
      });
    }
    const mapFeedbackToggleBtn = document.getElementById("map-toggle-feedback-btn");
    if (mapFeedbackToggleBtn) {
      mapFeedbackToggleBtn.addEventListener("click", async () => {
        mapFeedbackToggleBtn.disabled = true;
        try {
          await toggleFeedbackMapLayer();
        } catch (err) {
          alert(`Load feedback markers failed: ${err.message}`);
        } finally {
          mapFeedbackToggleBtn.disabled = false;
        }
      });
    }
    const routeFavoritesBtn = document.getElementById("route-toggle-favorites-btn");
    if (routeFavoritesBtn) {
      routeFavoritesBtn.addEventListener("click", () => {
        toggleRouteFavoritesPanel();
      });
    }
    const incidentSourceBtn = document.getElementById("admin-incident-source-btn");
    if (incidentSourceBtn) {
      incidentSourceBtn.addEventListener("click", async () => {
        if (!isAdmin()) return;
        state.incidentDataSource = state.incidentDataSource === "live" ? "mock" : "live";
        renderIncidentSourceButton();
        try {
          await refreshDashboardIncidents();
        } catch (err) {
          console.error(err);
          alert(`Failed to switch incident data source: ${err.message}`);
        }
      });
    }
    // Habit Route buttons
    const habitRefreshBtn = document.getElementById("habit-routes-refresh-btn");
    if (habitRefreshBtn) {
      habitRefreshBtn.addEventListener("click", async () => {
        await loadHabitRoutesFromServer();
        if (state.habitRoutesMap) {
          setTimeout(() => state.habitRoutesMap.invalidateSize(), 40);
        }
      });
    }

    const habitClearBtn = document.getElementById("habit-routes-clear-map-btn");
    if (habitClearBtn) {
      habitClearBtn.addEventListener("click", () => {
        if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
      });
    }

    const alertBackBtn = document.getElementById("alert-detail-back-btn");
    if (alertBackBtn) {
      alertBackBtn.addEventListener("click", () => {
        window.location.hash = "alerts";
      });
    }

    document.addEventListener("click", (e) => {
      const detailBtn = e.target.closest(".alert-view-detail-btn");
      if (detailBtn) {
        const incidentId = detailBtn.getAttribute("data-incident-id");
        state.selectedAlertIncidentId = incidentId;
        window.location.hash = "alert-detail";
        renderAlertDetailPage();
        return;
      }
      const dismissBtn = e.target.closest(".alert-dismiss-btn");
      if (dismissBtn) {
        const incidentId = dismissBtn.getAttribute("data-incident-id");
        state.alertDismissedIds.add(String(incidentId || ""));
        renderAlertsPanels();
      }
    });

    window.addEventListener("hashchange", () => {
      const page = (window.location.hash || "#home").slice(1);
      if (page === "alerts") {
        renderAlertsPanels();
        refreshAlertsInfoFeed();
      }
      if (page === "admin-users" && isAdmin()) {
        renderAdminUsersPanel();
        renderAdminFeedbackPanel();
      }
      if (page === "alert-detail") {
        if (!state.selectedAlertIncidentId && state.dashboardIncidents.length) {
          state.selectedAlertIncidentId = String(state.dashboardIncidents[0].id || "");
        }
        renderAlertDetailPage();
      }
    });

    const tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.getAttribute("data-page") === "alerts") {
          renderAlertsPanels();
          refreshAlertsInfoFeed();
        }
        if (tab.getAttribute("data-page") === "admin-users" && isAdmin()) {
          renderAdminUsersPanel();
          renderAdminFeedbackPanel();
        }
        if (tab.getAttribute("data-page") === "habit-routes") {
          loadHabitRoutesFromServer().catch((err) => {
            console.error("Failed to load habit routes:", err);
          });
        }
        setTimeout(() => {
          if (state.liveMap) state.liveMap.invalidateSize();
          if (state.plannerMap) state.plannerMap.invalidateSize(true);
          // Added Habit Route Map invalidate
          if (state.habitRoutesMap) state.habitRoutesMap.invalidateSize();
        }, 250);
      });
    });
  }

  // 页面启动入口：初始化地图、拉取基础数据、按当前 hash 渲染目标页面
  async function bootstrapDemo() {
    if (!window.L) return;
    ensureMaps();
    bindActions();
    bindTripCostControls();

    try {
      renderIncidentSourceButton();
      renderMapCameraToggleButton();
      renderMapIncidentToggleButton();
      renderMapErpToggleButton();
      renderMapPgsToggleButton();
      renderMapFeedbackToggleButton();
      renderRoutePreferenceButton();
      renderRouteFavoritesToggleButton();
      renderRouteFavoritesPanel();
      state.cameras = await fetchCameras();
      updateDashboardStats();
      try {
        await refreshDashboardIncidents();
      } catch (incErr) {
        console.error(incErr);
        state.dashboardIncidents = [];
        renderAlertsPanels();
        renderDashboardEvidence();
      }
      await renderAdminUsersPanel();
      await renderAdminFeedbackPanel();
      renderLiveMapAndList();
      if (state.mapIncidentsVisible) drawLiveIncidentMarkers(state.mapLiveIncidents);
      if (state.mapErpVisible) drawErpMarkers();
      if (state.mapPgsVisible) drawPgsMarkers();
      if (state.feedbackMapVisible) drawFeedbackMapMarkers();
      await loadHabitRoutesFromServer();
      checkTrafficAlerts();
      const currentPage = (window.location.hash || "#home").slice(1);
      if (currentPage === "alerts") renderAlertsPanels();
      if (currentPage === "alerts") refreshAlertsInfoFeed();
      if (currentPage === "admin-users" && isAdmin()) {
        await renderAdminUsersPanel();
        await renderAdminFeedbackPanel();
      }
      if (currentPage === "alert-detail") {
        if (!state.selectedAlertIncidentId && state.dashboardIncidents.length) {
          state.selectedAlertIncidentId = String(state.dashboardIncidents[0].id || "");
        }
        renderAlertDetailPage();
      }
      // FOR TRAFFIC ALERTS. Call FastAPI to check traffic alerts every 60s
      setInterval(checkTrafficAlerts, 60000);

      // FOR EXPRESSWAY FORECASTING IN DASHBOARD
      const forecastGrid = document.getElementById('expressway-forecast-grid');
      if (forecastGrid) {
        console.log("Initializing Expressway Specialist Forecast...");
        refreshExpresswayDashboard();
      }
      refreshHotspotsDashboard()

      // AI Chat section
      const launcher = document.getElementById('ai-chat-launcher');
      const chatContainer = document.getElementById('ai-chat-container');
      const closeBtn = document.getElementById('ai-chat-close');
      const sendBtn = document.getElementById('ai-chat-send');
      const chatInput = document.getElementById('chat-input');

      if (launcher && chatContainer) {
        // Toggle Logic
        launcher.addEventListener('click', () => {
          const isHidden = chatContainer.style.display === 'none' || chatContainer.style.display === '';
          chatContainer.style.display = isHidden ? 'block' : 'none';
          launcher.innerHTML = isHidden ? '×' : 'Chat';
          if (isHidden) chatInput.focus();
        });

        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            chatContainer.style.display = 'none';
            launcher.innerHTML = 'Chat';
          });
        }

        initHabitPlannerPanel();

        // Send Logic
        if (sendBtn) {
          sendBtn.addEventListener('click', sendChatMessage);
        }

        // Allow "Enter" key to send
        chatInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') sendChatMessage();
        });
      }

      // Handle the alerts dropdown toggle to view alerts
      const alertsToggle = document.getElementById("alerts-toggle");
      if (alertsToggle) {
        alertsToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          document.getElementById("alerts-nav-dropdown").classList.toggle("hidden");
        });
      }

      setTimeout(() => {
        if (state.liveMap) state.liveMap.invalidateSize();
        if (state.plannerMap) state.plannerMap.invalidateSize(true);
      }, 500);
    } catch (err) {
      console.error(err);
    }
  }

  // 登录态变化后的全局重同步：管理员区块、事故源、告警联动全部刷新
  window.addEventListener("fast-auth-changed", async () => {
    const usersPanel = document.getElementById("admin-users-panel");
    if (usersPanel) usersPanel.classList.toggle("hidden", !isAdmin());
    if (!isAdmin()) state.incidentDataSource = "live";
    renderIncidentSourceButton();
    renderMapFeedbackToggleButton();
    if (!window.getFastAuth || !window.getFastAuth()) {
      state.favoritePlannerPanelVisible = false;
    }
    updateGuestFeatureVisibility();
    renderRouteFavoritesToggleButton();
    renderRouteFavoritesPanel();
    if (isAdmin()) {
      await renderAdminUsersPanel();
      await renderAdminFeedbackPanel();
    } else {
      state.feedbackMapVisible = false;
      state.adminFeedbackItems = [];
      state.feedbackMapItems = [];
      state.routeFeedbackItems = [];
      state.routeFeedbackLoadedAt = 0;
      if (state.feedbackMapLayer) state.feedbackMapLayer.clearLayers();
      if (state.routeFeedbackLayer) state.routeFeedbackLayer.clearLayers();
    }
    try {
      await refreshDashboardIncidents();
    } catch (err) {
      console.error(err);
    }
    renderAlertsPanels();
    refreshAlertsInfoFeed();
  });

  window.addEventListener("fast-settings-changed", async () => {
    renderRouteFavoritesPanel();
  });

  // JR's Section.
  // 现在统一改为走当前 demo 自己的登录态和 Node.js 后端，
  // 不再依赖单独的 Supabase Auth / 外部 FastAPI。


