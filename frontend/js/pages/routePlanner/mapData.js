// Route planner data fetchers, map overlays, geocoding, and endpoint weather popups.
  async function fetchCameras() {
    const res = await fetch("/api/cameras?max=4000");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load cameras");
    return (data.value || []).map((cam, i) => ({
      id: cam.CameraID || `cam-${i}`,
      name: cam.Name || `Camera ${i + 1}`,
      source: cam.Source || "Unknown",
      lat: parseFloat(cam.Latitude),
      lon: parseFloat(cam.Longitude),
      imageLink: cam.ImageLink || null,
      hasRealtimeImage: Boolean(cam.HasRealtimeImage && cam.ImageLink)
    })).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  }

  async function fetchOneMotoringErpMarkers() {
    const res = await fetch("/api/onemotoring/erp");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load ERP markers");
    return Array.isArray(data.value) ? data.value : [];
  }

  async function fetchOneMotoringPgsMarkers() {
    const res = await fetch("/api/onemotoring/pgs");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load PGS markers");
    return Array.isArray(data.value) ? data.value : [];
  }

  async function fetchHotspotMarkers() {
    const res = await window.fastAuthFetch("/api/ml/map-hotspots");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to load hotspots");
    return json.data || [];
  }

  function formatRateLine(label, value) {
    const safe = String(value || "").trim();
    if (!safe) return "";
    return `<div><strong>${label}: </strong>${escapeHtml(safe)}</div>`;
  }

  function renderLocalErpRatesTable(localRates) {
    const rows = Array.isArray(localRates) ? localRates : [];
    if (!rows.length) return "";
    return `
      <div style="margin-top:8px;">
        <div style="font-weight:700;margin-bottom:6px;">ERP price bands</div>
        <div style="max-height:180px;overflow:auto;border:1px solid #dbeafe;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;background:#fff;">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Time</th>
                <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #dbeafe;position:sticky;top:0;background:#eff6ff;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.time || "")}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #eff6ff;">${escapeHtml(row.price || "")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function drawErpMarkers() {
    if (!state.liveMap || !state.liveErpLayer) return;
    state.liveErpLayer.clearLayers();
    if (!state.mapErpVisible) return;
    (state.mapErpItems || []).forEach((item) => {
      const localRatesHtml = renderLocalErpRatesTable(item.localRates);
      const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "ERP Gantry")}</div>
          ${item.gantryNo ? `<div style="margin-bottom:6px;"><strong>Gantry No: </strong>${escapeHtml(item.gantryNo)}</div>` : ``}
          ${localRatesHtml || ``}
          ${!localRatesHtml ? `<div>Pricing unavailable.</div>` : ``}
        </div>
      `;
      L.marker([item.lat, item.lon], {
        icon: getMapPoiIcon("erp")
      }).bindPopup(popupHtml).addTo(state.liveErpLayer);
    });
  }

  function drawPgsMarkers() {
    if (!state.liveMap || !state.livePgsLayer) return;
    state.livePgsLayer.clearLayers();
    if (!state.mapPgsVisible) return;
    (state.mapPgsItems || []).forEach((item) => {
      const rates = item.rates || null;
      const popupHtml = `
        <div style="font-size:12px;max-width:320px;">
          <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(item.name || "PGS Car Park")}</div>
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || "PGS Car Park")}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;" />` : ``}
          <div><strong>Available lots: </strong>${escapeHtml(item.availability || "N/A")}</div>
          <div><strong>Updated at: </strong>${escapeHtml(item.availabilityUpdatedAt || "N/A")}</div>
          ${rates ? `
            <hr style="border:none;border-top:1px solid #dbeafe;margin:8px 0;" />
            <div style="font-weight:700;margin-bottom:4px;">Official parking rates</div>
            ${formatRateLine("Weekdays before 5/6pm", rates.weekdayBefore)}
            ${formatRateLine("Weekdays after 5/6pm", rates.weekdayAfter)}
            ${formatRateLine("Saturdays", rates.saturday)}
            ${formatRateLine("Sundays / Public Holidays", rates.sunday)}
          ` : `<div style="margin-top:8px;">Official parking rate data not matched for this location.</div>`}
        </div>
      `;
      L.marker([item.lat, item.lon], {
        icon: getMapPoiIcon("pgs")
      }).bindPopup(popupHtml).addTo(state.livePgsLayer);
    });
  }

  async function toggleMapErpLayer() {
    if (!state.mapErpItems.length) {
      state.mapErpItems = await fetchOneMotoringErpMarkers();
    }
    state.mapErpVisible = !state.mapErpVisible;
    renderMapErpToggleButton();
    drawErpMarkers();
  }

  async function toggleMapPgsLayer() {
    if (!state.mapPgsItems.length) {
      state.mapPgsItems = await fetchOneMotoringPgsMarkers();
    }
    state.mapPgsVisible = !state.mapPgsVisible;
    renderMapPgsToggleButton();
    drawPgsMarkers();
  }
  async function drawHotspotMarkers() {
    if (!state.liveMap || !state.liveHotspotsLayer) return;
    state.liveHotspotsLayer.clearLayers();

    if (!state.mapHotspotsVisible) return;

    (state.mapHotspotsItems || []).forEach((item) => {
      const intensity = item.danger_score;
      const color = intensity > 100 ? "#ef4444" : "#f97316"; // Red for high, Orange for mid
      const label = intensity > 100 ? "HIGH FREQUENCY" : "MODERATE FREQUENCY";

      const popupHtml = `
      <div style="font-size:12px; min-width:180px; font-family: sans-serif;">
        <div style="margin-bottom:4px;">${label} ZONE</div>
        <div style="margin-bottom:6px; font-size:14px;">${item.road_name}</div>
        <hr style="border:none; border-top:1px solid #eee; margin:8px 0;" />
        <div style="display:flex; justify-content:space-between;"><span>Accidents:</span> <b>${item.accidents}</b></div>
        <div style="display:flex; justify-content:space-between;"><span>Breakdowns:</span> <b>${item.breakdowns}</b></div>
        <div style="display: flex; justify-content:space-between;"><span><b>Drive safely!</b></span> </div>
      </div>
    `;

      const hotspotIcon = L.divIcon({
        html: `
          <div style="
            width: 10px; 
            height: 10px; 
            background-color: ${color}; 
            border: 1.5px solid white; 
            border-radius: 50%; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.5);
          "></div>
        `,
        className: '',
        iconSize: [13, 13],
        iconAnchor: [6, 6]
      });

      L.marker([item.mid_lat, item.mid_lon], { icon: hotspotIcon })
        .bindPopup(popupHtml)
        .addTo(state.liveHotspotsLayer);
    });
  }
  // 地理编码：支持邮编/地名/MRT（后端做多源解析）
  async function geocodeLocation(inputText) {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(inputText)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Geocode failed");
    return {
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display: d.display || inputText,
      postal: d.postal || "",
      address: d.address || d.display || inputText
    };
  }

  async function reverseGeocodeLocation(lat, lon) {
    const r = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Reverse geocode failed");
    return {
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      display: d.display || "Current Location",
      postal: d.postal || "",
      address: d.address || d.display || "Current Location"
    };
  }

  async function getRouteEndpointWeather(lat, lon) {
    const r = await fetch(`/api/weather/current?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Weather fetch failed");
    return d;
  }

  function formatWeatherLabel(desc) {
    return String(desc || "--").split(" ").map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : "").join(" ");
  }

  async function buildRouteEndpointPopupHtml(label, fallbackGeo) {
    const lat = Number(fallbackGeo?.lat);
    const lon = Number(fallbackGeo?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return `<div style="font-size:12px;max-width:260px;"><strong>${escapeHtml(label)}</strong></div>`;
    }
    const [place, weather] = await Promise.all([
      reverseGeocodeLocation(lat, lon).catch(() => ({
        display: fallbackGeo?.display || label,
        postal: fallbackGeo?.postal || "",
        address: fallbackGeo?.address || fallbackGeo?.display || label
      })),
      getRouteEndpointWeather(lat, lon).catch(() => null)
    ]);
    const rawTitle = String(place.display || fallbackGeo?.display || label).trim();
    const rawAddress = String(place.address || fallbackGeo?.address || "").trim();
    let title = rawTitle;
    if (label === "Start" && String(fallbackGeo?.display || "").trim() === "Current Location") {
      let locationName = rawTitle;
      if (!locationName || locationName.toLowerCase() === "current location") {
        const firstAddressPart = rawAddress ? rawAddress.split(",")[0].trim() : "";
        locationName = firstAddressPart || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      title = `Current Location: ${locationName}`;
    }
    const postal = place.postal || fallbackGeo?.postal || "";
    const weatherText = weather ? `${weather.temp}°C · ${formatWeatherLabel(weather.desc)}` : "Weather unavailable";
    return `
      <div style="font-size:12px;max-width:280px;line-height:1.5;">
        <div><strong>${escapeHtml(label)}</strong></div>
        <div><strong>Name: </strong>${escapeHtml(title)}</div>
        ${postal ? `<div><strong>Postal Code: </strong>${escapeHtml(postal)}</div>` : ""}
        <div><strong>Weather: </strong>${escapeHtml(weatherText)}</div>
      </div>
    `;
  }
