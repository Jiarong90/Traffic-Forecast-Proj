// Route Planner saved places, saved routes, and preference controls.

// 读取 auth 模块维护的用户设置缓存（容错为 {}，避免页面崩溃）
function getCurrentUserSettings() {
  try {
    return window.getFastUserSettings ? (window.getFastUserSettings() || {}) : {};
  } catch (_) {
    return {};
  }
}

// 从设置中抽取常用地点
function getFrequentPlaces(settings) {
  const frequentPlaces = Array.isArray(settings?.frequentPlaces) ? settings.frequentPlaces : [];
  if (frequentPlaces.length) {
    return frequentPlaces
      .slice(0, 4)
      .map((p, i) => ({
        id: `place-${i + 1}`,
        label: String(p?.name || `Place ${i + 1}`).trim() || `Place ${i + 1}`,
        query: String(p?.query || "").trim()
      }))
      .filter((p) => p.query);
  }
  const fallback = [];
  const company = String(settings?.companyLocation || "").trim();
  const home = String(settings?.homeLocation || "").trim();
  if (company) fallback.push({ id: "company", label: "Company", query: company });
  if (home) fallback.push({ id: "home", label: "Home", query: home });
  return fallback;
}

// 从设置中抽取常用路线（最多 3 条），并标准化字段
function getFrequentRoutes(settings) {
  return (Array.isArray(settings?.frequentRoutes) ? settings.frequentRoutes : [])
    .slice(0, 3)
    .map((r, i) => ({
      id: `f-route-${i + 1}`,
      name: String(r?.name || `Route ${i + 1}`).trim() || `Route ${i + 1}`,
      start: String(r?.start || "").trim(),
      end: String(r?.end || "").trim()
    }))
    .filter((r) => r.start && r.end);
}

// 同步 Route Planner 上“常用地点/路线面板开关”按钮文案
function renderRouteFavoritesToggleButton() {
  const btn = document.getElementById("route-toggle-favorites-btn");
  if (!btn) return;
  btn.textContent = state.favoritePlannerPanelVisible
    ? "HIDE COMMON PLACES/ROUTES"
    : "SHOW COMMON PLACES/ROUTES";
}


// 渲染 Route Planner 常用数据面板：
// - 常用地点可一键填入起点/终点
// - 常用路线可一键触发导航计算
function renderRouteFavoritesPanel() {
  const panel = document.getElementById("route-favorites-panel");
  const list = document.getElementById("route-favorites-list");
  if (!panel || !list) return;
  panel.classList.toggle("hidden", !state.favoritePlannerPanelVisible);
  if (!state.favoritePlannerPanelVisible) return;
  const settings = getCurrentUserSettings();
  const places = getFrequentPlaces(settings);
  const routes = getFrequentRoutes(settings);
  const hasData = places.length || routes.length;
  if (!hasData) {
    list.innerHTML = `<div class="route-favorite-item"><div><strong>No common data</strong><div class="meta">Configure in Settings first.</div></div></div>`;
    return;
  }

  const placeHtml = places.map((p) => `
      <div class="route-favorite-item">
        <div>
          <strong>${escapeHtml(p.label)}</strong>
          <div class="meta">${escapeHtml(p.query)}</div>
        </div>
        <div>
          <button type="button" data-fav-place-start="${escapeHtml(p.query)}">Set Start</button>
          <button type="button" data-fav-place-end="${escapeHtml(p.query)}">Set End</button>
        </div>
      </div>
    `).join("");
  const routeHtml = routes.map((r) => `
      <div class="route-favorite-item">
        <div>
          <strong>${escapeHtml(r.name)}</strong>
          <div class="meta">${escapeHtml(r.start)} → ${escapeHtml(r.end)}</div>
        </div>
        <div>
          <button type="button" data-fav-route-plan="${r.id}">Plan Now</button>
        </div>
      </div>
    `).join("");
  list.innerHTML = placeHtml + routeHtml;

  list.querySelectorAll("[data-fav-place-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-fav-place-start") || "";
      const startEl = document.getElementById("route-start-postal");
      if (startEl) startEl.value = val;
    });
  });
  list.querySelectorAll("[data-fav-place-end]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-fav-place-end") || "";
      const endEl = document.getElementById("route-end-postal");
      if (endEl) endEl.value = val;
    });
  });
  list.querySelectorAll("[data-fav-route-plan]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-fav-route-plan");
      const route = routes.find((r) => r.id === id);
      if (!route) return;
      const startEl = document.getElementById("route-start-postal");
      const endEl = document.getElementById("route-end-postal");
      if (startEl) startEl.value = route.start;
      if (endEl) endEl.value = route.end;
      await calculateRoutes();
    });
  });
}

// 切换 Route Planner 常用面板显隐
function toggleRouteFavoritesPanel() {
  state.favoritePlannerPanelVisible = !state.favoritePlannerPanelVisible;
  renderRouteFavoritesToggleButton();
  renderRouteFavoritesPanel();
}

function renderRoutePreferenceButton() {
  const btn = document.getElementById("route-preference-btn");
  if (!btn) return;
  const pref = ROUTE_PREFERENCE_TEXT[state.routePreference] || "FASTEST ROUTE";
  btn.innerHTML = `<span class="icon-info"></span> PREFERENCE: ${pref}`;
}

function getPreferredRouteId() {
  if (!state.routePlans.length) return null;
  if (state.routePreference === "fastest") {
    return state.routeContext?.currentFastestId || state.routeContext?.evaluation?.recommendedRouteId || state.routePlans[0]?.id || null;
  }
  return state.routePlans.find((route) => route.id === state.routePreference)?.id || state.routePlans[0]?.id || null;
}

function applyRoutePreferenceSelection() {
  const preferredId = getPreferredRouteId();
  if (!preferredId) return;
  state.selectedRouteId = preferredId;
  renderRouteCards();
  const selected = state.routePlans.find((route) => route.id === preferredId);
  if (selected) showRouteDetails(selected);
  if (state.routeLayer) {
    state.routeLayer.eachLayer((layer) => {
      const id = layer.routeId;
      layer.setStyle({
        weight: id === preferredId ? 6 : 4,
        opacity: id === preferredId ? 0.95 : 0.55
      });
    });
  }
  if (typeof refreshRouteFeedbackMarkersForSelectedRoute === "function") {
    refreshRouteFeedbackMarkersForSelectedRoute();
  }
  renderAlertsPanels();
}

function cycleRoutePreference() {
  const currentIndex = ROUTE_PREFERENCE_ORDER.indexOf(state.routePreference);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ROUTE_PREFERENCE_ORDER.length : 0;
  state.routePreference = ROUTE_PREFERENCE_ORDER[nextIndex];
  renderRoutePreferenceButton();
  if (state.routePlans.length) {
    applyRoutePreferenceSelection();
  }

  
}


function openPlanUpgradeModal(plan) {
  const overlay = document.getElementById("profile-membership-overlay");
  const title = document.getElementById("profile-membership-title");
  const sub = document.getElementById("profile-membership-sub");
  const list = document.getElementById("profile-membership-list");
  const upgrade = document.getElementById("profile-membership-upgrade");
  const paynote = document.querySelector(".profile-membership-paynote");
  const confirmBtn = document.getElementById("profile-membership-confirm-btn");

  const selectedPlan = String(plan || "premium").toLowerCase();

  if (selectedPlan === "annual") {
    if (title) title.textContent = "PREMIUM ANNUAL";
    if (sub) sub.textContent = "Upgrade to Premium Annual for 12 months.";
    if (paynote) paynote.textContent = "Scan the PayNow QR code below to upgrade to Premium Annual for 12 months.";

    if (list) {
      list.innerHTML = `
        <div class="profile-membership-item">All Premium Monthly features</div>
        <div class="profile-membership-item">12-month Premium access</div>
        <div class="profile-membership-item">Lower effective monthly cost</div>
        <div class="profile-membership-item">Ideal for regular commuters</div>
      `;
    }

    if (confirmBtn) {
      confirmBtn.dataset.plan = "annual";
      confirmBtn.textContent = "I HAVE COMPLETED ANNUAL PAYMENT";
    }

  } else {
    if (title) title.textContent = "PREMIUM MONTHLY";
    if (sub) sub.textContent = "Upgrade to Premium Monthly for 30 days.";
    if (paynote) paynote.textContent = "Scan the PayNow QR code below to upgrade to Premium Monthly for 30 days.";

    if (list) {
      list.innerHTML = `
        <div class="profile-membership-item">Save 1 Habit Route</div>
        <div class="profile-membership-item">Personalized route alerts</div>
        <div class="profile-membership-item">Future trip planning</div>
        <div class="profile-membership-item">Best-time recommendation</div>
      `;
    }

    if (confirmBtn) {
      confirmBtn.dataset.plan = "premium";
      confirmBtn.textContent = "I HAVE COMPLETED MONTHLY PAYMENT";
    }
  }

  if (upgrade) upgrade.classList.remove("hidden");
  if (overlay) overlay.classList.remove("hidden");
}

function openPremiumUpgradeModal() {
  openPlanUpgradeModal("premium");
}

function openProUpgradeModal() {
  openPlanUpgradeModal("annual");
}

window.openPlanUpgradeModal = openPlanUpgradeModal;
window.openPremiumUpgradeModal = openPremiumUpgradeModal;
window.openProUpgradeModal = openProUpgradeModal;

