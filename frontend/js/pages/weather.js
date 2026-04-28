// ================= 天气模块（UI_weather 融合版，继续走后端 API） =================

// 所有前端调用的后端 API 路由集中在这里，避免散落硬编码
const API_CONFIG = {
  weather: {
    currentUrl: "/api/weather/current",
    forecastUrl: "/api/weather/forecast",
  },
  ai: {
    weatherAdviceUrl: "/api/ai/weather-advice",
    incidentSummaryUrl: "/api/ai/incident-summary",
  },
  alerts: {
    trafficInfoFeedUrl: "/api/traffic-info-feed"
  }
};

// 天气模块入口：
// - 支持邮编/地名查询
// - 保存常用地点
// - 展示当前天气、短时预报、两日摘要和 AI 建议
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("postalCode");
  const button = document.getElementById("searchBtn");
  const saveBtn = document.getElementById("saveLocBtn");
  const refreshBtn = document.getElementById("refreshDataBtn");
  const weatherSuggestions = document.getElementById("weather-location-suggestions");
  const weatherCurrentLocationOption = document.getElementById("weather-current-location-option");

  if (!input || !button) return;

  const SAVED_KEY = "fast_saved_locations";
  let lastQuery = null;

  // 从 sessionStorage 读取天气页“已保存地点”
  function getSavedLocations() {
    try {
      return JSON.parse(sessionStorage.getItem(SAVED_KEY)) || [];
    } catch (_) {
      return [];
    }
  }

  // 写回已保存地点（仅用于当前浏览器会话）
  function setSavedLocations(locs) {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify(locs));
  }

  // 渲染已保存地点的“快捷 chip”，支持点击查询与单条删除
  function renderSavedLocations() {
    const locs = getSavedLocations();
    const container = document.getElementById("savedLocations");
    const emptyMsg = document.getElementById("savedEmpty");
    if (!container) return;
    container.querySelectorAll(".saved-chip").forEach((el) => el.remove());
    if (locs.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "";
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";
    locs.forEach((loc, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "saved-chip";
      chip.innerHTML = `📍 ${loc.label} <span class="chip-remove" data-i="${i}">×</span>`;
      chip.addEventListener("click", (e) => {
        if (e.target.classList.contains("chip-remove")) {
          const idx = parseInt(e.target.getAttribute("data-i"), 10);
          const updated = getSavedLocations().filter((_, j) => j !== idx);
          setSavedLocations(updated);
          renderSavedLocations();
          return;
        }
        input.value = loc.query;
        fetchWeather();
      });
      container.appendChild(chip);
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const query = input.value.trim();
      if (!query) return alert("Enter a location first before saving.");
      const locs = getSavedLocations();
      if (locs.find((l) => l.query === query)) return alert("Location already saved!");
      if (locs.length >= 4) return alert("Max 4 saved locations. Remove one first.");
      const label = query.length > 18 ? `${query.slice(0, 18)}…` : query;
      locs.push({ query, label });
      setSavedLocations(locs);
      renderSavedLocations();
    });
  }

  button.addEventListener("click", fetchWeather);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") fetchWeather();
  });
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (lastQuery) {
        input.value = lastQuery;
        fetchWeather();
      }
    });
  }
  renderSavedLocations();

  async function fetchFreshMobileLocationForWeather() {
    try {
      const r = await fetch("/api/mobile-location/latest");
      const data = await r.json();
      if (!r.ok) return null;
      if (data && data.fresh && Number.isFinite(Number(data.lat)) && Number.isFinite(Number(data.lon))) {
        return {
          lat: Number(data.lat),
          lon: Number(data.lon),
          display: "Current Location"
        };
      }
    } catch (_) {
      // ignore and fall back to browser location below
    }
    return null;
  }

  function getBrowserLocationForWeather() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Browser geolocation is not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: Number(pos.coords.latitude),
          lon: Number(pos.coords.longitude),
          display: "Current Location"
        }),
        () => reject(new Error("Unable to get your current location. Please enable browser location access.")),
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 30000
        }
      );
    });
  }

  async function getWeatherCurrentLocation() {
    const mobile = await fetchFreshMobileLocationForWeather();
    if (mobile) return mobile;
    return getBrowserLocationForWeather();
  }

  async function reverseGeocodeWeatherLocation(lat, lon) {
    const res = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Reverse geocode failed");
    return {
      address: data.address || data.display || "Current Location",
      postalCode: data.postal || "-",
      latitude: Number(data.lat),
      longitude: Number(data.lon),
      buildingName: data.display || data.address || "Current Location"
    };
  }

  function toggleWeatherLocationSuggestions(visible) {
    if (!weatherSuggestions) return;
    weatherSuggestions.classList.toggle("hidden", !visible);
  }

  function maybeShowWeatherLocationSuggestions() {
    const value = input.value.trim().toLowerCase();
    toggleWeatherLocationSuggestions(!value || "current location".includes(value));
  }

  input.addEventListener("focus", maybeShowWeatherLocationSuggestions);
  input.addEventListener("click", maybeShowWeatherLocationSuggestions);
  input.addEventListener("input", maybeShowWeatherLocationSuggestions);
  input.addEventListener("blur", () => {
    setTimeout(() => toggleWeatherLocationSuggestions(false), 120);
  });

  if (weatherCurrentLocationOption) {
    weatherCurrentLocationOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    weatherCurrentLocationOption.addEventListener("click", async () => {
      try {
        button.textContent = "⏳ Loading...";
        button.disabled = true;
        const loc = await getWeatherCurrentLocation();
        const location = await reverseGeocodeWeatherLocation(Number(loc.lat), Number(loc.lon));
        input.value = "Current Location";
        lastQuery = "Current Location";
        const weather = await getCurrentWeather(location.latitude, location.longitude);
        const forecast = await getForecast(location.latitude, location.longitude);
        const advice = await getGeminiAdvice(location, weather, forecast.hourly);

        updateLocationUI(location);
        updateWeatherUI(weather);
        updateForecastUI(forecast.hourly);
        updateAdviceUI(advice);
        updateSunUI(weather.sunrise, weather.sunset);
        updateTwoDayUI(forecast.days);
        updateTimestamp();
      } catch (err) {
        console.error(err);
        alert(err.message || "Weather fetch failed");
      } finally {
        button.textContent = "🔍 SEARCH";
        button.disabled = false;
        toggleWeatherLocationSuggestions(false);
      }
    });
  }

  document.addEventListener("click", (e) => {
    const inWeatherPicker = weatherSuggestions?.contains(e.target) || input.contains(e.target);
    if (!inWeatherPicker) toggleWeatherLocationSuggestions(false);
  });

  // 天气查询主流程：
  // 1) 地理编码 -> 2) 当前天气 -> 3) 预报 -> 4) AI 建议 -> 5) 批量更新 UI
  async function fetchWeather() {
    const query = input.value.trim();
    if (!query) return alert("Please enter postal code or location");
    lastQuery = query;
    button.textContent = "⏳ Loading...";
    button.disabled = true;
    try {
      const location = await getLocation(query);
      const weather = await getCurrentWeather(location.latitude, location.longitude);
      const forecast = await getForecast(location.latitude, location.longitude);
      const advice = await getGeminiAdvice(location, weather, forecast.hourly);

      updateLocationUI(location);
      updateWeatherUI(weather);
      updateForecastUI(forecast.hourly);
      updateAdviceUI(advice);
      updateSunUI(weather.sunrise, weather.sunset);
      updateTwoDayUI(forecast.days);
      updateTimestamp();
    } catch (err) {
      console.error(err);
      alert("Weather fetch failed");
    } finally {
      button.textContent = "🔍 SEARCH";
      button.disabled = false;
    }
  }

  // 统一地理编码入口：兼容邮编、地名、MRT 等输入
  async function getLocation(searchVal) {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchVal)}`);
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || "Location not found");
    return {
      address: r.display || searchVal,
      postalCode: r.postal || "-",
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon),
      buildingName: r.building || "-"
    };
  }

  // 获取当前天气（后端已处理第三方 API key 与容错）
  async function getCurrentWeather(lat, lon) {
    const url = `${API_CONFIG.weather.currentUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Weather fetch failed");
    return {
      ...data,
      sunrise: Number.isFinite(data.sunrise) ? data.sunrise : null,
      sunset: Number.isFinite(data.sunset) ? data.sunset : null
    };
  }

  // 获取小时级预报，并兼容后端不同字段结构（value/hourly）
  async function getForecast(lat, lon) {
    const url = `${API_CONFIG.weather.forecastUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Forecast fetch failed");

    const hourly = Array.isArray(data.value)
      ? data.value
      : Array.isArray(data.hourly)
        ? data.hourly
        : [];

    return {
      hourly,
      days: buildTwoDaySummary(hourly)
    };
  }

  // 将小时预报聚合成“今天/明天”两张摘要卡（高低温、天气描述、降雨概率）
  function buildTwoDaySummary(hourly) {
    const grouped = new Map();
    hourly.forEach((item) => {
      if (!item || !item.dt) return;
      const key = new Date(item.dt * 1000).toISOString().slice(0, 10);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    });

    const dayKeys = Array.from(grouped.keys()).sort().slice(0, 2);
    const result = dayKeys.map((key, i) => {
      const list = grouped.get(key) || [];
      const temps = list.map((x) => Number(x.temp)).filter((n) => Number.isFinite(n));
      const pops = list.map((x) => Number(x.pop)).filter((n) => Number.isFinite(n));
      const mid = list[Math.floor(list.length / 2)] || {};
      return {
        label: i === 0 ? "TODAY" : "TOMORROW",
        high: temps.length ? Math.round(Math.max(...temps)) : "--",
        low: temps.length ? Math.round(Math.min(...temps)) : "--",
        desc: String(mid.desc || "--"),
        icon: weatherMainFromDesc(mid.desc),
        pop: pops.length ? Math.max(...pops) : 0
      };
    });

    while (result.length < 2) {
      result.push({
        label: result.length === 0 ? "TODAY" : "TOMORROW",
        high: "--",
        low: "--",
        desc: "--",
        icon: "Clouds",
        pop: 0
      });
    }
    return result;
  }

  function weatherMainFromDesc(desc) {
    const text = String(desc || "").toLowerCase();
    if (text.includes("thunder")) return "Thunderstorm";
    if (text.includes("drizzle")) return "Drizzle";
    if (text.includes("rain")) return "Rain";
    if (text.includes("snow")) return "Snow";
    if (text.includes("mist") || text.includes("fog") || text.includes("haze")) return "Mist";
    if (text.includes("clear") || text.includes("sun")) return "Clear";
    return "Clouds";
  }

  // 调用后端 AI 建议接口；失败时走本地 fallback，保证页面总能展示建议文本
  async function getGeminiAdvice(location, weather, forecast) {
    const future = forecast.map((f) => {
      const t = new Date(f.dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `${t}: ${f.desc}, ${f.temp}°C, rain chance ${f.pop}%`;
    }).join("\n");

    const res = await fetch(API_CONFIG.ai.weatherAdviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: { display: location.address },
        weather,
        forecast
      })
    });
    if (!res.ok) return fallbackAdvice(weather, forecast);
    const data = await res.json();
    return data?.text || fallbackAdvice(weather, forecast);
  }

  function fallbackAdvice(weather, forecast) {
    let text = `• Now ${weather.temp}°C (${weather.desc}).\n`;
    if (weather.temp > 30) text += "• Quite hot, wear light clothes.\n";
    if (forecast.some((f) => f.pop > 35)) text += "• Possible rain, bring umbrella.\n";
    text += "• Drive carefully if road wet.\n";
    return text;
  }

  function updateLocationUI(loc) {
    document.getElementById("loc-address").textContent = loc.address;
    document.getElementById("loc-postal").textContent = loc.postalCode;
    document.getElementById("loc-coords").textContent = `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`;
    document.getElementById("loc-building").textContent = loc.buildingName;
  }

  function updateWeatherUI(w) {
    document.getElementById("weather-temp").textContent = `${w.temp}°C`;
    document.getElementById("weather-desc").textContent = String(w.desc || "--").toUpperCase();
    document.getElementById("weather-feels").textContent = `Feels like ${w.feels}°C`;
    document.getElementById("weather-humidity").textContent = `${w.humidity}%`;
    document.getElementById("weather-wind").textContent = `${w.wind} m/s`;
    document.getElementById("weather-pressure").textContent = `${w.pressure} hPa`;
    document.getElementById("weather-visibility").textContent = `${w.visibility} km`;
  }

  function updateForecastUI(hourly) {
    for (let i = 0; i < 3; i += 1) {
      const item = hourly[i];
      const idx = i + 1;
      const timeEl = document.getElementById(`forecast-time-${idx}`);
      const tempEl = document.getElementById(`forecast-temp-${idx}`);
      const descEl = document.getElementById(`forecast-desc-${idx}`);
      const rainEl = document.getElementById(`forecast-rain-${idx}`);
      if (!item) {
        timeEl.textContent = "--";
        tempEl.textContent = "--°C";
        descEl.textContent = "--";
        rainEl.textContent = "";
        continue;
      }
      const time = new Date(item.dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      timeEl.textContent = time;
      tempEl.textContent = `${item.temp}°C`;
      descEl.textContent = String(item.desc || "--").toUpperCase();
      rainEl.textContent = item.pop > 30 ? `🌧️ ${item.pop}%` : "";
    }
  }

  // 将 AI 返回的自然语言拆分为结构化提示，便于卡片化展示
  function parseAdviceText(text) {
    const lines = String(text || "")
      .split("\n")
      .map((line) => line.replace(/^•\s?/, "").trim())
      .filter(Boolean);
    const categories = ["Outdoor Conditions", "Attire", "Rain Advisory", "Road Safety"];
    return categories.map((category, idx) => ({
      category,
      tip: lines[idx] || "No extra advice for now.",
      level: idx === 2 && /rain|storm|thunder|umbrella/i.test(lines[idx] || "") ? "warning" : "good"
    }));
  }

  // 根据结构化提示渲染建议卡片（类别、图标、风险等级）
  function updateAdviceUI(text) {
    const container = document.getElementById("weather-advice");
    if (!container) return;
    container.innerHTML = "";
    const tips = parseAdviceText(text);
    const META = {
      "Outdoor Conditions": { icon: "🚶" },
      "Attire": { icon: "👕" },
      "Rain Advisory": { icon: "☂️" },
      "Road Safety": { icon: "🚗" }
    };
    tips.forEach((tip) => {
      const meta = META[tip.category] || { icon: "💡" };
      const div = document.createElement("div");
      div.className = `advice-tip advice-${tip.level}`;
      div.setAttribute("data-cat", tip.category);
      div.innerHTML = `
        <span class="advice-icon">${meta.icon}</span>
        <div class="advice-content">
          <span class="advice-label">${tip.category.toUpperCase()}</span>
          <span class="advice-text">${tip.tip}</span>
        </div>
        <span class="advice-badge">${tip.level.toUpperCase()}</span>
      `;
      container.appendChild(div);
    });
  }

  // 渲染日出/日落与白天时长；若缺失数据则显示占位值
  function updateSunUI(sunriseTs, sunsetTs) {
    const riseEl = document.getElementById("sun-rise");
    const setEl = document.getElementById("sun-set");
    const daylightEl = document.getElementById("sun-daylight");
    if (!riseEl || !setEl || !daylightEl) return;
    if (!Number.isFinite(sunriseTs) || !Number.isFinite(sunsetTs) || sunsetTs <= sunriseTs) {
      riseEl.textContent = "--:--";
      setEl.textContent = "--:--";
      daylightEl.textContent = "-- hrs";
      return;
    }
    const fmt = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diffMs = (sunsetTs - sunriseTs) * 1000;
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    riseEl.textContent = fmt(sunriseTs);
    setEl.textContent = fmt(sunsetTs);
    daylightEl.textContent = `${hrs}h ${mins}m`;
  }

  function getWeatherEmoji(iconMain) {
    const map = {
      Thunderstorm: "⛈️",
      Drizzle: "🌦️",
      Rain: "🌧️",
      Snow: "❄️",
      Mist: "🌫️",
      Fog: "🌫️",
      Haze: "🌫️",
      Clear: "☀️",
      Clouds: "☁️"
    };
    return map[iconMain] || "🌤️";
  }

  // 渲染今日/明日两日概览卡
  function updateTwoDayUI(days) {
    for (let i = 0; i < 2; i += 1) {
      const day = days[i] || {};
      const n = i + 1;
      document.getElementById(`twoday-label-${n}`).textContent = day.label || (n === 1 ? "TODAY" : "TOMORROW");
      document.getElementById(`twoday-icon-${n}`).textContent = getWeatherEmoji(day.icon);
      document.getElementById(`twoday-desc-${n}`).textContent = String(day.desc || "--").toUpperCase();
      document.getElementById(`twoday-high-${n}`).textContent = Number.isFinite(day.high) ? `${day.high}°` : "--°";
      document.getElementById(`twoday-low-${n}`).textContent = Number.isFinite(day.low) ? `${day.low}°` : "--°";
      document.getElementById(`twoday-rain-${n}`).textContent = day.pop > 0 ? `🌧️ ${day.pop}% rain chance` : "☀️ No rain expected";
    }
  }

  // 更新时间戳（仅代表本页面数据刷新时间）
  function updateTimestamp() {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const el = document.getElementById("lastUpdatedTime");
    const wrap = document.getElementById("weatherTimestamp");
    if (el) el.textContent = time;
    if (wrap) wrap.style.display = "flex";
  }

});
