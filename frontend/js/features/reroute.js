function getPin(source, type = "") {
  let iconUrl = "https://cdn-icons-png.flaticon.com/128/12342/12342528.png";
  let borderColor = "#f59e0b"; // Default Orange
  const s = (source || "").toUpperCase();
  const t = (type || "").toLowerCase();
  let size = 24;
  let imgSize = 18;

  if (s === 'HOTSPOT') {
    iconUrl = "https://cdn-icons-png.flaticon.com/128/14025/14025479.png";
    borderColor = "#7c3aed";
    size = 18;
    imgSize = 14;
  }
  else if (s === 'SYSTEM_JAM') {
    iconUrl = "https://cdn-icons-png.flaticon.com/128/3591/3591262.png";
    borderColor = "#ef4444";
  }
  else if (s === 'COMMUNITY') {
    iconUrl = "https://cdn-icons-png.flaticon.com/128/2546/2546749.png";
    borderColor = "#3b82f6";
  }
  else if (s === 'LTA') {
    if (t.includes('accident')) {
      iconUrl = "https://cdn-icons-png.flaticon.com/128/4201/4201973.png";
      borderColor = "#ef4444";
    } else if (t.includes('work') || t.includes('road')) {
      iconUrl = "https://cdn-icons-png.flaticon.com/128/6747/6747113.png";
      borderColor = "#f59e0b";
    }
  }

  return L.divIcon({
    className: 'floating-incident-pin',
    html: `
        <div style="
            background: white; 
            border: 2px solid ${borderColor}; 
            width: ${size}px; height: ${size}px; 
            border-radius: 50%; 
            display: flex; align-items: center; justify-content: center; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.15);
        ">
            <img src="${iconUrl}" style="width: ${imgSize}px; height: ${imgSize}px;" />
        </div>`,
    iconSize: [size, size],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function showHabitModePicker() {
  document.querySelector(".habit-mode-group")?.classList.remove("hidden");

  const title = document.getElementById("habit-tab-title");
  if (title) title.style.display = "block";

  const dateWrap = document.getElementById("habit-plan-datetime-wrap");
  if (dateWrap) {
    dateWrap.classList.toggle("hidden", state.habitPlanMode === "now");
  }

  document.getElementById("habit-current-mode-wrap")?.classList.add("hidden");

  const selectedWrap = document.getElementById("habit-plan-selected-wrap");
  if (selectedWrap) selectedWrap.style.display = "none";

  const routesSection = document.getElementById("habit-routes-section");
  if (routesSection) routesSection.style.display = "block";

  const divider = document.getElementById("habit-plan-divider");
  if (divider) divider.style.display = "block";

  const helper = document.getElementById("habit-plan-helper");
  if (helper) {
    helper.style.display = "block";
    helper.innerHTML = "Choose a planning mode, then select a saved route below.";
  }
}

function showHabitSelectedMode() {
  const mode = (state.habitPlanMode || "now").toUpperCase();

  document.querySelector(".habit-mode-group")?.classList.add("hidden");

  const title = document.getElementById("habit-tab-title");
  if (title) title.style.display = "none";

  document.getElementById("habit-plan-datetime-wrap")?.classList.add("hidden");

  const modeWrap = document.getElementById("habit-current-mode-wrap");
  const modeLabel = document.getElementById("habit-current-mode-label");

  if (modeLabel) modeLabel.textContent = mode === "BEST" ? "SMART" : mode;
  if (modeWrap) modeWrap.classList.remove("hidden");

  const helper = document.getElementById("habit-plan-helper");
  if (helper) helper.style.display = "none";

  const selectedWrap = document.getElementById("habit-plan-selected-wrap");
  if (selectedWrap) selectedWrap.style.display = "block";

  const routesSection = document.getElementById("habit-routes-section");
  if (routesSection) routesSection.style.display = "none";

  const divider = document.getElementById("habit-plan-divider");
  if (divider) divider.style.display = "none";
}

document.getElementById("habit-change-mode-btn")?.addEventListener("click", showHabitModePicker);

// Activate panel to allow user to switch route viewer mode
function initHabitPlannerPanel() {
  const modeBtns = document.querySelectorAll(".habit-mode-btn");
  const dtWrap = document.getElementById("habit-plan-datetime-wrap");
  const helper = document.getElementById("habit-plan-helper");
  const dtInput = document.getElementById("habit-plan-datetime");

  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      modeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const mode = btn.dataset.mode;
      state.habitPlanMode = mode;

      if (mode === "now") {
        dtWrap.classList.add("hidden");
        helper.innerHTML = "Using current traffic conditions. <br> <b>No route currently selected.</b>";
      } else if (mode === "leave") {
        dtWrap.classList.remove("hidden");
        helper.innerHTML = "Select a departure time. <br> <b>No route currently selected.</b>";
      } else {
        dtWrap.classList.remove("hidden");
        helper.innerHTML = "Select your target arrival time. <br> <b>No route currently selected.</b>";
      }
    });
  });

  dtInput?.addEventListener("change", () => {
    state.habitPlanDatetime = dtInput.value || null;
  });
}

// Helper functions for Habit Routes
async function fetchCurrentTypicalEta(route, liveResult) {
  const segmentMatches = liveResult?.match_info?.segment_matches || [];

  const segmentSequence = segmentMatches.map(m =>
    m ? { link_id: m.link_id, road_name: m.road_name } : null
  );

  if (!segmentSequence.length) return null;

  const now = new Date();
  const day = now.getDay();
  const bucket = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15);

  try {
    const res = await window.fastAuthFetch("/api/ml/habit-routes/historical", {
      method: "POST",
      body: JSON.stringify({
        segment_sequence: segmentSequence,
        day,
        bucket,
        distance_m: route.distance_m
      })
    });

    if (!res.ok) throw new Error("Historical ETA failed");

    const data = await res.json();
    return data?.summary?.predicted_eta ?? null;
  } catch (err) {
    console.warn("Typical ETA unavailable:", err);
    return null;
  }
}

function getDelayComparison(currEta, typicalEta) {
  const curr = Number(currEta);
  const typical = Number(typicalEta);

  if (!Number.isFinite(curr) || !Number.isFinite(typical)) {
    return null;
  }

  const delta = curr - typical;

  let label = "Normal";
  let cssClass = "Normal";

  if (delta >= 8) {
    label = "Much slower than usual";
    cssClass = "bad";
  } else if (delta >= 3) {
    label = "Slightly slower than usual";
    cssClass = "warning";
  } else if (delta <= -3) {
    label = "Faster than usual";
    cssClass = "good";
  }

  return {
    delta,
    label,
    cssClass
  };
}

function renderTypicalEtaGauge(summary, typicalEta) {
  const currEta = Number(summary?.curr_eta);
  const typical = Number(typicalEta);

  if (!Number.isFinite(currEta) || !Number.isFinite(typical)) {
    return `
      <div class="route-typical-gauge-wrap unavailable">
        <div class="route-typical-gauge">
          <div class="route-gauge-main">--</div>
        </div>
        <div class="route-gauge-text">
          <div class="route-gauge-title">Typical comparison unavailable</div>
          <div class="route-gauge-note">Historical route pattern could not be loaded.</div>
        </div>
      </div>
    `;
  }

  const delta = currEta - typical;
  const delayMin = Math.max(0, delta);

  const delayPct = Math.min(100, Math.round((delayMin / 30) * 100));
  const healthyPct = 100 - delayPct;

  let delayColor = "#22c55e";
  let label = "Normal traffic";

  if (delayMin >= 15) {
    delayColor = "#ef4444";
    label = "Heavy delay vs usual";
  } else if (delayMin >= 5) {
    delayColor = "#f59e0b";
    label = "Slower than usual";
  } else if (delayMin > 0) {
    delayColor = "#f59e0b";
    label = "Slight delay vs usual";
  }

  const delayDisplay = delayMin < 10
    ? delayMin.toFixed(1)
    : String(Math.round(delayMin));

  const note = delayMin > 0
    ? `${delayDisplay} min slower than typical for this time`
    : `No extra delay vs typical for this time`;

  return `
    <div class="route-typical-gauge-wrap">
      <div class="route-typical-gauge" style="--healthy:${healthyPct}%; --delay-color:${delayColor};">
        <div class="route-gauge-main">+${delayMin.toFixed(1)}</div>
      </div>

      <div class="route-gauge-text">
        <div class="route-gauge-title">${escapeHtml(label)}</div>
        <div class="route-gauge-note">${escapeHtml(note)}</div>
      </div>
    </div>
  `;
}

function getRouteConditionBreakdownFromCurrentMatchInfo() {
  const segmentMatches = state.currMatchInfo?.segment_matches || [];

  const bands = segmentMatches
    .filter(m => m && m.prediction)
    .map(m => Number(m.prediction.predicted_val))
    .filter(Number.isFinite);

  const total = bands.length;

  if (!total) {
    return {
      clearPct: 0,
      moderatePct: 0,
      congestedPct: 0,
      clear: 0,
      moderate: 0,
      congested: 0,
      total: 0
    };
  }

  const congested = bands.filter(v => v <= 3).length;
  const moderate = bands.filter(v => v > 3 && v <= 5).length;
  const clear = bands.filter(v => v > 5).length;

  return {
    clearPct: Math.round((clear / total) * 100),
    moderatePct: Math.round((moderate / total) * 100),
    congestedPct: Math.round((congested / total) * 100),
    clear,
    moderate,
    congested,
    total
  };
}

function renderRouteConditionBar(title = "ROUTE CONDITION") {
  const b = getRouteConditionBreakdownFromCurrentMatchInfo();

  if (!b.total) {
    return `
      <div class="route-panel-section">
        <div class="route-panel-section-title">${escapeHtml(title)}</div>
        <div class="route-empty-note">No matched speedband segments available.</div>
      </div>
    `;
  }

  return `
    <div class="route-panel-section">
      <div class="route-panel-section-title">ROUTE CONDITION</div>

      <div class="route-condition-bar">
        <div class="route-cond-clear" style="width:${b.clearPct}%"></div>
        <div class="route-cond-moderate" style="width:${b.moderatePct}%"></div>
        <div class="route-cond-congested" style="width:${b.congestedPct}%"></div>
      </div>

      <div class="route-condition-legend">
        <span>Clear <b>${b.clearPct}%</b></span>
        <span>Moderate <b>${b.moderatePct}%</b></span>
        <span>Congested <b>${b.congestedPct}%</b></span>
      </div>
    </div>
  `;
}

function getMostAffectedRoads(limit = 3) {
  const segmentMatches = state.currMatchInfo?.segment_matches || [];

  const rows = segmentMatches
    .filter(m => m && m.prediction)
    .map(m => {
      const currentBand = Number(m.prediction.current_val);
      const predictedBand = Number(m.prediction.predicted_val);
      const drop = Number.isFinite(currentBand) && Number.isFinite(predictedBand)
        ? currentBand - predictedBand : 0;


      return {
        roadName: m.display_name || m.road_name || "LTA Road",
        currentBand,
        predictedBand,
        drop
      };
    })
    .filter(r => Number.isFinite(r.predictedBand));

  const bestByRoad = new Map();

  rows.forEach(r => {
    const key = r.roadName.toUpperCase();
    const existing = bestByRoad.get(key);

    if (
      !existing ||
      r.predictedBand < existing.predictedBand ||
      (r.predictedBand === existing.predictedBand && r.drop > existing.drop)
    ) {
      bestByRoad.set(key, r);
    }
  });

  return Array.from(bestByRoad.values())
    .sort((a, b) => {
      if (a.predictedBand !== b.predictedBand) {
        return a.predictedBand - b.predictedBand;
      }
      return b.drop - a.drop;
    })
    .slice(0, limit);
}

function getBandStatusText(band) {
  const b = Number(band);
  if (!Number.isFinite(b)) return "-";
  if (b <= 3) return "Congested";
  if (b <= 5) return "Moderate";
  return "Clear";
}

function renderMostAffectedRoadsCard(title = "MOST AFFECTED ROADS", mode = "now") {
  const roads = getMostAffectedRoads(3);

  if (!roads.length) {
    return `
      <div class="route-panel-section">
        <div class="route-panel-section-title">${escapeHtml(title)}</div>
        <div class="route-empty-note">No affected roads detected.</div>
      </div>
    `;
  }

  return `
    <div class="route-panel-section">
      <div class="route-panel-section-title">${escapeHtml(title)}</div>

      <div class="route-affected-list">
        ${roads.map(r => {
    const bandLine = mode === "leave"
      ? `Typical Band ${Number.isFinite(r.predictedBand) ? r.predictedBand : "-"}`
      : `Band ${Number.isFinite(r.currentBand) ? r.currentBand : "-"} → ${Number.isFinite(r.predictedBand) ? r.predictedBand : "-"}`;

    return `
            <div class="route-affected-row">
              <div>
                <strong>${escapeHtml(r.roadName)}</strong>
                <span>${bandLine}</span>
              </div>
              <b>${getBandStatusText(r.predictedBand)}</b>
            </div>
          `;
  }).join("")}
      </div>
    </div>
  `;
}


function getEtaTrendText(currEta, predictedEta) {
  const curr = Number(currEta);
  const pred = Number(predictedEta);

  if (!Number.isFinite(curr) || !Number.isFinite(pred)) return "Forecast unavailable";

  const diff = pred - curr;

  if (diff >= 3) return `Worsening by ${diff.toFixed(1)} min`;
  if (diff <= -3) return `Improving by ${Math.abs(diff).toFixed(1)} min`;
  return "Stable traffic forecast";
}

function renderEtaForecastCard(summary, typicalEta = null) {
  const currEta = Number(summary?.curr_eta);
  const predEta = Number(summary?.predicted_eta);
  const typical = Number(typicalEta);
  const trendText = getEtaTrendText(currEta, predEta);

  return `
    <div class="route-panel-section">
      <div class="route-panel-section-title">
        ETA FORECAST: <span class="route-panel-section-text">${escapeHtml(trendText)}</span>
      </div>

      <div class="route-panel-row">
        <span>Now</span>
        <strong>${Number.isFinite(currEta) ? currEta.toFixed(1) : "-"} min</strong>
      </div>

      <div class="route-panel-row">
        <span>T+15</span>
        <strong>${Number.isFinite(predEta) ? predEta.toFixed(1) : "-"} min</strong>
      </div>

      <div class="route-panel-row">
        <span>Typical</span>
        <strong>${Number.isFinite(typical) ? typical.toFixed(1) : "-"} min</strong>
      </div>
    </div>
  `;
}

function renderRouteSignals(intel, fuelPrice) {
  const s = intel?.summary || {};
  const weatherIcon = s.is_raining_anywhere ? "🌧️" : "🌤️";

  return `
    <div class="route-panel-section">
      <div class="route-panel-section-title">LIVE SIGNALS</div>

      <div class="route-signal-grid">
        <div>
          <span>🚧 Incidents</span>
          <strong>${s.total_incidents ?? 0}</strong>
        </div>
        <div>
          <span>⚠️ Hotspots</span>
          <strong>${s.total_hotspots ?? 0}</strong>
        </div>
        <div>
          <span> ${weatherIcon} Weather</span>
          <strong>${s.is_raining_anywhere ? "Rainy" : "Clear"}</strong>
        </div>
        <div>
          <span>⛽ Fuel</span>
          <strong>$${fuelPrice}</strong>
        </div>
      </div>
    </div>
  `;
}


// For loading analysis results into the analysis panel
function renderHabitPanelResult(route, summary, mode, intel = null, extra = {}) {
  const panel = document.getElementById("habit-plan-results");
  const helper = document.getElementById("habit-plan-helper");
  if (!panel) return;

  const name = route.route_name || `${route.from_label} → ${route.to_label}`;
  const holiday = extra.holidayName
    ? `<div style="color: #ea580c; background: #fff7ed; padding: 4px 8px; border-radius: 4px; border: 1px solid #fdba74; font-size: 11px; font-weight: bold; margin-bottom: 8px; display: inline-block;">
             ${extra.holidayName} (Holiday)
           </div><br>`
    : "";

  const fuelPrice = getFuelCostForHabit(route.distance_m);

  let healthHtml = "";
  if (intel && intel.summary) {
    const s = intel.summary;
    healthHtml = `
            <div style="padding-bottom: 12px; background: #f8fafc;>
                <div style="font-size: 10px; font-weight: 800; color: #64748b; margin-bottom: 5px;"></div>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
                    <span>🚧 Incidents: <b>${s.total_incidents}</b></span>
                    <span>🌤️ Weather: <b>${s.is_raining_anywhere ? 'Rainy Regions' : 'Clear Skies'}</b></span>
                    <span>⚠️ Hotspots: <b>${s.total_hotspots} detected</b></span>
                    <span>⛽ Est. Fuel: <b>$${fuelPrice}</b></span>
                </div>
            </div>
        `;
  }

  const simButton = `
    <div class="route-primary-action">
      <button id="sim-control-btn" onclick="startJourneySimulation()">
      <span class="btn-icon">▶</span>
        Start Journey
      </button>
      <div id="sim-status-clock" style="display:none;">
        SIM TIME: <span id="sim-clock-val">00:00</span>
      </div>
    </div>
  `;


  if (mode === "now") {
    const typicalEta = extra.typicalEta ?? null;
    const gaugeHtml = renderTypicalEtaGauge(summary, typicalEta);
    const etaHtml = renderEtaForecastCard(summary, typicalEta);
    const conditionHtml = renderRouteConditionBar();
    const signalsHtml = renderRouteSignals(intel, fuelPrice);
    const bottleneckHtml = renderMostAffectedRoadsCard("MOST AFFECTED ROADS", "now");

    panel.innerHTML = `
  <div class="route-insight-panel">
    <div class="route-insight-kicker">FAST ROUTE INSIGHT</div>
    <div class="route-insight-title">${escapeHtml(name)}</div>

    ${gaugeHtml}
    ${simButton}

    ${etaHtml}

    

    ${conditionHtml}
    ${signalsHtml}
    ${bottleneckHtml}
  </div>
`;
  }

  if (mode === "leave") {
    const conditionHtml = renderRouteConditionBar("EXPECTED ROUTE CONDITION");
    const affectedHtml = renderMostAffectedRoadsCard("EXPECTED AFFECTED ROADS", "leave");
    const advice = getLeaveAtAdvice(summary);

    panel.innerHTML = `
    <div class="route-insight-panel">
      <div class="route-insight-kicker">FAST ROUTE INSIGHT</div>
      <div class="route-insight-title">${escapeHtml(name)}</div>

      <div class="route-panel-section">
        <div class="route-panel-section-title">PLANNED DEPARTURE</div>

        <div class="route-panel-row">
          <span>Leave at</span>
          <strong>${escapeHtml(getSelectedDepartureText())}</strong>
        </div>

        <div class="route-panel-row">
          <span>Typical ETA</span>
          <strong>${Number(summary?.predicted_eta || 0).toFixed(1)} min</strong>
        </div>

        <div class="route-panel-row">
          <span>Expected traffic</span>
          <strong>${escapeHtml(summary?.status || "-")}</strong>
        </div>
      </div>

      ${conditionHtml}
      ${affectedHtml}

      <div class="route-panel-section">
        <div class="route-panel-section-title">PLANNING ADVICE</div>
        <div class="route-empty-note">${escapeHtml(advice)}</div>
      </div>
    </div>
  `;
  }

  if (mode === "best") {
    const conditionHtml = renderRouteConditionBar("EXPECTED ROUTE CONDITION");
    const affectedHtml = renderMostAffectedRoadsCard("EXPECTED AFFECTED ROADS", "leave");

    const eta = Number(summary?.predicted_eta);
    const etaText = Number.isFinite(eta) ? eta.toFixed(1) : "-";

    const holiday = extra?.holidayName
      ? `<div class="route-empty-note">Holiday profile: ${escapeHtml(extra.holidayName)}</div>`
      : "";

    panel.innerHTML = `
    <div class="route-insight-panel">
      <div class="route-insight-kicker">FAST ROUTE INSIGHT</div>
      <div class="route-insight-title">${escapeHtml(name)}</div>

      <div class="route-panel-section">
        <div class="route-panel-section-title">RECOMMENDED DEPARTURE</div>

        ${holiday}

        <div class="route-panel-row">
          <span>Leave at</span>
          <strong>${escapeHtml(extra?.departureTime || "-")}</strong>
        </div>

        <div class="route-panel-row">
          <span>Arrive by</span>
          <strong>${escapeHtml(extra?.arrivalTime || "-")}</strong>
        </div>

        <div class="route-panel-row">
          <span>Best ETA</span>
          <strong>${etaText} min</strong>
        </div>
      </div>

      ${extra?.trendHtml || ""}

      ${conditionHtml}
      ${affectedHtml}

    
    </div>
  `;
  }
  helper.innerHTML = "";
}

function getSelectedDepartureText() {
  const value = document.getElementById("habit-plan-datetime")?.value;
  if (!value) return "Selected time";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getLeaveAtAdvice(summary) {
  const status = String(summary?.status || "").toLowerCase();
  const eta = Number(summary?.predicted_eta);

  if (status.includes("congest") || eta >= 45) {
    return "Allocate extra travel time for this departure.";
  }

  if (status.includes("moderate") || status.includes("delay")) {
    return "Some delays are possible around this time.";
  }

  return "Normal travel time should be sufficient.";
}


async function loadHabitRoutesFromServer() {


  const res = await window.fastAuthFetch("/api/habit-routes");
  const data = await res.json();

  if (!res.ok) {
    console.error("Habit routes load failed:", data);
    state.habitSavedRoutes = [];
    renderHabitRoutesList();
    return;
  }

  // Load all the required data and render
  state.habitSavedRoutes = (data.routes || []).map((r) => ({
    id: r.id,
    from: r.from_label || "Unknown start",
    to: r.to_label || "Unknown destination",
    coords: r.coords_json || [],
    distance_m: r.distance_m || 0,
    link_ids: r.link_ids || [],
    alert_enabled: r.alert_enabled,
    alert_start_time: r.alert_start_time,
    alert_end_time: r.alert_end_time,
    route_name: r.route_name || ""
  }));

  renderHabitRoutesList();
}

// Render the data
// Should load the list of saved habit routes, display the relevant details 
// and put action buttons for each row


function renderHabitRoutesList() {
  const container = document.getElementById("habit-routes-list");
  if (!container) return;

  if (!state.habitSavedRoutes.length) {
    container.innerHTML = `<div class="habit-route-card">No saved habit routes yet.</div>`;
    return;
  }

  container.innerHTML = "";

  state.habitSavedRoutes.forEach((route, i) => {
    const card = document.createElement("div");
    card.className = "habit-route-card";

    const routeDisplayName = route.route_name || "My Route";
    const directions = `${escapeHtml(route.from)} → ${escapeHtml(route.to)}`;

    // Update the list to enable users to update name of their route
    card.innerHTML = `
      <div style="padding: 16px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
            <div style="flex: 1; padding-right: 10px;">
                <div class="habit-route-title" id="title-${route.id}" style="font-weight: 700; font-size: 16px; color: #1e293b; line-height: 1.2;">
                    ${escapeHtml(route.route_name || "My Route")}
                </div>
                <div style="font-size: 12px; color: #64748b; line-height: 1.4; margin-top: 4px;">
                    ${escapeHtml(route.from)} → ${escapeHtml(route.to)}
                </div>
            </div>
            <button type="button" class="btn-rename-edit" style="border:none; background:none; color:#94a3b8; cursor:pointer; padding-left:8px;">
              ✎
            </button>
        </div>

        <div class="habit-rename-group hidden mb-3 p-2 bg-light rounded" id="rename-group-${route.id}">
            <input type="text" class="form-control form-control-sm mb-2 habit-new-name-input" value="${escapeHtml(route.route_name || "")}">
            <button class="btn btn-sm btn-primary habit-confirm-rename">Save</button>
            <button class="btn btn-sm btn-link habit-cancel-rename text-muted">Cancel</button>
        </div>

        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 12px;">${(Number(route.distance_m || 0) / 1000).toFixed(1)} km</div>

        <div id="analysis-container-${route.id}" class="hidden" style="border-radius: 8px; padding: 10px; margin-bottom: 12px; border: 1px solid #e2e8f0;">
            <div id="analysis-loader-${route.id}" class="text-center p-2" style="font-size: 11px; color: #64748b;">
            </div>
            <div id="analysis-content-${route.id}" class="hidden">
                </div>
        </div>

  

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
            <button class="btn btn-sm btn-outline-primary habit-load-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">LOAD</button>
            <button class="btn btn-sm btn-outline-secondary habit-alerts-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">ALERTS</button>
            <button class="btn btn-sm btn-outline-danger habit-delete-btn" style="font-weight: 600; font-size: 11px; padding: 6px 0;">DELETE</button>
        </div>

        <div class="habit-route-settings hidden mt-3 p-3" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; box-sizing: border-box; width: 100%; overflow: hidden;">
            <label style="font-size: 12px; display: block; margin-bottom: 8px; font-weight: 600; color: #475569;">
                <input type="checkbox" class="habit-alert-toggle" ${route.alert_enabled ? "checked" : ""}> Monitor Traffic
            </label>
            
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: #64748b; margin-bottom: 12px; width: 100%;">
                <span>Window:</span>
                <input type="time" class="habit-alert-start" style="flex: 1; min-width: 70px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px;" value="${route.alert_start_time || "07:30"}">
                <span>to</span>
                <input type="time" class="habit-alert-end" style="flex: 1; min-width: 70px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px;" value="${route.alert_end_time || "09:00"}">
            </div>
            
            <button type="button" class="btn btn-dark habit-save-settings-btn w-100" style="font-size: 11px; font-weight: 700; padding: 8px; box-sizing: border-box;">SAVE SETTINGS</button>
        </div>
      </div>
    `;
    const renameGroup = card.querySelector(`#rename-group-${route.id}`);
    const titleEl = card.querySelector(`#title-${route.id}`);

    card.querySelector(".btn-rename-edit").onclick = () => renameGroup.classList.remove("hidden");
    card.querySelector(".habit-cancel-rename").onclick = () => renameGroup.classList.add("hidden");

    // send the patch request
    card.querySelector(".habit-confirm-rename").onclick = async () => {
      // get the new name
      const newName = card.querySelector(".habit-new-name-input").value.trim();
      if (!newName) return;

      const res = await window.fastAuthFetch(`/api/habit-routes/${route.id}`, {
        method: "PATCH",
        body: JSON.stringify({ route_name: newName })
      });

      if (res.ok) {
        titleEl.innerText = newName;
        renameGroup.classList.add("hidden");
        route.route_name = newName;
      } else {
        alert("Failed to rename route.");
      }
    };
    // Handle save, update alerts and delete button
    const settingsPanel = card.querySelector(".habit-route-settings");


    // On loading a route
    card.querySelector(".habit-load-btn").addEventListener("click", async () => {

      if (state.journeyActive) {
        stopJourneySimulation();
      }

      if (state.routeLayer) state.routeLayer.clearLayers();
      if (state.plannerLayer) state.plannerLayer.clearLayers();

      // Once a route is loaded, show the analysis panel
      document.getElementById('habit-plan-selected-wrap').style.display = 'block';

      const mode = state.habitPlanMode || "now";

      if (mode === "now") {
        const panel = document.getElementById("habit-plan-results");
        panel.innerHTML = "Loading...";

        const result = await drawHabitRouteOnMap(route);
        const typicalEta = await fetchCurrentTypicalEta(route, result);

        showHabitSelectedMode();

        try {
          const intelRes = await window.fastAuthFetch(`/api/ml/route-intel`, {
            method: "POST",
            body: JSON.stringify({ link_ids: route.link_ids })
          });
          const intelData = await intelRes.json()
          console.log(intelData);

          state.currentRouteIntel = intelData.details;

          if (result && result.summary) {
            renderHabitPanelResult(route, result.summary, "now", intelData, {
              typicalEta
            });
          }
        } catch (err) {
          console.error("Failed to retrieve intel", err);
          if (result && result.summary) {
            renderHabitPanelResult(route, result.summary, "now", null, {
              typicalEta
            });
          }
        }
      }
      else if (mode === "leave") {
        await runHabitRouteLeaveAt(route, card);
      }
      else if (mode === "best") {
        await runHabitRouteBestTime(route, card);
      }


    });






    card.querySelector(".habit-alerts-btn").addEventListener("click", () => {
      settingsPanel.classList.toggle("hidden");
    });

    card.querySelector(".habit-save-settings-btn").addEventListener("click", async () => {
      await saveHabitRouteSettings(route.id, card);
    });

    card.querySelector(".habit-delete-btn").addEventListener("click", async () => {
      await deleteHabitRoute(route.id);
    });

    container.appendChild(card);
  });
}

// Plan Btn for Future planning
async function runHabitRouteLeaveAt(route, card) {
  const input = document.getElementById("habit-plan-datetime");
  if (!input.value) return alert("Select a time for the 'Future Plan'!");

  const selectedValue = document.getElementById("habit-plan-datetime")?.value;
  if (!selectedValue) return alert("Select a departure time first.");
  const selectedTime = new Date(selectedValue);
  const day = selectedTime.getDay();
  const bucket = Math.floor((selectedTime.getHours() * 60 + selectedTime.getMinutes()) / 15); // The 15-min fix

  const analysisPanel = card.querySelector(`#analysis-container-${route.id}`);
  const loader = card.querySelector(`#analysis-loader-${route.id}`);
  const content = card.querySelector(`#analysis-content-${route.id}`);

  analysisPanel.classList.remove("hidden");
  loader.classList.remove("hidden");
  content.classList.add("hidden");



  const liveRes = await window.fastAuthFetch("/api/ml/habit-routes/analyze", {
    method: "POST",
    body: JSON.stringify({ coords_json: route.coords })
  });
  const liveData = await liveRes.json();

  // Extract the exact sequence of IDs and Names
  const segmentSequence = liveData.match_info.segment_matches.map(m =>
    m ? { link_id: m.link_id, road_name: m.road_name } : null
  );

  // SEND SKELETON TO DUCKDB
  const res = await window.fastAuthFetch("/api/ml/habit-routes/historical", {
    method: "POST",
    body: JSON.stringify({
      segment_sequence: segmentSequence,
      day: day,
      bucket: bucket,
      distance_m: route.distance_m
    })
  });

  const historicalData = await res.json();

  // Draw on map
  const result = await drawHabitRouteOnMap({
    ...route,
    is_historical: true,
    historical_payload: historicalData
  });

  if (result && result.summary) {
    renderHabitPanelResult(route, result.summary, "leave", null);
  }

  // Update the UI panel with Historical Summary
  // if (result && result.summary) {
  //   const s = result.summary;
  //   loader.classList.add("hidden");
  //   content.classList.remove("hidden");

  //   content.innerHTML = `
  //         <div style="border: 1px solid #3b82f6; padding: 10px; font-family: sans-serif;">
  //             <div style="font-weight: bold; margin-bottom: 5px; color: #1e40af;">
  //                 TYPICAL STATE: ${s.status}
  //             </div>
  //             <div style="font-size: 13px; color: #1e3a8a;">
  //                 <div><b>Typical ETA:</b> ${s.predicted_eta}m</div>
  //                 <div style="font-size: 10px; margin-top: 4px; color: #64748b;">
  //                     Based on 1-month historical data
  //                 </div>
  //             </div>
  //         </div>
  //       `;
  // }
};

// End Future Plan

// Start Best Time Planning
async function runHabitRouteBestTime(route, card) {
  const input = document.getElementById("habit-plan-datetime");
  const selectedValue = input?.value;
  if (!selectedValue) return alert("Select your 'Reach By' target time first.");

  const targetTime = new Date(selectedValue);
  const day = targetTime.getDay();

  const [datePart, timePart] = selectedValue.split("T");
  const [hours, minutes] = timePart.split(":").map(Number);
  const targetBucket = Math.floor((hours * 60 + minutes) / 15);

  const PUBLIC_HOLIDAYS = {
    "2026-01-01": "New Year's Day",
    "2026-02-17": "Chinese New Year",
    "2026-02-18": "Chinese New Year",
    "2026-03-21": "Hari Raya Puasa",
    "2026-04-03": "Good Friday",
    "2026-04-20": "Demo Holiday",
    "2026-05-01": "Labour Day",
    "2026-05-27": "Hari Raya Haji",
    "2026-05-31": "Vesak Day",
    "2026-06-01": "Vesak Day (Observed)",
    "2026-08-09": "National Day",
    "2026-08-10": "National Day (Observed)",
    "2026-11-08": "Deepavali",
    "2026-11-09": "Deepavali (Observed)",
    "2026-12-25": "Christmas Day"
  };

  const dateStr = selectedValue.split("T")[0];

  let dayProfile = "standard";
  let holidayName = null;

  const current = new Date(dateStr);
  const tomorrow = new Date(current);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const yesterday = new Date(current);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (PUBLIC_HOLIDAYS[dateStr]) {
    dayProfile = "holiday";
    holidayName = PUBLIC_HOLIDAYS[dateStr]
  }
  else if (PUBLIC_HOLIDAYS[tomorrowStr]) {
    dayProfile = "eve";
    holidayName = `${PUBLIC_HOLIDAYS[tomorrowStr]} Eve`;
  }
  else if (PUBLIC_HOLIDAYS[yesterdayStr]) {
    dayProfile = "post";
    holidayName = `Post-${PUBLIC_HOLIDAYS[yesterdayStr]}`
  }


  // Search window
  const MIN_DATA_BUCKET = 24;
  const startBucket = Math.max(MIN_DATA_BUCKET, targetBucket - 12);
  const endBucket = targetBucket;

  const panel = document.getElementById("habit-plan-results");
  panel.innerHTML = `<div class="p-4 animate-pulse text-slate-400">Scanning historical traffic...</div>`;

  try {
    const liveRes = await window.fastAuthFetch("/api/ml/habit-routes/analyze", {
      method: "POST",
      body: JSON.stringify({ coords_json: route.coords })
    });
    const liveData = await liveRes.json();
    const segmentSequence = liveData.match_info.segment_matches.map(m =>
      m ? { link_id: m.link_id, road_name: m.road_name } : null
    );

    // Fetch the best historical time
    const res = await window.fastAuthFetch("/api/ml/habit-routes/best-time", {
      method: "POST",
      body: JSON.stringify({
        segment_sequence: segmentSequence,
        day: day,
        start_bucket: startBucket,
        end_bucket: endBucket,
        distance_m: route.distance_m,
        day_profile: dayProfile
      })
    });

    if (!res.ok) throw new Error("Failed to fetch best time.");
    const bestTimeData = await res.json();

    if (bestTimeData.error) {
      panel.innerHTML = `<div class="p-4 bg-red-900/20 text-red-400 rounded">${bestTimeData.error}</div>`;
      return;
    }


    if (bestTimeData.match_info) {
      await drawHabitRouteOnMap({
        ...route,
        match_info: bestTimeData.match_info,
        is_historical: true,
        historical_payload: bestTimeData,

      });
    }

    const best = bestTimeData.best_time;

    let graphHtml = `
        <div class="mt-1 bg-slate-900/50">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">ETA Trend (15mins)</p>
          
          <div style="display: flex; align-items: flex-end; gap: 4px; height: 80px; padding-bottom: 4px; border-bottom: 1px solid #334155;">`;

    const maxEta = Math.max(...bestTimeData.all_options.map(o => o.eta)) || 1;

    bestTimeData.all_options.forEach(opt => {
      const height = Math.max(15, (opt.eta / maxEta) * 100);
      const isBest = opt.bucket === best.bucket;

      graphHtml += `
          <div style="flex: 1; position: relative; cursor: pointer; height: 100%; display: flex; align-items: flex-end;" class="group">
            <div style="width: 100%; height: ${height}%; background-color: ${isBest ? '#3b82f6' : '#475569'}; border-radius: 2px 2px 0 0;" 
                 class="transition-all hover:opacity-80"></div>
            
            <div class="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-20 bg-black text-[9px] p-1.5 rounded shadow-xl z-50 text-center">
              <span style="color: #94a3b8;">${opt.display_time}</span><br/>
              <span style="font-weight: bold; color: white;">${opt.eta} mins</span>
            </div>
          </div>`;
    });

    graphHtml += `</div>
          <div style="display: flex; justify-content: space-between; margin-top: 6px;" class="text-[9px] text-slate-500 font-mono">
            <span>${bestTimeData.all_options[0].display_time}</span>
            <span>${bestTimeData.all_options[bestTimeData.all_options.length - 1].display_time}</span>
          </div>
        </div>`;

    const leaveTimeHours = Math.floor((best.bucket * 15) / 60);
    const leaveTimeMins = (best.bucket * 15) % 60;
    const formattedLeaveTime = `${String(leaveTimeHours).padStart(2, '0')}:${String(leaveTimeMins).padStart(2, '0')}`;

    const arriveDate = new Date(targetTime);
    arriveDate.setHours(leaveTimeHours, leaveTimeMins + Math.round(best.eta), 0);
    const formattedArriveTime = `${String(arriveDate.getHours()).padStart(2, '0')}:${String(arriveDate.getMinutes()).padStart(2, '0')}`;
    renderHabitPanelResult(
      route,
      { predicted_eta: best.eta },
      "best",
      null,
      {
        arrivalTime: formattedArriveTime,
        departureTime: formattedLeaveTime,
        holidayName: holidayName,
        trendHtml: graphHtml
      }
    );


  } catch (error) {
    console.error("Best Time calculation failed:", error);
    panel.innerHTML = `<div class="p-4 text-red-400">Error calculating best time.</div>`;
  }
}
// End Best Time Planning


// HELPER function to calculate fuel cost for Habit Routes -----
function getFuelCostForHabit(distance_m) {
  if (!distance_m) return "0.00";

  const consumptionEl = document.getElementById('cost-consumption');
  const consumption = consumptionEl ? parseFloat(consumptionEl.innerText) : 8.0;

  const fuelSelect = document.getElementById('cost-fuel-grade');
  let fuelPrice = 3.44;
  if (fuelSelect && fuelSelect.selectedIndex >= 0) {
    const selectedText = fuelSelect.options[fuelSelect.selectedIndex].text;
    const parts = selectedText.split("S$");
    if (parts.length > 1) {
      fuelPrice = parseFloat(parts[1]);
    }
  }

  const routeKm = distance_m / 1000;
  // Return JUST the number string
  return ((routeKm / 100) * consumption * fuelPrice).toFixed(2);
}
// End helper function to calculate fuel cost for habit routes

// Load chosen  habit route to map
// Draw polylines, 
async function drawHabitRouteOnMap(route) {


  if (!state.plannerMap || !state.habitRoutePolylineLayer) return;
  if (!route || !Array.isArray(route.coords) || route.coords.length < 2) return;

  const isNow = state.habitPlanMode === "now";

  let data;


  // Declare variables for chatbot context
  let route_id = route.id;
  let route_jam_pins = [];
  let num_jams = 0;
  let route_name = route.route_name || "Unnamed Route";
  let from = route.from || "";
  let to = route.to || "";
  state.habitRouteJams = {};
  state.activeRoutePins = [];
  state.selectedJamPinID = null;
  if (state.incidentMarkerLayer) {
    state.incidentMarkerLayer.clearLayers();
  }

  // Reset  state.habitRouteJams
  state.habitRouteJams = {}


  if (route.is_historical) {
    data = route.historical_payload;
  } else {
    const subPath = route.is_demo ? "analyze-simulated-route" : "habit-routes/analyze";

    const payload = { coords_json: route.coords };

    // Only add 'links' if we are in demo mode
    if (route.is_demo) {
      payload.links = route.inputs;
    }

    const res = await window.fastAuthFetch(`/api/ml/${subPath}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let message = "Failed to load live route data.";
      try {
        const err = await res.json();
        message = err.error || err.detail || message;
      } catch (_) { }
      alert(message);
      return;
    }
    data = await res.json();
  }
  const specialist_threshold = data.specialist_threshold || 0.75;

  // if (state.routeLayer) state.routeLayer.clearLayers();
  // if (state.plannerLayer) state.plannerLayer.clearLayers();
  // if (state.routePolylines) state.routePolylines.clear();
  state.habitRoutePolylineLayer.clearLayers();

  const allLinkIds = (data.match_info?.matched_links || [])
    .map(l => l.link_id)
    .filter(id => id != null);

  if (allLinkIds.length > 0) {
    try {
      const intelRes = await window.fastAuthFetch('/api/ml/route-intel', {
        method: "POST",
        body: JSON.stringify({ link_ids: allLinkIds })
      });

      if (intelRes.ok) {
        const intelData = await intelRes.json()
        state.currentRouteIntel = intelData.details;
        state.currentRouteIntelSummary = intelData.summary;
        state.habitRouteChatContext = {
          ...state.habitRouteChatContext,
          intelligence: {
            hotspot_count: intelData.summary.total_hotspots || 0,
            total_incidents: intelData.summary.total_incidents || 0,
            weather: intelData.summary.is_raining_anywhere ? "Rainy" : "Clear"
          }
        };
        data.intelSummary = intelData.summary;
      }
    } catch (e) { console.log("Intel fetch failed", { e }); }
  }

  const coords = data.coords || route.coords;
  state.currentRouteCoords = coords;
  const matchInfo = data.match_info || {};
  const segmentMatches = matchInfo.segment_matches || [];
  const segments = [];



  // Update the global state
  // Filter rows that match LTA road links

  const validMatches = segmentMatches.filter(m => m !== null && m.prediction);
  console.log("Sentinel: Found", validMatches.length, "valid predictions");
  state.totalSegmentsScanned += validMatches.length;
  const sessionVariance = validMatches.reduce((sum, m) => {
    const val = parseFloat(m.prediction.mag || 0);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  // Keep track of rows where model predicts different speedband
  const officialChanges = validMatches.filter(m =>
    m.prediction.mag >= specialist_threshold
  ).length;
  state.officialChanges += officialChanges;
  state.totalSignalVariance += sessionVariance;
  console.log("Total change added:", sessionVariance);
  state.majorAnomaliesCaught += validMatches.filter(m =>
    m.prediction.mag >= 1.5
  ).length;

  // Call a function to update the dashboard UI

  // Helper for line colors based on speedbands
  const getBandColor = (b) => {
    if (b <= 3) return "#ef4444";
    if (b <= 5) return "#f59e0b";
    return "#22c55e";
  };

  // Draw the segments and color those that have a match with LTA
  // Color the segments based on the predicted speedband
  for (let j = 0; j < coords.length - 1; j += 1) {
    const matchData = segmentMatches[j];


    if (matchData && matchData.prediction) {
      const p = matchData.prediction;

      // Set trend color for the popup and the line logic
      let trendColor = "#64748b";
      if (p.trend.includes("Jam") || p.trend.includes("Slowdown")) trendColor = "#7f1d1d";
      if (p.trend.includes("Recovery") || p.trend.includes("Speedup")) trendColor = "#14532d";

      // Create the polyline first
      const line = L.polyline([coords[j], coords[j + 1]], {
        color: getBandColor(p.predicted_val),
        weight: 8,
        opacity: 1
      });

      const getBandTextColor = (b) => {
        if (b <= 3) return "#ef4444";
        if (b <= 5) return "#f59e0b";
        return "#22c55e";
      };

      let lastPinIndex = -999;

      // Bind the Tooltip 
      line.bindPopup(`
              <div style="font-family: 'Inter', -apple-system, sans-serif; min-width: 220px; padding: 5px;">
                <div style="font-weight: 800; font-size: 15px; color: #1e293b; letter-spacing: -0.01em;">
                    ${escapeHtml(matchData.display_name || matchData.road_name || "LTA Road")}
                </div>
                <div style="color: #94a3b8; font-size: 10px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.05em;">LINK ID: ${matchData.link_id}</div>
                
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px;">
                    <span style="color: #64748b;">Current State:</span>
                    <span style="font-weight: 700; color: #334155;">Band ${p.current_val}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 12px; padding-bottom: 4px;">
                    <span style="font-weight: 600;">Prediction (T+15):</span>
                    <span style="font-weight: 800; color: ${getBandTextColor(p.predicted_val)};">Band ${p.predicted_val}</span>
                </div>

                <div style="margin-top: 8px;">
                    <div style="font-weight: 700; font-size: 13px; color: #1e293b; display: flex; align-items: center; gap: 6px;">
                        <div style="width: 6px; height: 6px; border-radius: 50%; background: ${p.trend.includes('Jam') ? '#ef4444' : (p.trend.includes('Steady') ? '#94a3b8' : '#22c55e')};"></div>
                        ${p.trend}
                    </div>
                    <div style="font-size: 11px; color: ${getBandColor(p.predicted_val)}; margin-top: 2px;">${p.tier}</div>
                    
                
                </div>

            
        
            `);

      line.addTo(state.habitRoutePolylineLayer);
      segments.push(line);

      // Add hotspots
      const intel = state.currentRouteIntel ? state.currentRouteIntel[matchData.link_id] : null;
      if (isNow && intel && intel.is_hotspot) {
        const midLat = (coords[j][0] + coords[j + 1][0]) / 2;
        const midLon = (coords[j][1] + coords[j + 1][1]) / 2;

        L.marker([midLat, midLon], {
          icon: getPin('HOTSPOT')
        }).bindPopup(`
            <div style="font-size:12px; font-family: sans-serif; min-width: 160px;">
              <div style="margin-bottom:4px; font-weight: bold; color: #ef4444;">ACCIDENT HOTSPOT</div>
              <div style="margin-bottom:6px; font-size:13px;">${matchData.road_name || "LTA Road"}</div>
              <hr style="border:none; border-top:1px solid #eee; margin:8px 0;" />
              <div style="display: flex; justify-content:space-between;"><span><b>Drive safely!</b></span> </div>
            </div>
          `).addTo(state.habitRoutePolylineLayer);
      }

      // Try to add a popup if system predicts jam or massive speedband drop
      // Calculate band change
      const currentVal = parseInt(p.current_val)
      const predictedVal = parseInt(p.predicted_val)
      const bandChange = currentVal - predictedVal;

      const isJam = (predictedVal <= 2);
      const isDrop = (currentVal >= 6 && bandChange >= 2);

      const systemPinID = `jam-pin-${matchData.link_id}`;


      // Only draw the marker if it's actually a problem
      // Add a lastPinIndex check to make sure it doesn't spam map pins
      if (isNow && (isJam || isDrop) && !state.habitRouteJams[systemPinID] && (j - lastPinIndex) > 15) {

        const midLat = (coords[j][0] + coords[j + 1][0]) / 2;
        const midLon = (coords[j][1] + coords[j + 1][1]) / 2;

        // Increment the jam count
        num_jams += 1;

        // Caller Helper function to draw map pins
        const jamMarker = createBaseJamMarker(midLat, midLon, matchData.road_name, num_jams, j, isJam, matchData.prediction, matchData.link_id);

        // Add it to the Map Layer
        jamMarker.addTo(state.habitRoutePolylineLayer);

        // Save to the jam-pin mapping
        state.activeRoutePins.push({
          link_id: matchData.link_id,
          segmentIndex: j
        });

        route_jam_pins.push({
          index: num_jams,
          pin_id: systemPinID,
          segment_index: j,
          link_id: matchData.link_id,
          road_name: matchData.road_name,
          lat: midLat,
          lon: midLon,
        })

        state.habitRouteJams[systemPinID] = {
          index: num_jams,
          pin: jamMarker,
          segment_index: j,
          link_id: matchData.link_id,
          road_name: matchData.road_name,
          lat: midLat,
          lon: midLon,
          currVal: currentVal,
          predictedVal: predictedVal,
          bandChange: bandChange
        }

        lastPinIndex = j;
      }

    } else {
      // Unmapped segments - Grey dashed line
      const line = L.polyline([coords[j], coords[j + 1]], {
        color: "#94a3b8",
        weight: 4,
        opacity: 0.5,
        dashArray: "5, 10"
      });
      line.addTo(state.habitRoutePolylineLayer);
      segments.push(line);
    }
  }

  if (segments.length) {
    const fg = L.featureGroup(segments);
    state.plannerMap.fitBounds(fg.getBounds(), { padding: [40, 40] });
  }
  // Draw Incidents and Road Happenings
  // const routePoints = coords.map(c => L.latLng(c[0], c[1]))
  // const cleanIncidents = mapLiveIncidentsToRouteEvents(state.mapLiveIncidents || []);

  // cleanIncidents.forEach(incident => {
  //   const incidentLoc = L.latLng(incident.lat, incident.lon);
  //   const isOnRoute = routePoints.some(point => point.distanceTo(incidentLoc) < 100);
  //   if (isOnRoute) {
  //     L.marker([incident.lat, incident.lon], {
  //       icon: L.divIcon({
  //         className: 'route-obstacle-icon',
  //         html: `<div style="font-size: 16px; background: white; border: 2px solid ${incident.color}; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">⚠️</div>`,
  //         iconSize: [24, 24],
  //         iconAnchor: [12, 12]
  //       })
  //     })
  //       .bindPopup(`
  //       <div style="font-family: sans-serif; min-width: 200px;">
  //         <strong style="color: ${incident.color}; font-size: 14px;">⚠️ ${incident.label}</strong>
  //         <div style="font-size: 12px; margin-top: 4px; color: #475569;">
  //           ${incident.message || "Hazard reported on route."}
  //         </div>
  //         <div style="font-size: 11px; margin-top: 8px; color: #94a3b8; font-weight: bold;">
  //           Est. Delay: ${incident.delayMin} mins
  //         </div>
  //       </div>
  //     `).addTo(state.habitRoutePolylineLayer);
  //   }
  // });



  state.habitRouteChatContext = {
    route_id: route_id,
    route_name: route_name,
    from: from,
    to: to,
    predicted_eta: data.summary.predicted_eta,
    num_jams: num_jams,
    route_jam_pins: route_jam_pins,
    intelligence: {
      total_incidents: state.currentRouteIntelSummary?.total_incidents || 0,
      weather: state.currentRouteIntelSummary?.is_raining_anywhere ? "Rainy" : "Clear",
      hotspot_count: state.currentRouteIntelSummary?.total_hotspots || 0,
      risk_level: (state.currentRouteIntelSummary?.total_hotspots > 20) ? "High" : "Normal"
    }
  }
  state.activeRoutePins.sort((a, b) => a.segmentIndex - b.segmentIndex);
  state.currSelectedRoute = route;
  state.currMatchInfo = data.match_info

  if (isNow) {
    fetchIncidentFeedback();
  }
  return data;
}
// --- END Draw Habit Route ---

// -- Helper function to create marker --
// Used by drawHabitRouteOnMap and updateColorsAhead
function createBaseJamMarker(lat, lon, roadName, pinIndex, segmentIndex, isJam, p, linkId) {
  const title = isJam ? "Jam" : "Slowdown";
  const color = "#ef4444";

  const icon = L.divIcon({
    html: `
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}"/>
                <circle cx="12" cy="9" r="3" fill="white"/>
            </svg>`,
    className: 'jam-pin-icon',
    iconSize: [30, 30],
    iconAnchor: [15, 30]
  });

  const marker = L.marker([lat, lon], { icon: getPin('SYSTEM_JAM') });

  marker.segmentIndex = segmentIndex;
  marker.index = pinIndex;
  marker.link_id = linkId;

  marker.bindPopup(`
        <div style="font-family: sans-serif; padding: 5px; min-width: 150px;">
            <b style="color: ${color};">Pin ${pinIndex}: ${title}</b><br>
            <small>${roadName}</small><br>
            <hr style="margin: 5px 0; border-top: 1px solid #eee;">
            <button onclick="simulateReroute(${linkId}, ${segmentIndex})" 
                    style="width: 100%; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer;">
                Reroute
            </button>
        </div>
    `);

  const systemPinID = `jam-pin-${linkId}`;
  marker.on("click", () => {
    state.selectedJamSegment = segmentIndex;
    state.selectedJamPinID = systemPinID;
    console.log(`Selected Segment: ${segmentIndex} | ID: ${systemPinID}`);
  });

  marker.on("popupopen", () => {
    state.selectedJamSegment = segmentIndex;
    state.selectedJamPinID = systemPinID;
  });

  return marker;
}
// End Helper Function for Create Jam Marker

// Update Habit Route settings
async function saveHabitRouteSettings(routeId, card) {

  const alert_enabled = card.querySelector(".habit-alert-toggle").checked;
  const alert_start_time = card.querySelector(".habit-alert-start").value;
  const alert_end_time = card.querySelector(".habit-alert-end").value;

  // Persist saved-route settings through the Node habit route API.
  const res = await window.fastAuthFetch(`/api/habit-routes/${routeId}`, {
    method: "PATCH",
    body: JSON.stringify({ alert_enabled, alert_start_time, alert_end_time })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Habit route settings update failed:", data);
    alert("Failed to save route settings.");
    return;
  }

  await loadHabitRoutesFromServer();

}

// Delete Habit Route
async function deleteHabitRoute(routeId) {


  const res = await window.fastAuthFetch(`/api/habit-routes/${routeId}`, {
    method: "DELETE"
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("Habit route delete failed:", data);
    alert("Failed to delete habit route.");
    return;
  }

  await loadHabitRoutesFromServer();
  if (state.habitRoutePolylineLayer) state.habitRoutePolylineLayer.clearLayers();
}

// Save to Habit Routes
async function saveRouteAsHabit(routeObj, btn) {
  const auth = window.getFastAuth ? window.getFastAuth() : null;
  if (!auth || !auth.token) {
    alert("Please log in first.");
    return;
  }

  // Modify button to showed that it has been clicked
  const originalText = btn.innerHTML;
  btn.innerHTML = "Saving...";
  btn.style.pointerEvents = "none";

  // Create a default name first, to design a name input panel later
  const startInput = document.getElementById("route-start-postal")?.value || "Start";
  const endInput = document.getElementById("route-end-postal")?.value || "Destination";

  const autoName = `${startInput} → ${endInput}`;

  // Send to FastAPI Analyze endpoint to retrieve LTA roadlinks
  try {
    const analyzeRes = await window.fastAuthFetch("/api/ml/habit-routes/analyze", {
      method: "POST",
      body: JSON.stringify({ coords_json: routeObj.coords })
    });
    const analysis = await analyzeRes.json();

    if (!analyzeRes.ok) throw new Error("Link analysis failed");

    // Send endpoint to FastAPi habit-routes to save habit routes 
    const saveRes = await window.fastAuthFetch("/api/habit-routes", {
      method: "POST",
      body: JSON.stringify({
        route_name: autoName,
        from_label: startInput,
        to_label: endInput,
        coords_json: routeObj.coords,
        distance_m: routeObj.totalDist,
        link_ids: analysis.match_info.matched_links.map(l => l.link_id)
      })
    });

    if (saveRes.ok) {
      savedOk = true;
      // Update button to show that route was saved successfully
      btn.innerHTML = "✓";
      btn.style.background = "#10b981";
      btn.style.color = "white";
      btn.style.borderColor = "#10b981";
      loadHabitRoutesFromServer();

      // Revert back button
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style = "";
      }, 3000);
    }
  } catch (err) {
    console.error(err);
    alert("System error while saving.");
  } finally {
    btn.style.pointerEvents = "";
    if (!savedOk) {
      btn.innerHTML = originalText;
    }
  }
}

// ALERTS section
async function checkTrafficAlerts() {

  if (!state.habitSavedRoutes || state.habitSavedRoutes.length === 0) {
    // If routes aren't loaded yet, try to load them once
    await loadHabitRoutesFromServer();
  }

  try {
    // Call FastAPI endpoint to retrieve user alerts
    const res = await window.fastAuthFetch("/api/my-alerts");
    const alerts = await res.json();

    const badge = document.getElementById("nav-alert-badge");
    const list = document.getElementById("nav-alerts-list");

    if (alerts && alerts.length > 0) {
      badge.innerText = alerts.length;
      badge.classList.remove("hidden");

      // Populate the dropdown list from alerts navbar
      list.innerHTML = "";
      alerts.forEach(alert => {
        // Lookup the route name from your state cache
        const routeInfo = state.habitSavedRoutes.find(r => r.id === alert.route_id);
        const routeDisplayName = routeInfo ? (routeInfo.route_name || routeInfo.from) : `ID: ${alert.route_id}`;

        list.innerHTML += `
                    <li class="nav-alert-item-wrap">
                        <div class="nav-alert-card">
                            <div class="nav-alert-title">Traffic Alert!</div>
                            <div class="nav-alert-text">Route <strong>${escapeHtml(routeDisplayName)}</strong> is facing delays.</div>
                            <button type="button" class="btn-dismiss-alert" onclick="dismissAlert(${alert.id}, this)">Dismiss</button>
                        </div>
                    </li>
                `;
      });
      list.querySelectorAll(".btn-dismiss-alert").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const routeId = btn.getAttribute("data-route-id");
          const alertId = btn.getAttribute("data-alert-id");
          await dismissHabitAlert(routeId, alertId, btn);
        });
      });
    } else {
      badge.classList.add("hidden");
      list.innerHTML = `<li class="no-alerts" style="padding:15px; color:#94a3b8; font-size:12px;">No active traffic jams.</li>`;
    }
  } catch (err) {
    console.error("Alert check failed:", err);
  }
}

function updateSentinelDashboard() {
  const dash = document.getElementById('sentinel-stats');
  if (!dash) return;

  dash.innerHTML = `
        <div style="padding: 16px 8px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
            <div style="font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">
                Session Metrics
            </div>

            <div style="display: flex; gap: 24px; align-items: baseline;">
                <div>
                    <div style="font-size: 22px; font-weight: 800; color: #1e293b;">${state.totalSegmentsScanned}</div>
                    <div style="font-size: 10px; color: #64748b; font-weight: 500;">Links Scanned</div>
                </div>

                <div>
                    <div style="font-size: 22px; font-weight: 800; color: #3b82f6;">${state.officialChanges}</div>
                    <div style="font-size: 9px; color: #64748b; font-weight: 500; text-transform: uppercase;">Changes</div>
                </div>
                
                <div>
                    <div style="font-size: 22px; font-weight: 800; color: #ef4444;">${state.majorAnomaliesCaught}</div>
                    <div style="font-size: 10px; color: #64748b; font-weight: 500;">Major Alerts</div>
                </div>

                <div style="margin-left: auto; text-align: right;">
                    <div style="font-size: 16px; font-weight: 700; color: #3b82f6;">${state.historicalPrecision}</div>
                    <div style="font-size: 9px; color: #94a3b8;">Historical Recall</div>
                </div>
            </div>
            
    
        </div>
    `;
}

state.simulatedLinkId = null;

// FOR ML PREDICTION SIMULATION SECTION
window.openSimulator = function (linkId, currentBand) {
  document.getElementById('sim-link-id').innerText = linkId;

  document.getElementById('sim-sb').value = currentBand;
  document.getElementById('sim-sb5').value = currentBand;
  document.getElementById('sim-sb10').value = currentBand;
  document.getElementById('sim-sb15').value = currentBand;

  document.getElementById('sim-hijack-results').style.display = 'none';
  document.getElementById('ml-hijack-modal').style.display = 'block';
};

document.getElementById('btn-run-hijack').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-hijack');
  btn.innerText = "Predicting.."

  const payload = {
    link_id: parseInt(document.getElementById('sim-link-id').innerText),
    sb: parseInt(document.getElementById('sim-sb').value),
    sb_tm5: parseInt(document.getElementById('sim-sb5').value),
    sb_tm10: parseInt(document.getElementById('sim-sb10').value),
    sb_tm15: parseInt(document.getElementById('sim-sb15').value),
    rain_mm: parseFloat(document.getElementById('sim-rain').value || 0),

    // Incident Data
    incident_nearby: parseInt(document.getElementById('sim-incident').value || 0),
    nearby_accident: parseInt(document.getElementById('sim-accident').value || 0),
    nearby_roadwork: parseInt(document.getElementById('sim-roadwork').value || 0),
    nearby_breakdown: parseInt(document.getElementById('sim-breakdown').value || 0),
    mins_since_nearby_start: parseInt(document.getElementById('sim-mins-since').value || 0),

    // Context Data
    is_peak: parseInt(document.getElementById('sim-peak').value || 0),
    is_weekend: parseInt(document.getElementById('sim-weekend').value || 0)
  };

  try {
    const res = await window.fastAuthFetch("/api/ml/hijack-predict", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    document.getElementById('sim-hijack-results').style.display = 'block';
    document.getElementById('sim-hijack-pred').innerText = `Band ${data.predicted_val}`;
    document.getElementById('sim-hijack-pred').innerText = `Band ${data.predicted_val}`;
  } catch (err) {
    alert("Failed");
  } finally {
    btn.innerText = "Simulated Prediction"
  }


})

window.addEventListener('mouseup', function (event) {
  const modal = document.getElementById('ml-hijack-modal');
  if (modal.style.display === 'block' && !modal.contains(event.target)) {
    modal.style.display = 'none';
  }
});

const DEMO_FEATURES = [{ "link_id": 46067, "road_name": "PAN ISLAND EXPRESSWAY", "segment_len_m": 500.0, "sb": 7, "sb_tm5": 7, "sb_tm10": 3, "sb_tm15": 3, "delta_0_5": 0.0, "delta_5_10": 4.0, "delta_10_15": 0.0, "acceleration": -4.0, "mid_lat": 1.3200669999999999, "mid_lon": 103.8760905, "link_dist_proxy": 0.0004778462095650472, "road_category": 1, "rain_mm": 0.0, "is_raining": 0, "is_weekend": 0, "is_peak": 0, "incident_nearby": 0, "mins_since_nearby_start": -1, "nearby_accident": 0, "nearby_roadwork": 0, "nearby_breakdown": 0 }]
document.getElementById("habit-routes-demo-btn").onclick = async () => {
  try {
    // Fetch the raw features 


    // Create the Simulated Route
    const demoRoute = {
      id: 'DEMO',
      route_name: "SCENARIO: Pandan Road Crash",
      from: "West Coast",
      to: "Pandan Crescent",
      distance_m: 12400,
      is_demo: true,
      coords: [[1.319975, 103.876311], [1.320159, 103.87587]],
      inputs: DEMO_FEATURES
    };

    // Inject locally and refresh sidebar
    state.habitSavedRoutes.unshift(demoRoute);
    renderHabitRoutesList();

  } catch (err) {
    console.error("Injection failed:", err);
  }
};

function addUniqueAvoidPoint(points, point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const exists = points.some((p) => haversine(p.lat, p.lon, lat, lon) <= 35);
  if (exists) return null;
  const normalized = {
    lat,
    lon,
    type: String(point.type || "traffic-obstacle"),
    label: String(point.label || "Traffic obstacle"),
    radiusMeters: Math.max(80, Math.min(800, Number(point.radiusMeters) || 320)),
    penaltyMultiplier: Math.max(4, Math.min(60, Number(point.penaltyMultiplier) || 20))
  };
  points.push(normalized);
  return normalized;
}

function getSegmentAvoidPoint(coords, segmentMatches, segmentIndex, fallbackLabel) {
  const match = Array.isArray(segmentMatches) ? segmentMatches[segmentIndex] : null;
  const midLat = Number(match?.mid_lat);
  const midLon = Number(match?.mid_lon);
  if (Number.isFinite(midLat) && Number.isFinite(midLon)) {
    return {
      lat: midLat,
      lon: midLon,
      label: match.road_name || fallbackLabel || "Congestion point"
    };
  }
  const a = coords?.[segmentIndex];
  const b = coords?.[segmentIndex + 1];
  if (Array.isArray(a) && Array.isArray(b)) {
    return {
      lat: (Number(a[0]) + Number(b[0])) / 2,
      lon: (Number(a[1]) + Number(b[1])) / 2,
      label: match?.road_name || fallbackLabel || "Congestion point"
    };
  }
  return null;
}

function buildRerouteAvoidanceContext(coords, segmentMatches, segmentIndex, jammedId, anchorIdx) {
  const avoidPoints = [];
  const blockedEdges = [];
  const obstacleEvents = [];
  const maxSegment = Math.min((coords?.length || 1) - 2, segmentIndex + 10);
  let primaryAvoidPoint = null;

  for (let i = Math.max(0, segmentIndex); i <= maxSegment; i += 1) {
    const match = Array.isArray(segmentMatches) ? segmentMatches[i] : null;
    if (match?.link_id) blockedEdges.push(String(match.link_id));
    const predictedVal = Number.parseInt(match?.prediction?.predicted_val, 10);
    const currentVal = Number.parseInt(match?.prediction?.current_val, 10);
    const bandDrop = Number.isFinite(currentVal) && Number.isFinite(predictedVal) ? currentVal - predictedVal : 0;
    const isSelected = i === segmentIndex || (match?.link_id != null && String(match.link_id) === String(jammedId));
    const isCongested = isSelected || predictedVal <= 2 || (currentVal >= 6 && bandDrop >= 2);
    if (!isCongested) continue;

    const point = getSegmentAvoidPoint(coords, segmentMatches, i, isSelected ? "Selected congestion point" : "Predicted congestion point");
    if (!point) continue;
    const added = addUniqueAvoidPoint(avoidPoints, {
      ...point,
      type: "congestion",
      label: isSelected ? "Selected congestion point" : "Predicted congestion point",
      radiusMeters: isSelected ? 380 : 300,
      penaltyMultiplier: isSelected ? 28 : 18
    });
    if (added) {
      if (isSelected && !primaryAvoidPoint) primaryAvoidPoint = added;
      obstacleEvents.push({
        id: `avoid-congestion-${i}`,
        type: "congestion",
        label: added.label,
        color: "#ef4444",
        severity: isSelected ? 3 : 2,
        delayMin: isSelected ? 12 : 8,
        lat: added.lat,
        lon: added.lon,
        reason: added.label,
        message: added.label,
        createdAt: new Date().toISOString()
      });
    }
  }

  const liveEvents = mapLiveIncidentsToRouteEvents([
    ...(Array.isArray(state.mapLiveIncidents) ? state.mapLiveIncidents : []),
    ...(Array.isArray(state.dashboardIncidents) ? state.dashboardIncidents : [])
  ]);
  liveEvents.forEach((evt) => {
    const nearest = getNearestRoutePointIndex(coords, evt.lat, evt.lon);
    if (!Number.isFinite(nearest.distance) || nearest.distance > 420 || nearest.index < anchorIdx) return;
    const added = addUniqueAvoidPoint(avoidPoints, {
      lat: evt.lat,
      lon: evt.lon,
      type: evt.type || "incident",
      label: evt.label || "Live incident",
      radiusMeters: evt.severity >= 3 ? 420 : 320,
      penaltyMultiplier: evt.severity >= 3 ? 30 : 20
    });
    if (added) obstacleEvents.push(evt);
  });

  return {
    avoidPoints,
    blockedEdges: Array.from(new Set(blockedEdges)),
    primaryAvoidPoint,
    obstacleEvents
  };
}

// SIMULATE REROUTE SECTION - RECALCULATE ROUTE TO AVOID JAM

function highlightRerouteJam(jammedId, segmentIndex) {
  if (!state.previewDetourLayer) return;

  let selectedJam = state.selectedJamPinID
    ? state.habitRouteJams?.[state.selectedJamPinID]
    : null;

  if (!selectedJam && state.habitRouteJams) {
    selectedJam = Object.values(state.habitRouteJams).find(j =>
      String(j.link_id) === String(jammedId) ||
      Number(j.segment_index) === Number(segmentIndex)
    );
  }

  if (!selectedJam) {
    console.warn("No selected jam found for highlight", {
      jammedId,
      segmentIndex,
      selectedJamPinID: state.selectedJamPinID,
      habitRouteJams: state.habitRouteJams
    });
    return;
  }

  L.circleMarker([selectedJam.lat, selectedJam.lon], {
    radius: 13,
    color: "#ef4444",
    fillColor: "#ef4444",
    fillOpacity: 0.22,
    weight: 4,
    pane: "markerPane"
  })
    .bindTooltip("Rerouting from this jam", {
      permanent: true,
      direction: "top",
      offset: [0, -12]
    })
    .addTo(state.previewDetourLayer);
}


async function simulateReroute(jammedId, segmentIndex) {

  const coords = state.currentRouteCoords;


  const segmentMatches = state.currMatchInfo?.segment_matches || [];
  if (!coords || coords.length < 2) {
    console.log("Coords not found")
    return {
      success: false,
      message: "Couldn't get coords."
    };
  }

  if (window.simInterval) {
    clearInterval(window.simInterval);
  }

  // Write the current loading status into the current jam popup
  const popupBtn = document.querySelector(".leaflet-popup-content button");
  if (popupBtn) {
    popupBtn.innerText = "Finding Alternatives...";
    popupBtn.style.opacity = "0.7";
    popupBtn.style.pointerEvents = "none";
  }

  const step = 5;
  const dest = coords[coords.length - 1];
  let lastError = null;
  for (let idx = segmentIndex; idx >= 0; idx -= step) {

    const distBack = getDistanceKm(coords[idx], coords[segmentIndex]);

    if (distBack > 3.0) {
      console.log("Search limit reached: No local exits found within 3km.");
      break;
    }
    // Find the anchor, the reroute point for the alternate route
    const anchorIdx = Math.max(0, idx - 10);
    const anchor = coords[anchorIdx];
    if (!anchor) {
      console.log("No anchor")
      continue;
    }

    try {
      const startGeo = { lat: anchor[0], lon: anchor[1], display: "Reroute anchor" };
      const endGeo = { lat: dest[0], lon: dest[1], display: "Destination" };
      const avoidance = buildRerouteAvoidanceContext(coords, segmentMatches, segmentIndex, jammedId, anchorIdx);
      const plans = await fetchRoutePlansFromPython(startGeo, endGeo, 0.03, {
        avoidPoints: avoidance.avoidPoints,
        blockedEdges: avoidance.blockedEdges,
        avoidRadiusMeters: 340,
        avoidPenaltyMultiplier: 22
      });
      if (!plans.length) {
        if (popupBtn) popupBtn.innerText = "No alternative found"
        console.log("routes not found")
        continue
      }

      const defaultRoute = plans.find((r) => r.id === "fastest") || plans[0];
      const baseCoords = getRouteCoords(defaultRoute, startGeo, endGeo);
      const liveRouteEvents = mapLiveIncidentsToRouteEvents([
        ...(Array.isArray(state.mapLiveIncidents) ? state.mapLiveIncidents : []),
        ...(Array.isArray(state.dashboardIncidents) ? state.dashboardIncidents : [])
      ]);
      const relevantEvents = await analyzeEventsViaBackend(
        liveRouteEvents.concat(avoidance.obstacleEvents),
        { lat: startGeo.lat, lon: startGeo.lon },
        baseCoords
      );
      const realtimeCameras = state.cameras.filter((c) => c.hasRealtimeImage);
      const eventsWithCameras = attachEventCameras(relevantEvents, realtimeCameras);
      const evaluation = await evaluateRoutesByEventsViaBackend(plans, eventsWithCameras);
      const bestId = evaluation.recommendedRouteId || deriveCurrentFastestId(plans, evaluation) || plans[0].id;
      const best = plans.find((route) => route.id === bestId) || plans[0];

      // Path before reroute anchor point
      const rerouteSuffix = best.coords || [];
      if (rerouteSuffix.length < 2) continue;

      // New complete alternate path
      const prefix = coords.slice(0, anchorIdx + 1);
      const mergedCoords = prefix.concat(rerouteSuffix.slice(1));

      // Call the analyze endpoint
      let analysisData = {
        summary: { predicted_eta: best.estMinutes },
        match_info: { segment_matches: [] }
      };
      try {
        const analysisRes = await window.fastAuthFetch("/api/ml/habit-routes/analyze", {
          method: "POST",
          body: JSON.stringify({ coords_json: mergedCoords })
        });
        if (analysisRes.ok) {
          analysisData = await analysisRes.json();
        }
      } catch (analysisErr) {
        console.log("Alternate route live analysis fallback", analysisErr);
      }

      // Call functions to draw the alternate route, + show the decision popup
      renderPreviewRoute(mergedCoords, analysisData.match_info?.segment_matches || [], anchorIdx);
      highlightRerouteJam(jammedId, segmentIndex);
      showAcceptRejectCard(analysisData.summary?.predicted_eta || best.estMinutes, mergedCoords, analysisData.match_info || { segment_matches: [] });

      state.plannerMap.closePopup();

      return {
        success: true,
        message: "Found an alternate route for you!"
      }

    } catch (err) {
      console.log("Alt route generation error", err)
      lastError = err;
      continue;
    }

    //   L.polyline(mergedCoords, {
    //   color: "gray",
    //   weight: 6,
    //   opacity: 0.9,
    //   dashArray: "10, 8"
    // }).addTo(state.habitRoutesMap);


    // state.currentRouteCoords = mergedCoords;

    // await drawHabitRouteOnMap({
    //   coords: mergedCoords
    // });


  }
  if (popupBtn) {
    popupBtn.innerText = lastError ? "Error calculating" : "No alternative found";
    popupBtn.style.opacity = "1";
    popupBtn.style.pointerEvents = "auto";
  }
  return {
    success: false,
    message: "Sorry, I couldn't find an alternative route."
  };
}
window.simulateReroute = simulateReroute;

function renderPreviewRoute(newCoords, segmentMatches, anchorIdx) {
  state.previewDetourLayer.clearLayers();

  const getBandColor = (b) => {
    if (b <= 3) return "#ef4444"; // Red
    if (b <= 5) return "#f59e0b"; // Orange
    return "#10b981";             // Green
  };
  const detourCoords = newCoords.slice(anchorIdx);
  const continuousOutline = L.polyline(detourCoords, {
    color: "#ffffff",
    weight: 10,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  });
  continuousOutline.addTo(state.previewDetourLayer);

  for (let j = anchorIdx; j < newCoords.length - 1; j++) {
    const match = segmentMatches[j];
    let color = "#94a3b8";
    let weight = 8;
    let dashArray = null;

    if (match && match.prediction) {
      color = getBandColor(match.prediction.predicted_val);
    } else {
      dashArray = "5, 10";
    }



    const coreLine = L.polyline([newCoords[j], newCoords[j + 1]], {
      color: color,
      weight: weight,
      opacity: 1,
      dashArray: dashArray
    });
    coreLine.addTo(state.previewDetourLayer);

    // state.plannerMap.fitBounds(state.previewDetourLayer.getBounds(), { padding: [50, 50] });
  }
}

function showAcceptRejectCard(newEta, finalCoords, newMatchInfo) {
  const existing = document.getElementById("altroute-decision-card");
  if (existing) existing.remove();

  const selectedJam = state.selectedJamPinID
    ? state.habitRouteJams?.[state.selectedJamPinID]
    : null;

  const jamLabel = selectedJam
    ? `${selectedJam.road_name || "Selected jam"}`
    : "Selected congestion point";

  const card = document.createElement("div");
  card.id = "altroute-decision-card";
  card.style.cssText = `
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 2500;
  width: 300px;
  background: rgba(255,255,255,0.96);
  padding: 14px;
  border-radius: 14px;
  box-shadow: 0 14px 32px rgba(15,23,42,0.24);
  font-family: inherit;
  border: 1px solid rgba(59,130,246,0.35);
  box-sizing: border-box;
`;

  card.innerHTML = `
    <div style="font-size: 11px; font-weight: 800; color: #2563eb; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px;">
      Alternate Route Preview
    </div>

    <div style="font-weight: 800; color: #0f172a; font-size: 14px; margin-bottom: 4px;">
      Avoiding current bottleneck
    </div>

    <div style="font-size: 12px; color: #64748b; margin-bottom: 10px; line-height: 1.35;">
      From: <b style="color:#334155;">${escapeHtml(jamLabel)}</b>
    </div>

    <div style="font-size: 13px; color: #64748b; margin-bottom: 12px;">
      Predicted travel time: <b style="color: #2563eb;">~${Math.round(newEta)} mins</b>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <button id="btn-accept" onclick="acceptAltRoute()" 
        style="background: #0f172a; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 800; cursor: pointer;">
        Accept
      </button>

      <button id="btn-reject" onclick="rejectAltRoute()" 
        style="background: #f1f5f9; color: #475569; border: none; padding: 10px; border-radius: 8px; font-weight: 800; cursor: pointer;">
        Keep Original
      </button>
    </div>
  `;

  state.alternateRouteContext = {
    coords: finalCoords,
    newEta: newEta,
    newMatchInfo: newMatchInfo
  };

  const mapEl = document.getElementById("plannerMap");
  (mapEl || document.body).appendChild(card);
}

window.acceptAltRoute = async () => {
  if (!state.alternateRouteContext || !state.alternateRouteContext.coords) {
    return;
  }

  // Pause the car if a journey is ongoing
  if (window.simInterval) {
    clearInterval(window.simInterval);
  }

  // Reset the jam map pins
  if (state.habitRoutePinLayer) {
    state.habitRoutePinLayer.clearLayers();
  }

  lastRedrawIndex = -1;
  state.activeRoutePins = [];
  state.habitRouteJams = {};

  // Clear UI
  const card = document.getElementById("altroute-decision-card");
  if (card)
    card.remove();
  state.previewDetourLayer.clearLayers();
  state.plannerMap.removeLayer(state.previewDetourLayer)

  // Update the current route context in state
  state.currentRouteCoords = state.alternateRouteContext.coords;
  state.currMatchInfo = state.alternateRouteContext.newMatchInfo
  const updatedRouteObj = {
    ...state.currSelectedRoute,
    coords: state.alternateRouteContext.coords
  }

  if (!state.journeyActive) {
    await drawHabitRouteOnMap(updatedRouteObj);
  }
  else {
    window.playSimulationLoop();
  }



  state.alternateRouteContext = null;

};

window.rejectAltRoute = () => {
  const card = document.getElementById("altroute-decision-card");
  if (card)
    card.remove();
  state.previewDetourLayer.clearLayers();
  window.updateChatbotContext({
    mode: "awaiting_jam_reroute",
    selected_map_pin: state.selectedJamPinID,
    description: "The user rejected the reroute. You are still looking at the jam pin. You can try to reroute again or select another pin."
  });
  window.playSimulationLoop();
}

