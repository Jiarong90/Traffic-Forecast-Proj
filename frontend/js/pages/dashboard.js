// Dashboard incident overview, recent updates, and evidence cards.

  // 摄像头数量驱动的概览占位统计（真实事故统计由 refreshDashboardIncidents 覆盖）
  function updateDashboardStats() {
    const realtime = state.cameras.filter(c => c.hasRealtimeImage).length;
    const totalIncidents = Math.max(3, Math.min(20, Math.round(realtime * 0.025)));
    const high = Math.max(1, Math.round(totalIncidents * 0.25));
    const medium = Math.max(1, Math.round(totalIncidents * 0.45));
    const low = Math.max(1, totalIncidents - high - medium);
    const highest = high > 0 ? "HIGH" : medium > 0 ? "MEDIUM" : "LOW";

    const now = new Date().toLocaleString("en-US", { hour12: true });
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("summary-last-updated", `Last updated: ${now}`);
    setText("incident-total-num", String(totalIncidents));
    setText("severity-high-num", String(high));
    setText("severity-medium-num", String(medium));
    setText("severity-low-num", String(low));
    setText("incident-highest-severity", `Highest severity: ${highest}`);
    setText("incident-max-radius", `Max congestion radius: ${(1.2 + high * 0.35).toFixed(1)} km`);
    setText("live-incidents-total", String(totalIncidents));
    setText("live-incidents-breakdown", `${high} high, ${medium} medium, ${low} low`);
  }

  // Dashboard 默认证据卡渲染（无实时事故数据时的兜底展示）
  function renderDashboardEvidence() {
    const realtime = state.cameras.filter(c => c.hasRealtimeImage).slice(0, 6);
    const updatesEl = document.getElementById("dashboard-updates-list");
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!updatesEl || !evidenceEl) return;

    updatesEl.innerHTML = realtime.slice(0, 3).map((c, i) => `
      <li>
        <span class="dot ${i === 0 ? "red" : i === 1 ? "orange" : "green"}"></span>
        <div>
          <strong>${i === 0 ? "Accident risk cluster near" : i === 1 ? "Congestion build-up near" : "Roadwork impact near"} ${c.name}</strong>
          <span class="meta">Evidence source: ${c.source} · Camera ID: ${c.id}</span>
        </div>
      </li>
    `).join("");

    evidenceEl.innerHTML = realtime.map((c, i) => `
      <div class="evidence-card">
        <img src="${c.imageLink}" alt="${c.name}" loading="lazy" />
        <div class="evidence-card-body">
          <div class="evidence-card-title">${i % 3 === 0 ? "Accident Evidence" : i % 3 === 1 ? "Congestion Evidence" : "Roadwork Evidence"}</div>
          <div class="evidence-card-meta">${c.name}</div>
          <div class="evidence-card-meta">${c.source}</div>
        </div>
      </div>
    `).join("");
  }

  // 同步“时间/严重度”排序按钮文案
  function renderIncidentSortButton() {
    const btn = document.getElementById("incident-sort-btn");
    if (!btn) return;
    btn.textContent = state.incidentSortMode === "severity" ? "SORT: SEVERITY" : "SORT: TIME";
  }

  // 管理员可切换事故源（LTA LIVE / 模拟事故）
  function renderIncidentSourceButton() {
    const btn = document.getElementById("admin-incident-source-btn");
    if (!btn) return;
    const show = isAdmin();
    btn.classList.toggle("hidden", !show);
    if (!show) return;
    btn.textContent = state.incidentDataSource === "mock" ? "DATA: MOCK INCIDENTS" : "DATA: LTA LIVE";
    btn.title = state.incidentDataSource === "mock"
      ? "Currently showing mock incident test data (with disappearance logic)"
      : "Currently showing LTA live incidents";
  }

  // 刷新 Dashboard Recent Updates 列表，并联动 Alerts 面板
  function renderIncidentUpdatesList() {
    const updatesEl = document.getElementById("dashboard-updates-list");
    if (!updatesEl) return;
    const sorted = sortIncidents(state.dashboardIncidents, state.incidentSortMode);
    updatesEl.innerHTML = sorted.map((it, idx) => `
      <li class="dashboard-update-item" data-incident-id="${String(it.id || `incident-${idx + 1}`)}">
        <span class="dot ${getIncidentSeverityColor(it)}"></span>
        <div>
          <strong>${it.message || it.type || "Traffic incident"}</strong>
          <span class="meta">Area: ${it.area || "Unknown"} · Camera: ${it.cameraName || "N/A"} · Spread: ${getIncidentSpreadText(it)} · Duration: ${getIncidentDurationText(it)}</span>
        </div>
      </li>
    `).join("");
    renderAlertsPanels();
  }

  function highlightDashboardEvidenceCard(incidentId) {
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!evidenceEl || !incidentId) return;
    const selector = `.evidence-card[data-incident-id="${String(incidentId).replace(/"/g, '\\"')}"]`;
    const card = evidenceEl.querySelector(selector);
    if (!card) return;
    try {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      card.scrollIntoView();
    }
    card.classList.remove("evidence-card-highlight");
    void card.offsetWidth;
    card.classList.add("evidence-card-highlight");
    window.setTimeout(() => {
      card.classList.remove("evidence-card-highlight");
    }, 2000);
  }

  // 获取 Dashboard 事故数据；管理员可选择 live/mock
  async function fetchRealtimeIncidents() {
    const source = isAdmin() ? state.incidentDataSource : "live";
    const resp = await fetch(`/api/incidents?withImagesOnly=0&max=12&source=${encodeURIComponent(source)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed to load incidents");
    return {
      incidents: data.value || [],
      meta: data.meta || null
    };
  }

  // 刷新 Dashboard 事故视图，并同步更新时间提示
  async function refreshDashboardIncidents() {
    const payload = await fetchRealtimeIncidents();
    state.incidentMeta = payload.meta || null;
    renderDashboardIncidents(payload.incidents || []);
    const hint = document.getElementById("summary-last-updated");
    if (hint && state.incidentMeta?.source === "mock") {
      const step = Number.isFinite(Number(state.incidentMeta.pollStep)) ? ` · Sim step ${state.incidentMeta.pollStep}` : "";
      const resolved = Number.isFinite(Number(state.incidentMeta.resolvedCount)) ? ` · Resolved this step: ${state.incidentMeta.resolvedCount}` : "";
      hint.textContent = `Last updated: ${new Date().toLocaleString("en-SG", { hour12: true })} · Simulated data${step}${resolved}`;
    }
  }

  // Dashboard 事故列表与证据图主渲染
  function renderDashboardIncidents(incidents) {
    const overviewEl = document.getElementById("incident-overview-section");
    const recentEl = document.getElementById("recent-updates-section");
    const updatesEl = document.getElementById("dashboard-updates-list");
    const evidenceEl = document.getElementById("dashboard-evidence-list");
    if (!overviewEl || !recentEl || !updatesEl || !evidenceEl) return;

    if (!Array.isArray(incidents) || incidents.length === 0) {
      overviewEl.style.display = "none";
      recentEl.style.display = "none";
      state.dashboardIncidents = [];
      renderAlertsPanels();
      return;
    }

    overviewEl.style.display = "";
    recentEl.style.display = "";

    const totalIncidents = incidents.length;
    const high = incidents.filter((x) => getIncidentSeverityScore(x) === 3).length;
    const medium = incidents.filter((x) => getIncidentSeverityScore(x) === 2).length;
    const low = incidents.filter((x) => getIncidentSeverityScore(x) === 1).length;
    const highest = high > 0 ? "HIGH" : medium > 0 ? "MEDIUM" : "LOW";

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("incident-total-num", String(totalIncidents));
    setText("severity-high-num", String(high));
    setText("severity-medium-num", String(medium));
    setText("severity-low-num", String(low));
    setText("incident-highest-severity", `Highest severity: ${highest}`);
    setText("incident-max-radius", "Max congestion radius: 2.0 km");
    setText("live-incidents-total", String(totalIncidents));
    setText("live-incidents-breakdown", `${high} high, ${medium} medium, ${low} low`);
    state.dashboardIncidents = incidents;
    renderIncidentSortButton();
    renderIncidentUpdatesList();

    evidenceEl.innerHTML = incidents.map((it, idx) => `
      <div class="evidence-card" data-incident-id="${String(it.id || `incident-${idx + 1}`)}">
        ${it.imageLink
        ? `<img src="${it.imageLink}" alt="${it.message || "incident"}" loading="lazy" />`
        : `<div style="height:120px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#64748b;font-size:12px;">No nearby camera image</div>`}
        <div class="evidence-card-body">
          <div class="evidence-card-title">${it.type || "Traffic incident"}</div>
          <div class="evidence-card-meta">${it.area || "Unknown area"}</div>
          <div class="evidence-card-meta">Spread ${getIncidentSpreadText(it)} · Duration ${getIncidentDurationText(it)}</div>
          <div class="evidence-card-meta">${it.cameraName ? `Camera: ${it.cameraName}` : "No nearby camera, showing incident text only"}</div>
        </div>
      </div>
    `).join("");
  }
