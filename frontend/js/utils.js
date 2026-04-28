// Shared frontend utilities used across pages.

  // 读取当前登录用户（来自前面 auth 模块的 sessionStorage 封装）
  function getAuthUser() {
    return window.getFastAuth && window.getFastAuth() ? window.getFastAuth().user : null;
  }

  // 是否管理员：用于控制模拟功能/数据源切换按钮显隐
  function isAdmin() {
    const user = getAuthUser();
    return !!(user && user.role === "admin");
  }

  // 通用距离函数（米）：路径评估、事故匹配、点位去重都会用到
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 路径规划计算已统一迁移到后端（Node + Python）。
  // 前端仅保留坐标兼容函数，用于绘图和旧数据结构回退。
  function getRouteCoords(routeOption, startCoord, endCoord) {
    if (Array.isArray(routeOption?.coords) && routeOption.coords.length >= 2) {
      return routeOption.coords;
    }
    const coords = [[startCoord.lat, startCoord.lon]];
    for (const n of routeOption.path) coords.push([n.lat, n.lon]);
    coords.push([endCoord.lat, endCoord.lon]);
    return coords;
  }

  // 计算点到路线的最短距离（简化为到顶点最短距离）
  function distanceToRouteMeters(routeCoords, lat, lon) {
    let best = Infinity;
    for (const c of routeCoords || []) {
      const d = haversine(lat, lon, c[0], c[1]);
      if (d < best) best = d;
    }
    return best;
  }

  function getNearestRoutePointIndex(routeCoords, lat, lon) {
    let best = Infinity;
    let bestIndex = 0;
    (routeCoords || []).forEach((c, idx) => {
      const d = haversine(lat, lon, c[0], c[1]);
      if (d < best) {
        best = d;
        bestIndex = idx;
      }
    });
    return { index: bestIndex, distance: best };
  }

  function splitRouteProgress(routeCoords, lat, lon) {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) {
      return { travelled: [], remaining: [] };
    }
    const nearest = getNearestRoutePointIndex(routeCoords, lat, lon);
    const clampedIndex = Math.max(0, Math.min(routeCoords.length - 1, nearest.index));
    return {
      travelled: routeCoords.slice(0, clampedIndex + 1),
      remaining: routeCoords.slice(clampedIndex),
      distanceToRoute: nearest.distance
    };
  }

  // 事故文本 -> 严重度分级（高/中/低）
  function getIncidentSeverityScore(incident) {
    const text = `${incident?.type || ""} ${incident?.message || ""}`.toLowerCase();
    if (/(accident|collision|overturned|fire|fatal|crash)/.test(text)) return 3;
    if (/(congestion|jam|heavy traffic|road block|roadwork|construction)/.test(text)) return 2;
    return 1;
  }

  // 严重度 -> 颜色（用于点位、告警点、标签）
  function getIncidentSeverityColor(incident) {
    const score = getIncidentSeverityScore(incident);
    if (score >= 3) return "red";
    if (score === 2) return "orange";
    return "green";
  }

  // 严重度 -> 文案标签（HIGH/MEDIUM/LOW IMPACT）
  function getIncidentImpactLabel(incident) {
    const score = getIncidentSeverityScore(incident);
    if (score >= 3) return "HIGH IMPACT";
    if (score === 2) return "MEDIUM IMPACT";
    return "LOW IMPACT";
  }

  // 基础 XSS 防护：所有动态文本渲染前统一转义
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 统一事故时间格式，避免各处展示不一致
  function formatIncidentTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleString("en-SG", { hour12: true });
  }

  // 事故标题优先级：message > type > 默认文案
  function incidentTitle(incident) {
    return incident?.message || incident?.type || "Traffic incident";
  }

  // 资讯流时间格式（与事故时间分开，便于后续独立改样式）
  function formatFeedTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString("en-SG", { hour12: true });
  }

  // 影响范围文案格式化（km）
  function getIncidentSpreadText(incident) {
    const r = Number(incident?.spreadRadiusKm);
    if (!Number.isFinite(r) || r <= 0) return "N/A";
    return `${r.toFixed(1)} km`;
  }

  // 预计影响时长文案格式化（分钟区间）
  function getIncidentDurationText(incident) {
    const minV = Number(incident?.estimatedDurationMin);
    const maxV = Number(incident?.estimatedDurationMax);
    if (Number.isFinite(minV) && Number.isFinite(maxV)) {
      return `${Math.round(minV)}-${Math.round(maxV)} mins`;
    }
    return "N/A";
  }

  // 解析事故开始时间：
  // - 优先从 LTA 消息前缀 "(d/m)HH:MM" 提取
  // - 提取失败时回退 createdAt
  function getIncidentStartTimestamp(incident) {
    const msg = String(incident?.message || "");
    const m = msg.match(/^\((\d{1,2})\/(\d{1,2})\)\s*(\d{1,2}):(\d{2})/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const hour = Number(m[3]);
      const minute = Number(m[4]);
      const now = new Date();
      const year = now.getFullYear();
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const ts = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
        if (Number.isFinite(ts)) {
          // 若解析出来是未来时间，按上一年处理（跨年边界容错）
          if (ts > Date.now() + 60 * 1000) {
            return new Date(year - 1, month - 1, day, hour, minute, 0, 0).getTime();
          }
          return ts;
        }
      }
    }
    const createdTs = new Date(incident?.createdAt || "").getTime();
    return Number.isFinite(createdTs) ? createdTs : NaN;
  }

  // 计算“已发生多久”，供地图弹窗和详情页实时展示
  function getIncidentElapsedText(incident) {
    const startTs = getIncidentStartTimestamp(incident);
    if (!Number.isFinite(startTs)) return "N/A";
    const diffMs = Math.max(0, Date.now() - startTs);
    const totalMin = Math.floor(diffMs / 60000);
    const hour = Math.floor(totalMin / 60);
    const minute = totalMin % 60;
    return hour > 0 ? `${hour}h ${minute}m` : `${minute}m`;
  }

  // 根据开始时间 + 预计持续区间，推算预计清除时间窗口
  function getIncidentEstimatedClearText(incident) {
    const createdTs = getIncidentStartTimestamp(incident);
    const minV = Number(incident?.estimatedDurationMin);
    const maxV = Number(incident?.estimatedDurationMax);
    if (!Number.isFinite(createdTs) || !Number.isFinite(minV) || !Number.isFinite(maxV)) return "N/A";
    const minTime = new Date(createdTs + Math.max(0, minV) * 60000);
    const maxTime = new Date(createdTs + Math.max(0, maxV) * 60000);
    const fmt = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (Math.round(minV) === Math.round(maxV)) return fmt(minTime);
    return `${fmt(minTime)} - ${fmt(maxTime)}`;
  }

  // 事故排序：按时间/按严重度
  function sortIncidents(incidents, mode) {
    const list = [...(incidents || [])];
    if (mode === "severity") {
      return list.sort((a, b) => {
        const sd = getIncidentSeverityScore(b) - getIncidentSeverityScore(a);
        if (sd !== 0) return sd;
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
    }
    return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  function mapLiveIncidentsToRouteEvents(incidents) {
    return (Array.isArray(incidents) ? incidents : [])
      .map((incident, index) => {
        const lat = Number(incident?.lat);
        const lon = Number(incident?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const severity = Math.max(1, Math.min(3, getIncidentSeverityScore(incident) || 1));
        const delayMin = severity === 3 ? 12 : severity === 2 ? 8 : 4;
        return {
          id: incident.id || `live-incident-${index + 1}`,
          type: String(incident?.type || "incident"),
          label: String(incident?.type || "Traffic incident"),
          color: severity === 3 ? "#ef4444" : severity === 2 ? "#f59e0b" : "#a855f7",
          severity,
          delayMin,
          lat,
          lon,
          area: String(incident?.area || ""),
          message: String(incident?.message || ""),
          reason: String(incident?.message || incident?.type || "Live traffic incident"),
          createdAt: incident?.createdAt || new Date().toISOString()
        };
      })
      .filter(Boolean);
  }

  // 给事件附上附近摄像头（最多 2 个），用于详情展示证据
  function attachEventCameras(events, cameras) {
    return events.map((evt) => {
      const nearby = cameras
        .map(cam => ({ ...cam, dist: haversine(evt.lat, evt.lon, cam.lat, cam.lon) }))
        .filter(cam => cam.dist <= 1500)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);
      return { ...evt, cameras: nearby };
    });
  }

  // 后端 Python：路线事件筛选（优先）
  async function analyzeEventsViaBackend(events, userLoc, routeCoords) {
    const resp = await fetch("/api/route-events/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: Array.isArray(events) ? events : [],
        userLoc: userLoc || null,
        routeCoords: Array.isArray(routeCoords) ? routeCoords : []
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Route event analyze failed");
    return Array.isArray(data.value) ? data.value : [];
  }

  // 后端 Python：路线事件评分/拥堵评估（优先）
  async function evaluateRoutesByEventsViaBackend(routeOptions, events) {
    const resp = await fetch("/api/route-events/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routes: (routeOptions || []).map((r) => ({
          id: r.id,
          estMinutes: r.estMinutes,
          coords: Array.isArray(r.coords) ? r.coords : []
        })),
        events: Array.isArray(events) ? events : []
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Route event evaluate failed");

    const evaluations = new Map();
    const rows = Array.isArray(data.evaluations) ? data.evaluations : [];
    rows.forEach((it) => {
      const routeId = it.routeId;
      if (!routeId) return;
      evaluations.set(routeId, {
        hitCount: Number(it.hitCount) || 0,
        eventDelayMin: Number(it.eventDelayMin) || 0,
        score: Number(it.score) || Infinity,
        hits: Array.isArray(it.hits) ? it.hits : []
      });
    });
    const fallbackId = routeOptions?.[0]?.id || null;
    return {
      evaluations,
      recommendedRouteId: data.recommendedRouteId || fallbackId,
      currentFastestId: data.currentFastestId || fallbackId
    };
  }

  // 根据评估结果计算“当前Fastest by time路线”（兼容本地/后端两种评估结果）
  function deriveCurrentFastestId(routeOptions, evaluation) {
    const routes = Array.isArray(routeOptions) ? routeOptions : [];
    if (!routes.length) return null;
    const evalMap = evaluation?.evaluations;
    let fastestId = routes[0].id;
    let bestMinutes = Infinity;
    routes.forEach((p) => {
      const e = evalMap?.get?.(p.id) || { eventDelayMin: 0 };
      const total = Number(p.estMinutes || 0) + (Number(e.eventDelayMin || 0) * 0.7);
      if (total < bestMinutes) {
        bestMinutes = total;
        fastestId = p.id;
      }
    });
    return fastestId;
  }

  function getLocationErrorMessage(err) {
    if (!err) return "Unable to get your current location.";
    if (err.code === 1) return "Location access was denied. Please allow browser location access.";
    if (err.code === 2) return "Your location is currently unavailable. Please check device location services.";
    if (err.code === 3) return "Location request timed out. Please try again in an open area.";
    return "Unable to get your current location.";
  }

  function requestBrowserLocation(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        options
      );
    });
  }

  async function fetchLatestMobileLocation() {
    const r = await fetch("/api/mobile-location/latest");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Failed to load mobile location");
    if (!d || !d.fresh || !Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lon))) return null;
    return {
      lat: Number(d.lat),
      lon: Number(d.lon),
      accuracy: Number.isFinite(Number(d.accuracy)) ? Number(d.accuracy) : null,
      source: "mobile",
      deviceName: d.deviceName || "Mobile device"
    };
  }

  // 获取浏览器定位：先尝试高精度，再回退普通精度
  function getUserLocation() {
    return fetchLatestMobileLocation()
      .catch(() => null)
      .then((mobileLoc) => {
        if (mobileLoc) return mobileLoc;
        return requestBrowserLocation({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
          .catch((err) => {
            if (err && err.code === 1) throw err;
            return requestBrowserLocation({ enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
          });
      });
  }

  async function useCurrentLocationAsRouteStart() {
    const startInput = document.getElementById("route-start-postal");
    const hintEl = document.getElementById("route-planning-hint");
    try {
      const currentLoc = await getUserLocation();
      if (!currentLoc) {
        throw new Error("Unable to get your current location.");
      }
      state.routeStartCurrentGeo = currentLoc;
      if (startInput) startInput.value = "Current Location";
      if (hintEl) hintEl.textContent = "Current location has been set as the route start.";
    } catch (err) {
      state.routeStartCurrentGeo = null;
      alert(getLocationErrorMessage(err));
    }
  }

  function toggleRouteStartSuggestions(visible) {
    const box = document.getElementById("route-start-suggestions");
    if (!box) return;
    box.classList.toggle("hidden", !visible);
  }
