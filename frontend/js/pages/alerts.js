// Alerts page rendering and alert detail workflow.

  // Alerts 右栏资讯渲染：近 7 天新闻 + 最新规则更新
  function renderAlertsInfoFeed(feed) {
    const weeklyListEl = document.getElementById("alerts-weekly-news-list");
    const latestRuleEl = document.getElementById("alerts-latest-rule");
    if (!weeklyListEl || !latestRuleEl) return;

    const weeklyNews = Array.isArray(feed?.weeklyNews) ? feed.weeklyNews : [];
    const latestRule = feed?.latestRule || null;

    if (!weeklyNews.length) {
      weeklyListEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No traffic incident news available for the past 7 days.</strong></div></div>`;
    } else {
      weeklyListEl.innerHTML = weeklyNews.map((item, idx) => `
        <div class="alert-card">
          <div class="alert-body">
            <strong>${idx + 1}. ${escapeHtml(item.title || "Traffic news")}</strong>
            <span class="alert-meta">TIME: ${escapeHtml(formatFeedTime(item.publishedAt))}</span>
            <a class="alert-meta" href="${escapeHtml(item.link || "#")}" target="_blank" rel="noopener noreferrer">Open source</a>
          </div>
        </div>
      `).join("");
    }

    if (!latestRule) {
      latestRuleEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No latest traffic rule updates available.</strong></div></div>`;
      return;
    }
    latestRuleEl.innerHTML = `
      <h4 style="margin:0 0 8px;">Latest Traffic Rule Update</h4>
      <div class="alert-card">
        <div class="alert-body">
          <strong>${escapeHtml(latestRule.title || "Traffic rule update")}</strong>
          <span class="alert-meta">TIME: ${escapeHtml(formatFeedTime(latestRule.publishedAt))}</span>
          <a class="alert-meta" href="${escapeHtml(latestRule.link || "#")}" target="_blank" rel="noopener noreferrer">Open source</a>
        </div>
      </div>
    `;
  }

  // 刷新 Alerts 资讯流（进入 Alerts 页面时触发）
  async function refreshAlertsInfoFeed() {
    const weeklyListEl = document.getElementById("alerts-weekly-news-list");
    const latestRuleEl = document.getElementById("alerts-latest-rule");
    if (!weeklyListEl || !latestRuleEl) return;
    weeklyListEl.innerHTML = `<p style="margin:0;">Loading traffic incident news for the past 7 days...</p>`;
    latestRuleEl.innerHTML = `<p style="margin:0;">Loading latest traffic rules...</p>`;
    try {
      const res = await fetch(API_CONFIG.alerts.trafficInfoFeedUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Feed request failed");
      state.alertsInfoFeed = data;
      renderAlertsInfoFeed(data);
    } catch (err) {
      console.error("Traffic info feed failed:", err.message);
      weeklyListEl.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>Failed to load information</strong><span class="alert-meta">${escapeHtml(err.message)}</span></div></div>`;
      latestRuleEl.innerHTML = "";
    }
  }

  // Alerts 的“附近事故”逻辑只请求一次定位，避免频繁弹权限/消耗性能
  async function ensureAlertLocation() {
    if (state.alertLocationReady) return;
    state.alertLocationReady = true;
    state.userLocation = await getUserLocation();
  }

  // 是否属于“附近事故”：与用户定位距离 <= 3.5km
  function incidentIsNearby(incident) {
    if (!state.userLocation) return false;
    const lat = Number(incident?.lat);
    const lon = Number(incident?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return haversine(state.userLocation.lat, state.userLocation.lon, lat, lon) <= 3500;
  }

  // 生成单条告警卡 HTML（Pinned 与 All 共用）
  function buildAlertCardHtml(incident, badgeText) {
    const sevColor = getIncidentSeverityColor(incident);
    const impactLabel = getIncidentImpactLabel(incident);
    const impactClass = sevColor === "red" ? "high" : sevColor === "orange" ? "medium" : "low";
    const id = escapeHtml(incident.id || "");
    const summary = escapeHtml(incident.message || incident.type || "Traffic incident");
    const area = escapeHtml(incident.area || "Unknown area");
    const timeText = escapeHtml(formatIncidentTime(incident.createdAt));
    return `
      <div class="alert-card" data-incident-id="${id}">
        <span class="alert-icon ${sevColor}"></span>
        <div class="alert-body">
          <strong>${summary}</strong>
          ${badgeText ? `<span class="badge nearby">${escapeHtml(badgeText)}</span>` : ""}
          <p>Area: ${area}</p>
          <span class="alert-meta">REPORTED: ${timeText}</span>
          <span class="alert-meta">SPREAD: ${escapeHtml(getIncidentSpreadText(incident))}</span>
          <span class="alert-meta">DURATION: ${escapeHtml(getIncidentDurationText(incident))}</span>
          <span class="impact-tag ${impactClass}">${impactLabel}</span>
        </div>
        <div class="alert-actions">
          <button type="button" class="alert-view-detail-btn" data-incident-id="${id}">View Details ></button>
          <button type="button" class="alert-dismiss-btn" data-incident-id="${id}">Dismiss ×</button>
        </div>
      </div>
    `;
  }

  // 以事故点就近匹配实时摄像头（前端辅助逻辑）
  function getNearestCameraForPoint(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const cam of state.cameras || []) {
      if (!cam.hasRealtimeImage) continue;
      const d = haversine(lat, lon, cam.lat, cam.lon);
      if (d < bestDist) {
        bestDist = d;
        best = cam;
      }
    }
    if (!best || bestDist > 1800) return null;
    return best;
  }

  // 普通规划模式下：提取当前选中真实路线上的命中事件
  function getSelectedPlannedRouteIncidentsForAlerts() {
    const selectedId = state.selectedRouteId;
    const evalMap = state.routeContext?.evaluation?.evaluations;
    const routeEval = selectedId && evalMap ? evalMap.get(selectedId) : null;
    const hits = routeEval?.hits || [];
    if (!hits.length) return [];
    const generatedAt = state.routeContext?.generatedAt || new Date().toISOString();

    return hits.map((evt, idx) => {
      const cam = evt.cameras && evt.cameras.length ? evt.cameras[0] : getNearestCameraForPoint(Number(evt.lat), Number(evt.lon));
      return {
        id: `route-${selectedId}-${evt.id || idx}`,
        type: evt.type || evt.label || "Route incident",
        message: evt.reason || evt.label || "Incident detected on selected route",
        area: cam?.name || "Along selected route",
        lat: evt.lat,
        lon: evt.lon,
        createdAt: generatedAt,
        spreadRadiusKm: 1.0,
        estimatedDurationMin: Math.max(10, Math.round((evt.delayMin || 8) * 2)),
        estimatedDurationMax: Math.max(20, Math.round((evt.delayMin || 8) * 4)),
        imageLink: cam?.imageLink || null,
        cameraName: cam?.name || null
      };
    });
  }

  // Alerts 主渲染入口：
  // - 决定 Pinned 来源（当前规划路线 / 附近事故）
  // - 渲染全部事故列表
  // - 维护详情页索引 map
  function renderAlertsPanels() {
    const pinnedSection = document.getElementById("alerts-pinned-section");
    const pinnedList = document.getElementById("alerts-pinned-list");
    const allList = document.getElementById("alerts-all-list");
    if (!pinnedSection || !pinnedList || !allList) return;
    if (!state.alertLocationReady) ensureAlertLocation().then(() => renderAlertsPanels());

    const base = sortIncidents(state.dashboardIncidents, state.incidentSortMode)
      .filter((it) => !state.alertDismissedIds.has(String(it.id || "")));

    let pinned = [];
    let badgeText = "";
    if (state.selectedRouteId && state.routeContext) {
      pinned = getSelectedPlannedRouteIncidentsForAlerts();
      badgeText = "ROUTE";
    }

    if (!pinned.length) {
      pinnedSection.style.display = "none";
      pinnedList.innerHTML = "";
    } else {
      pinnedSection.style.display = "";
      pinnedList.innerHTML = pinned.map((it) => buildAlertCardHtml(it, badgeText)).join("");
    }

    if (!base.length) {
      allList.innerHTML = `<div class="alert-card"><div class="alert-body"><strong>No active realtime incidents now.</strong></div></div>`;
    } else {
      allList.innerHTML = base.map((it) => buildAlertCardHtml(it, "")).join("");
    }
    state.alertIncidentById = new Map([...base, ...pinned].map((it) => [String(it.id || ""), it]));
    if (state.alertsInfoFeed) renderAlertsInfoFeed(state.alertsInfoFeed);
  }

  function buildIncidentReasonFallback(incident) {
    const message = String(incident?.message || "");
    const type = String(incident?.type || "");
    const text = `${message} ${type}`.toLowerCase();
    const severity = getIncidentSeverityScore(incident);
    const created = incident?.createdAt ? new Date(incident.createdAt) : null;
    const hour = created && !Number.isNaN(created.getTime()) ? created.getHours() : null;
    const isPeak = hour !== null && ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20));

    if (text.includes("accident") || text.includes("collision") || text.includes("crash")) {
      return "A collision or lane blockage is likely forcing vehicles to merge and slow down.";
    }
    if (text.includes("breakdown") || text.includes("stalled") || text.includes("vehicle")) {
      return "A broken-down vehicle is likely reducing usable lane space and creating a bottleneck.";
    }
    if (text.includes("road work") || text.includes("roadwork") || text.includes("maintenance") || text.includes("works")) {
      return "Road works are likely narrowing the carriageway and causing slower merging traffic.";
    }
    if (text.includes("obstacle") || text.includes("debris")) {
      return "An obstacle on the road is likely making drivers brake and pass the area more cautiously.";
    }
    if (text.includes("congestion") || text.includes("jam") || text.includes("slow traffic")) {
      return isPeak
        ? "Peak-period demand and repeated braking are likely causing traffic to build up."
        : "Heavy traffic build-up is likely causing stop-start movement and reduced road capacity.";
    }
    if (text.includes("closure") || text.includes("closed")) {
      return "A lane or road closure is likely diverting traffic into fewer lanes and increasing delay.";
    }
    if (text.includes("rain") || text.includes("wet")) {
      return "Wet conditions are likely making drivers keep larger gaps and reduce speed.";
    }
    if (severity >= 3) {
      return "A serious disruption is likely reducing available lanes and causing drivers to merge slowly.";
    }
    if (severity === 2) {
      return "A moderate disruption is likely creating intermittent braking and short queues.";
    }
    return "Drivers are likely slowing to pass the affected section safely, causing a temporary traffic build-up.";
  }

  function reasonRepeatsLocation(reason, incident) {
    const cleanReason = String(reason || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const cleanArea = String(incident?.area || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!cleanReason) return true;
    if (cleanArea.length >= 12 && cleanReason.includes(cleanArea)) return true;
    const stopWords = new Set([
      "road", "street", "avenue", "drive", "lane", "link", "expressway", "highway",
      "before", "after", "towards", "near", "along", "singapore", "camera",
      "north", "south", "east", "west", "central", "region", "exit", "entrance"
    ]);
    const terms = `${incident?.area || ""} ${incident?.cameraName || ""}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word, index, arr) => word.length >= 4 && !stopWords.has(word) && arr.indexOf(word) === index);
    const matches = terms.filter((term) => cleanReason.includes(term)).length;
    const hasLocationPhrase = /\b(at|near|around|along|towards|before|after)\b/.test(cleanReason);
    return hasLocationPhrase && matches >= Math.min(2, terms.length || 2);
  }

  // 事故详情 AI 摘要（带缓存，失败自动回退）
  async function fetchGeminiIncidentSummary(incident) {
    const cacheKey = String(incident?.id || "");
    if (state.alertAiCache.has(cacheKey)) return state.alertAiCache.get(cacheKey);

    const fallback = {
      location: incident.area || "Unknown area",
      time: formatIncidentTime(incident.createdAt),
      reason: buildIncidentReasonFallback(incident),
      duration: getIncidentDurationText(incident) !== "N/A"
        ? `${getIncidentDurationText(incident)} (estimated)`
        : (getIncidentSeverityScore(incident) >= 3 ? "90-120 minutes (estimated)" : getIncidentSeverityScore(incident) === 2 ? "45-90 minutes (estimated)" : "20-45 minutes (estimated)")
    };

    try {
      const res = await fetch(API_CONFIG.ai.incidentSummaryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident: {
            message: incident.message || incident.type || "Traffic incident",
            incidentType: incident.type || incident.message || "Traffic incident",
            area: incident.area || "Unknown area",
            createdAt: formatIncidentTime(incident.createdAt),
            cameraName: incident.cameraName || "None",
            severity: getIncidentSeverityScore(incident)
          }
        })
      });
      if (!res.ok) throw new Error("Gemini request failed");
      const data = await res.json();
      const aiReason = String(data.reason || "").trim();
      const result = {
        location: data.location || fallback.location,
        time: data.time || fallback.time,
        reason: aiReason && !reasonRepeatsLocation(aiReason, incident) ? aiReason : fallback.reason,
        duration: data.duration || fallback.duration
      };
      state.alertAiCache.set(cacheKey, result);
      return result;
    } catch (err) {
      console.warn("Incident summary fallback:", err.message);
    }
    state.alertAiCache.set(cacheKey, fallback);
    return fallback;
  }

  async function fetchWeatherForTrafficImpact(lat, lon) {
    const [weatherResp, forecastResp] = await Promise.all([
      fetch(`${API_CONFIG.weather.currentUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
      fetch(`${API_CONFIG.weather.forecastUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)
    ]);
    const weatherData = await weatherResp.json();
    const forecastData = await forecastResp.json();
    if (!weatherResp.ok) throw new Error(weatherData.error || "Weather fetch failed");
    if (!forecastResp.ok) throw new Error(forecastData.error || "Forecast fetch failed");
    return {
      weather: weatherData,
      forecast: {
        hourly: Array.isArray(forecastData.value)
          ? forecastData.value
          : Array.isArray(forecastData.hourly)
            ? forecastData.hourly
            : []
      }
    };
  }

  async function fetchAlertTrafficImpactPrediction(incident) {
    let lat = Number(incident?.lat);
    let lon = Number(incident?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const currentLoc = state.userLocation || await getUserLocation();
      state.userLocation = currentLoc || state.userLocation;
      lat = Number(currentLoc?.lat);
      lon = Number(currentLoc?.lon);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("No usable coordinates for traffic impact prediction");
    }
    const { weather, forecast } = await fetchWeatherForTrafficImpact(lat, lon);
    if (!window.TrafficMLModel) throw new Error("Traffic ML model not loaded");
    const prediction = await window.TrafficMLModel.predict(weather, forecast);
    return { prediction, weather, lat, lon };
  }

  function setAlertImpactBar(barId, valId, pct, label) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (bar) bar.style.width = `${Math.min(Math.max(Math.round(Number(pct) || 0), 0), 100)}%`;
    if (val) val.textContent = label;
  }

  function renderAlertTrafficImpactResult(result, weather) {
    const scoreEl = document.getElementById("detail-impact-score");
    const ringEl = document.getElementById("detail-impact-ring");
    const badgeEl = document.getElementById("detail-impact-level");
    const summaryEl = document.getElementById("detail-impact-summary");
    const clearEl = document.getElementById("detail-impact-clearing");
    const confEl = document.getElementById("detail-impact-confidence");
    const engineEl = document.getElementById("detail-impact-engine");
    if (scoreEl) scoreEl.textContent = result.score ?? "--";
    if (ringEl) ringEl.className = `impact-ring ${result.levelClass || "impact-low"}`;
    if (badgeEl) {
      badgeEl.textContent = result.level || "--";
      badgeEl.className = `impact-level-badge ${result.levelClass || "impact-low"}`;
    }
    if (summaryEl) summaryEl.textContent = result.summary || "No traffic impact summary available.";
    if (clearEl) clearEl.textContent = result.clearingTime || "--";
    if (confEl) confEl.textContent = `${result.confidence ?? "--"}%`;
    if (engineEl) {
      engineEl.textContent = result.source === "python-api"
        ? "ML Engine · Python RandomForest · alert detail"
        : "ML Engine · Browser fallback forest · alert detail";
    }
    const features = result.features || {};
    setAlertImpactBar("detail-bar-rain", "detail-val-rain", Number(features.rainPop || 0) * 100, `${Math.round(Number(features.rainPop || 0) * 100)}%`);
    setAlertImpactBar("detail-bar-wind", "detail-val-wind", Number(features.wind || 0) * 100, `${weather.wind} m/s`);
    setAlertImpactBar("detail-bar-vis", "detail-val-vis", Number(features.visImpact || 0) * 100, `${weather.visibility} km`);
    setAlertImpactBar("detail-bar-heat", "detail-val-heat", Number(features.tempStress || 0) * 100, `${weather.temp}°C`);
  }

  // Alert Detail 页面渲染：基础字段 + AI 结果 + 摄像头证据
  async function renderAlertDetailPage() {
    const target = document.getElementById("alert-detail-content");
    if (!target) return;
    const incident = state.alertIncidentById.get(String(state.selectedAlertIncidentId || "")) ||
      state.dashboardIncidents.find((x) => String(x.id || "") === String(state.selectedAlertIncidentId || ""));
    if (!incident) {
      target.innerHTML = "<p>Incident not found.</p>";
      return;
    }

    target.innerHTML = `
      <h3>${escapeHtml(incidentTitle(incident))}</h3>
      <div class="alert-detail-grid">
        <div class="alert-detail-item"><span class="k">LOCATION</span><span class="v" id="detail-location">${escapeHtml(incident.area || "Unknown area")}</span></div>
        <div class="alert-detail-item"><span class="k">REPORTED TIME</span><span class="v" id="detail-time">${escapeHtml(formatIncidentTime(incident.createdAt))}</span></div>
        <div class="alert-detail-item"><span class="k">EST. SPREAD</span><span class="v">${escapeHtml(getIncidentSpreadText(incident))}</span></div>
        <div class="alert-detail-item"><span class="k">Estimated Impact Time</span><span class="v">${escapeHtml(getIncidentDurationText(incident))}</span></div>
        <div class="alert-detail-item"><span class="k">POSSIBLE REASON (AI)</span><span class="v" id="detail-reason">Generating summary...</span></div>
        <div class="alert-detail-item"><span class="k">Estimated Clear Time (AI)</span><span class="v" id="detail-duration">Generating summary...</span></div>
      </div>
      ${incident.cameraName || incident.imageLink ? `
      <div class="alert-detail-camera">
        <h4>Related Camera</h4>
        <p>${escapeHtml(incident.cameraName || "Nearby camera")}</p>
        ${incident.imageLink ? `<img src="${escapeHtml(incident.imageLink)}" alt="Incident camera evidence" loading="lazy" />` : ""}
      </div>
      ` : ""}
      <div class="ml-traffic-impact" style="margin-top:16px;">
        <h4 class="subsection-title" style="margin-bottom:14px;">TRAFFIC IMPACT PREDICTION</h4>
        <div class="impact-main-row">
          <div class="impact-ring-container">
            <div class="impact-ring impact-low" id="detail-impact-ring">
              <div class="impact-ring-inner">
                <span class="impact-score-num" id="detail-impact-score">--</span>
                <span class="impact-score-denom">/10</span>
              </div>
            </div>
            <div class="impact-ring-label">Impact Score</div>
          </div>
          <div class="impact-info">
            <div class="impact-level-badge impact-low" id="detail-impact-level">Generating prediction...</div>
            <p class="impact-summary" id="detail-impact-summary">Loading weather-based traffic impact prediction for this incident.</p>
            <div class="impact-meta-row">
              <div class="impact-meta-item">
                <span class="impact-meta-icon">⏱</span>
                <div>
                  <div class="impact-meta-label">ESTIMATED CLEARING TIME</div>
                  <div class="impact-meta-val" id="detail-impact-clearing">--</div>
                </div>
              </div>
              <div class="impact-meta-item">
                <span class="impact-meta-icon">🎯</span>
                <div>
                  <div class="impact-meta-label">MODEL CONFIDENCE</div>
                  <div class="impact-meta-val" id="detail-impact-confidence">--%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="impact-factors-panel">
          <div class="impact-factors-heading">CONTRIBUTING WEATHER FACTORS</div>
          <div class="factor-row">
            <span class="factor-label">Rain Probability</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-rain" id="detail-bar-rain" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-rain">--%</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Wind Speed</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-wind" id="detail-bar-wind" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-wind">-- m/s</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Visibility Impact</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-vis" id="detail-bar-vis" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-vis">-- km</span>
          </div>
          <div class="factor-row">
            <span class="factor-label">Heat Stress</span>
            <div class="factor-bar-track"><div class="factor-bar factor-bar-heat" id="detail-bar-heat" style="width:0%"></div></div>
            <span class="factor-val" id="detail-val-heat">--°C</span>
          </div>
        </div>
        <div class="ml-model-badge" id="detail-impact-engine">ML Engine · loading...</div>
      </div>
    `;

    const summary = await fetchGeminiIncidentSummary(incident);
    const locationEl = document.getElementById("detail-location");
    const timeEl = document.getElementById("detail-time");
    const reasonEl = document.getElementById("detail-reason");
    const durationEl = document.getElementById("detail-duration");
    if (!reasonEl || String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
    if (locationEl) locationEl.textContent = summary.location;
    if (timeEl) timeEl.textContent = summary.time;
    reasonEl.textContent = summary.reason;
    if (durationEl) durationEl.textContent = summary.duration;

    try {
      const { prediction, weather } = await fetchAlertTrafficImpactPrediction(incident);
      if (String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
      renderAlertTrafficImpactResult(prediction, weather);
    } catch (err) {
      if (String(incident.id || "") !== String(state.selectedAlertIncidentId || "")) return;
      const summaryEl = document.getElementById("detail-impact-summary");
      const badgeEl = document.getElementById("detail-impact-level");
      const engineEl = document.getElementById("detail-impact-engine");
      if (badgeEl) {
        badgeEl.textContent = "Prediction unavailable";
        badgeEl.className = "impact-level-badge impact-moderate";
      }
      if (summaryEl) summaryEl.textContent = `Traffic impact prediction unavailable: ${err.message}`;
      if (engineEl) engineEl.textContent = "ML Engine · unavailable";
    }
  }
