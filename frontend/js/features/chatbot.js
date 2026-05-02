// ANALYZE EXPRESSWAYS section
async function refreshExpresswayDashboard() {
  const container = document.getElementById("expressway-forecast-grid");
  if (!container) return;

  try {
    const res = await window.fastAuthFetch("/api/ml/expressway-forecast");
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    const data = await res.json();
    let expresswaysHTML = "";
    for (let expressway in data) {
      let expressway_data = data[expressway]
      let sectorsHTML = "";
      let tabsHTML = "";

      const totalJams = (expressway_data.sectors || []).reduce(
        (sum, sector) => sum + (sector.jammed_count || 0),
        0
      );

      for (let i = 0; i < expressway_data.sectors.length; i++) {
        let sector = expressway_data.sectors[i];
        let isActive = i === 0 ? "active" : "";

        let statusClass = "status-clear";
        if (sector.jammed_count > 5) statusClass = "status-jammed";
        else if (sector.jammed_count > 0) statusClass = "status-warning";

        tabsHTML += `
            <button type="button" 
              class="analytics-tab-btn ${isActive}" 
              data-expressway="${expressway}" 
              data-sector="${sector.name}">
              ${sector.name}
            </button>
          `;

        sectorsHTML += `
          <div class="analytics-sector ${isActive} ${statusClass}" 
            data-expressway-panel="${expressway}" 
            data-sector-panel="${sector.name}">
            <div class="analytics-stat-line">⚠️ Jammed: <strong>${sector.jammed_count}</strong></div>
            <div class="analytics-stat-line">⬆️ Recovering: <strong>${sector.recovering_count}</strong></div>
            <div class="analytics-stat-line">🚦 Current Band: <strong>${sector.current_avg_speed ?? "-"}</strong></div>
            <div class="analytics-stat-line">⚡ T+15 Band: <strong>${sector.avg_speed ?? "-"}</strong></div>
            <div class="analytics-stat-line">🚧 Incidents: <strong>${sector.incidents_count}</strong></div>
          </div>
        `;
      }

      expresswaysHTML += `
          <div class="exp-card">
            <div class="exp-header">${expressway}</div>
            <div class="exp-total-jams"> ⚠️ Total Jams: ${totalJams} </div>
            <div class="tab-bar">${tabsHTML}</div>
            <div class="sector-container">
              ${sectorsHTML}
            </div>
          </div>
        `;
    }

    container.innerHTML = expresswaysHTML;
  } catch (err) {
    console.error("Expressway dashboard failed:", err);
    container.innerHTML = `<div style="color: #ef4444; font-size: 0.8rem;">Failed to load expressway forecast.</div>`;
  }
}

// Helper to show/hide tabs
document.addEventListener("click", function (e) {
  const btn = e.target.closest(".analytics-tab-btn");
  if (!btn) return;

  const card = btn.closest(".exp-card");
  if (!card) return;

  const expressway = btn.dataset.expressway;
  const sector = btn.dataset.sector;

  card.querySelectorAll(".analytics-tab-btn").forEach(b => {
    b.classList.remove("active");
  });

  card.querySelectorAll(".analytics-sector").forEach(panel => {
    panel.classList.remove("active");
  });

  btn.classList.add("active");

  const targetPanel = card.querySelector(
    `.analytics-sector[data-expressway-panel="${expressway}"][data-sector-panel="${sector}"]`
  );

  if (targetPanel) {
    targetPanel.classList.add("active");
  }
});


document.getElementById("map-toggle-hotspots-btn").addEventListener("click", async () => {
  state.mapHotspotsVisible = !state.mapHotspotsVisible;

  if (state.mapHotspotsVisible && !Array.isArray(state.mapHotspotsItems)) {
    state.mapHotspotsItems = [];
  }

  if (state.mapHotspotsVisible && state.mapHotspotsItems.length === 0) {
    const data = await fetchHotspotMarkers();

    state.mapHotspotsItems = Array.isArray(data)
      ? data
      : data.hotspots || data.items || data.data || [];
  }

  renderMapHotspotsToggleButton();
  drawHotspotMarkers();
});



function speedBandToColor(sb) {
  if (sb == null) return "#94a3b8";
  if (sb <= 3) return "#ef4444";
  if (sb <= 5) return "#f59e0b";
  return "#22c55e";
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSegmentMidpoint(seg) {
  const startLat = Number(seg.start[0]);
  const startLon = Number(seg.start[1]);
  const endLat = Number(seg.end[0]);
  const endLon = Number(seg.end[1]);

  return {
    lat: (startLat + endLat) / 2,
    lon: (startLon + endLon) / 2
  };
}

function findNearestLandmark(seg, landmarks, maxDistanceMeters = 1200) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return null;

  const mid = getSegmentMidpoint(seg);

  let best = null;
  let bestDistance = Infinity;

  landmarks.forEach(lm => {
    const lat = Number(lm.lat);
    const lon = Number(lm.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const d = distanceMeters(mid.lat, mid.lon, lat, lon);

    if (d < bestDistance) {
      bestDistance = d;
      best = lm;
    }
  });

  if (!best || bestDistance > maxDistanceMeters) return null;

  return {
    label: best.label || best.landmark_name || "Nearby landmark",
    distance_m: Math.round(bestDistance)
  };
}

function getSectorSummaries(segments) {
  const sectors = {};

  segments.forEach(seg => {
    const sector = seg.sector || "Unknown";

    if (!sectors[sector]) {
      sectors[sector] = {
        name: sector,
        total: 0,
        currentJammed: 0,
        predictedJammed: 0,
        worsening: 0,
        moderatePredicted: 0,
        worstPredicted: 8,
        riskScore: 0
      };
    }

    const s = sectors[sector];
    const now = Number(seg.current_val);
    const pred = Number(seg.predicted_val);

    s.total += 1;

    if (Number.isFinite(now) && now <= 3) s.currentJammed += 1;
    if (Number.isFinite(pred) && pred <= 3) s.predictedJammed += 1;
    if (Number.isFinite(pred) && pred > 3 && pred <= 5) s.moderatePredicted += 1;

    if (Number.isFinite(now) && Number.isFinite(pred) && now - pred >= 2) {
      s.worsening += 1;
    }

    if (Number.isFinite(pred)) {
      s.worstPredicted = Math.min(s.worstPredicted, pred);
    }
  });

  return Object.values(sectors).map(s => {
    s.riskScore =
      (s.predictedJammed * 3) +
      (s.currentJammed * 2) +
      (s.worsening * 2) +
      s.moderatePredicted;

    if (s.predictedJammed >= 5 || s.worstPredicted <= 2) {
      s.status = "Congested";
      s.statusClass = "bad";
    } else if (s.predictedJammed >= 1 || s.worsening >= 3) {
      s.status = "Possible Delay";
      s.statusClass = "moderate";
    } else {
      s.status = "Clear";
      s.statusClass = "clear";
    }

    return s;
  });
}

function getWorstSector(sectors) {
  if (!sectors.length) return null;
  return [...sectors].sort((a, b) => b.riskScore - a.riskScore)[0];
}

function getKeyStretches(segments, landmarks, maxCount = 5) {
  const grouped = new Map();

  (segments || []).forEach(seg => {
    const now = Number(seg.current_val);
    const pred = Number(seg.predicted_val);

    const stretchName =
      seg.nearest_landmark ||
      findNearestLandmark(seg, landmarks || [])?.label ||
      seg.road_name ||
      "Unknown stretch";

    const key = `${stretchName}_${seg.sector || ""}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        stretchName,
        sector: seg.sector || "Unknown sector",
        worstCurrent: 8,
        worstPredicted: 8,
        predictedJammed: 0,
        currentJammed: 0,
        worsening: 0,
        moderatePredicted: 0,
        riskScore: 0
      });
    }

    const g = grouped.get(key);

    if (Number.isFinite(now)) {
      g.worstCurrent = Math.min(g.worstCurrent, now);
      if (now <= 3) g.currentJammed += 1;
    }

    if (Number.isFinite(pred)) {
      g.worstPredicted = Math.min(g.worstPredicted, pred);
      if (pred <= 3) g.predictedJammed += 1;
      if (pred > 3 && pred <= 5) g.moderatePredicted += 1;
    }

    if (Number.isFinite(now) && Number.isFinite(pred) && now - pred >= 2) {
      g.worsening += 1;
    }
  });

  return Array.from(grouped.values())
    .map(g => {
      g.riskScore =
        (g.predictedJammed * 100) +
        (g.currentJammed * 60) +
        (g.worsening * 80) +
        (g.moderatePredicted * 20);

      return {
        stretchName: g.stretchName,
        sector: g.sector,
        current_val: g.worstCurrent === 8 && g.currentJammed === 0 ? g.worstCurrent : g.worstCurrent,
        predicted_val: g.worstPredicted,
        riskScore: g.riskScore
      };
    })
    .filter(s => s.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, maxCount);
}

function getRepresentativeStretches(segments, landmarks, maxCount = 3) {
  const seen = new Set();
  const result = [];

  for (const seg of segments || []) {
    const nearest = findNearestLandmark(seg, landmarks || []);
    const name = nearest?.label || seg.road_name;

    if (!name || seen.has(name)) continue;

    seen.add(name);
    result.push({
      ...seg,
      stretchName: name,
      riskScore: 0
    });

    if (result.length >= maxCount) break;
  }

  return result;
}

function speedBandText(sb) {
  sb = Number(sb);
  if (!Number.isFinite(sb)) return "Unknown";
  if (sb <= 3) return "Congested";
  if (sb <= 5) return "Moderate";
  return "Clear";
}

function renderExpresswayInfoPanel(data) {

  const panel = document.getElementById("expressway-info-panel");
  const title = document.getElementById("expressway-panel-title");
  const body = document.getElementById("expressway-panel-body");

  if (!panel || !title || !body) return;

  const segments = data.segments || [];
  const landmarks = data.landmarks || [];

  const sectorSummaries = getSectorSummaries(segments);
  const worstSector = getWorstSector(sectorSummaries);

  let keyStretches = getKeyStretches(segments, landmarks, 5);
  const majorLandmarks = getMajorLandmarks(landmarks, 10);

  const overall =
    sectorSummaries.some(s => s.status === "Congested") ? "Congested" :
      sectorSummaries.some(s => s.status === "Possible Delay") ? "Possible Delay" :
        "Clear";

  const badgeClass =
    overall === "Congested" ? "impact-severe" :
      overall === "Possible Delay" ? "impact-moderate" :
        "impact-low";

  title.textContent = `${data.code} · ${data.full_name || ""}`;

  body.innerHTML = `
    <div class="incident-ml-card">
      <div class="incident-ml-card-title">EXPRESSWAY STATUS</div>

      <div class="incident-ml-severity-row">
        <div class="incident-ml-score-circle">
          <span class="incident-ml-score-num">${worstSector?.predictedJammed ?? 0}</span>
          <span class="incident-ml-score-denom">T+15 jams</span>
        </div>

        <div class="incident-ml-severity-info">
          <div class="incident-ml-badge ${badgeClass}">
            ${overall}
          </div>
          <div class="incident-ml-summary">
            ${worstSector
      ? `${worstSector.name} has ${worstSector.predictedJammed} predicted jammed links and ${worstSector.worsening} worsening links.`
      : "No expressway sector data available."
    }
          </div>
        </div>
      </div>

      <div class="incident-ml-stats">
        <div class="incident-ml-stat">
          <div class="incident-ml-stat-label">MOST AFFECTED SECTOR</div>
          <div class="incident-ml-stat-value">${escapeHtml(worstSector?.name || "Unknown")}</div>
        </div>

        <div class="incident-ml-stat">
          <div class="incident-ml-stat-label">STATUS</div>
          <div class="incident-ml-stat-value">${escapeHtml(overall)}</div>
        </div>
      </div>
    </div>

    <div class="incident-ml-affected-roads">
      <div class="incident-ml-affected-roads-title">SECTOR SUMMARY</div>

      <div class="expressway-sector-list">
        ${sectorSummaries.map(s => `
            <div class="expressway-sector-row ${s.statusClass}">
              <div class="sector-main">
                <strong>${escapeHtml(s.name)}</strong>
                <span>${s.predictedJammed} predicted jam - ${s.worsening} worsening</span>
              </div>
              <b>${escapeHtml(s.status)}</b>
            </div>
          `).join("")
    }
      </div>
    </div>

    <div class="incident-ml-affected-roads">
      <div class="incident-ml-affected-roads-title">KEY STRETCHES</div>

      ${keyStretches.length
      ? `<div class="expressway-stretch-list">
            ${keyStretches.map(s => `
              <div class="expressway-stretch-row">
                <strong>${escapeHtml(s.stretchName || "Unknown stretch")}</strong>
                <span>
                  ${escapeHtml(s.sector || "Unknown sector")} - 
                  ${speedBandText(s.current_val)} → ${speedBandText(s.predicted_val)}
                </span>
              </div>
            `).join("")}
          </div>`
      : `<div class="incident-ml-no-roads">No major affected stretches detected.</div>`
    }
    </div>

    <div class="incident-ml-affected-roads">
      <div class="incident-ml-affected-roads-title">MAJOR LANDMARKS</div>

      <div class="incident-ml-road-tags">
        ${majorLandmarks.length
      ? majorLandmarks.map(l => `
                <span class="incident-ml-road-tag">${escapeHtml(l)}</span>
              `).join("")
      : `<span class="incident-ml-no-roads">No landmarks available</span>`
    }
      </div>
    </div>
  `;
  document.getElementById("incident-ml-panel")?.classList.remove("open");
  panel.classList.remove("hidden");
  panel.classList.add("open");
}

function getMajorLandmarks(landmarks, maxCount = 10) {
  const seen = new Set();
  const result = [];

  (landmarks || []).forEach(lm => {
    const label = lm.label || lm.landmark_name;
    if (!label || seen.has(label)) return;

    seen.add(label);
    result.push(label);

    if (result.length >= maxCount) return;
  });

  return result;
}

async function loadExpresswayGeometry(code) {
  const res = await fastAuthFetch(`/api/ml/expressway-geometry?code=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error("Failed to load expressway geometry");
  return res.json();
}

async function drawExpresswayOnMap(code) {
  if (!state.expresswayLayerGroup) return;

  state.expresswayLayerGroup.clearLayers();

  const data = await loadExpresswayGeometry(code);
  const bounds = [];

  renderExpresswayInfoPanel(data);

  const landmarks = data.landmarks || [];

  (data.segments || []).forEach(seg => {
    const linkSpeed = Number(seg.predicted_val ?? 8);
    const color = speedBandToColor(linkSpeed);
    const latlngs = [seg.start, seg.end];

    const nearest = findNearestLandmark(seg, landmarks);
    const stretchName = nearest
      ? nearest.label
      : (seg.road_name || data.full_name || data.code);

    bounds.push(seg.start, seg.end);

    L.polyline(latlngs, {
      color: color,
      weight: 6,
      opacity: 0.9
    })
      .bindPopup(
        `<strong>${data.code}</strong><br>` +
        `<b>${stretchName}</b><br>` +
        `Sector: ${seg.sector}<br>` +
        `Current SpeedBand: ${seg.current_val ?? "N/A"}<br>` +
        `T+15 SpeedBand: ${seg.predicted_val ?? "N/A"}<br>` +
        `${nearest ? `Nearest landmark: ${nearest.distance_m}m away<br>` : ""}` +
        `Link ID: ${seg.link_id}`
      )
      .addTo(state.expresswayLayerGroup);
  });

  (data.landmarks || []).forEach(vms => {
    const dot = L.circleMarker([vms.lat, vms.lon], {
      radius: 4,
      fillColor: "#1e3a8a",
      color: "#fff",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.9
    });


    dot.bindTooltip(vms.label, {
      permanent: false,
      direction: 'right',
      className: 'vms-clean-label',
      offset: [5, 0]
    });

    dot.addTo(state.expresswayLayerGroup);
  });

  if (bounds.length) {
    state.liveMap.fitBounds(bounds, { padding: [20, 20] });
  }
}

document.querySelectorAll(".exp-checkbox").forEach(cb => {
  cb.addEventListener("change", async function () {
    document.querySelectorAll(".exp-checkbox").forEach(other => {
      if (other !== this) other.checked = false;
    });

    if (!this.checked) {
      state.expresswayLayerGroup.clearLayers();
      const panel = document.getElementById("expressway-info-panel");
      panel?.classList.remove("open");
      panel?.classList.add("hidden");

      return;
    }

    try {
      await drawExpresswayOnMap(this.value);
    } catch (err) {
      console.error("Failed to draw expressway:", err);
    }
  });
});

document.getElementById("expressway-panel-close")?.addEventListener("click", () => {
  const panel = document.getElementById("expressway-info-panel");
  panel?.classList.remove("open");
  panel?.classList.add("hidden");
});

// End Expressways Analysis sector

// Start Incident Hotspots Section
async function refreshHotspotsDashboard() {
  const container = document.getElementById("hotspot-grid");
  if (!container) return;

  try {
    const res = await window.fastAuthFetch("/api/ml/hotspots");

    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

    const response = await res.json();
    const data = response.data;

    if (!data || !Array.isArray(data) || data.length === 0) {
      container.innerHTML = "No safety data available.";
      return;
    }

    let hotspotsHTML = "";

    data.forEach(spot => {
      const score = Number(spot.danger_score || 0);
      const riskIncidents = Number(spot.risk_incidents || 0);
      const accidents = Number(spot.accidents || 0);
      const breakdowns = Number(spot.breakdowns || 0);
      const avgDuration = Number(spot.avg_duration_min || 0);

      let dangerLabel = "Moderate Risk";
      if (score >= 20) dangerLabel = "High Risk Zone";
      else if (score >= 15) dangerLabel = "Elevated Risk";

      hotspotsHTML += `
        <div class="exp-card hotspot-card">
          <div class="exp-header">
            ${spot.road_name || "Unknown Road"}
          </div>

          <div style="padding: 12px; flex-grow: 1;">
            <div style="font-weight: bold; font-size: 0.95rem; margin-bottom: 8px;">
              ${riskIncidents} Risk Incidents (${dangerLabel})
            </div>

            <div class="stat-line">⚠️ Accidents: ${accidents}</div>
            <div class="stat-line">🔧 Breakdowns: ${breakdowns}</div>

            <div class="stat-line" style="margin-top: 8px; font-size: 0.82rem; color: #475569;">
              Frequent accident / breakdown activity. Drive carefully in this area.
            </div>
          </div>

          <div style="padding: 0 12px 12px; font-size: 0.85rem;">
            Avg Clearance: <strong>${Math.round(avgDuration)} mins</strong>
          </div>
        </div>
      `;
    });

    container.innerHTML = hotspotsHTML;

  } catch (err) {
    console.error("Dashboard Error:", err);
    container.innerHTML = `<div style="color: #ef4444; font-size: 0.8rem;">Failed to load safety analytics. Check console for details.</div>`;
  }
}
// End Incident Hotspots Section

window.refreshExpresswayDashboard = refreshExpresswayDashboard;
window.refreshHotspotsDashboard = refreshHotspotsDashboard;
refreshExpresswayDashboard();
refreshHotspotsDashboard();

// CHATBOT : VOICE FUNCTION
const micBtn = document.getElementById('mic-btn');
const chatInput = document.getElementById('chat-input');

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (Recognition) {
  const recognition = new Recognition();

  recognition.lang = 'en-SG';
  recognition.interimResults = true;
  recognition.continuous = false;

  let finalTranscript = "";
  let isListening = false;
  let cancelAutoSend = false;

  micBtn.addEventListener('click', () => {
    // Stop voice
    window.speechSynthesis.cancel();
    if (isListening) {
      cancelAutoSend = true;
      recognition.stop();
      return;
    }

    finalTranscript = "";
    cancelAutoSend = false;
    recognition.start();
  });

  recognition.onstart = () => {
    isListening = true;
    micBtn.style.backgroundColor = '#ef4444';
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        finalTranscript += text + " ";
      } else {
        interimTranscript += text;
      }
    }

    chatInput.value = (finalTranscript + interimTranscript).trim();
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.style.backgroundColor = '';

    const text = chatInput.value.trim();

    if (!cancelAutoSend && text.length > 2) {
      setTimeout(() => {
        if (chatInput.value.trim() === text) {
          sendChatMessage();
        }
      }, 600);
    }
  };

  recognition.onerror = (e) => {
    console.error("Speech error:", e);
  };
}

const ttsToggle = document.getElementById('tts-toggle');

let voices = [];

window.speechSynthesis.getVoices();
window.speechSynthesis.onvoiceschanged = () => {
  voices = window.speechSynthesis.getVoices();
  console.log("Voices loaded:", voices.length);
};

function speak(text) {
  const ttsEnabled = document.getElementById('tts-toggle')?.checked;
  if (!ttsEnabled || !text) return;

  playBeep('end');

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  if (voices.length === 0) voices = window.speechSynthesis.getVoices();


  const ukFemale = voices.find(v => v.name === "Google UK English Female") ||
    voices.find(v => v.name.includes("UK") && v.name.includes("Female")) ||
    voices.find(v => v.lang === "en-GB" || v.lang === "en_GB");

  if (ukFemale) {
    utterance.voice = ukFemale;
  }

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  window.speechSynthesis.speak(utterance);
}

function playBeep(type = 'start') {
  if (!document.getElementById('tts-toggle')?.checked) return;

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';

  if (type === 'start') {
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
  } else {
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
  }

  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.1);
}

ttsToggle.addEventListener('change', () => {
  if (!ttsToggle.checked) {
    window.speechSynthesis.cancel();
  }
});
// CHATBOT END VOICE FUNCTION

let chatHistory = []

// CHATBOT: send message and capture the response

function scrollToBottom() {
  const msgContainer = document.getElementById('chat-messages');
  if (!msgContainer) return;

  // This ensures the browser has rendered the new HTML first
  requestAnimationFrame(() => {
    msgContainer.scrollTo({
      top: msgContainer.scrollHeight,
      behavior: 'smooth' // Optional: makes it feel more polished
    });
  });
}

function appendChatMessage(container, speaker, text) {
  if (!container) return;
  const row = document.createElement("div");
  const label = document.createElement("b");
  label.textContent = `${speaker}:`;
  row.appendChild(label);
  row.appendChild(document.createTextNode(` ${String(text || "")}`));
  container.appendChild(row);
}


async function sendChatMessage() {
  // Stop speech
  window.speechSynthesis.cancel();
  const input = document.getElementById('chat-input');
  const msgContainer = document.getElementById('chat-messages');
  const text = input.value.trim();
  if (!text) return;



  appendChatMessage(msgContainer, "You", text);
  input.value = '';
  scrollToBottom();

  const res = await window.fastAuthFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: text, chatHistory: chatHistory })
  });

  const data = await res.json();

  console.log("Chat response: ", data)
  chatHistory.push({ role: "user", parts: [{ text }] });
  let finalBotText = "";
  if (data.type === "action") {
    if (data.text) {
      appendChatMessage(msgContainer, "FASTbot", data.text);
      finalBotText += data.text;
      scrollToBottom();
    }

    const actionResult = await dispatchBotAction(data);
    if (actionResult?.followUpText) {
      appendChatMessage(msgContainer, "FASTbot", actionResult?.followUpText);
      finalBotText += (finalBotText ? "\n" : "") + actionResult.followUpText;
      scrollToBottom();
    }
    if (actionResult?.chatContext) {
      chatHistory.push({
        role: "user",
        parts: [{ text: actionResult?.chatContext }]
      });
    }

  } else {
    appendChatMessage(msgContainer, "FASTbot", data.text);
    finalBotText = data.text || "";
    scrollToBottom();
  }
  msgContainer.scrollTop = msgContainer.scrollHeight;

  const transientActions = ["select_jam"]
  const isTransient = data.type === "action" && transientActions.includes(data.action);

  if (finalBotText) {
    chatHistory.push({ role: "model", parts: [{ text: finalBotText }] });
    speak(finalBotText);
  }

}

// Catch and perform actions based on bot response
async function dispatchBotAction(data) {
  const params = data.params;
  switch (data.action) {
    case "view_habit_routes": {
      await openHabitRoutesAction();

      if (!state.habitSavedRoutes || state.habitSavedRoutes.length === 0) {
        return "You do not have any saved routes yet!";
      }

      const topRoutes = state.habitSavedRoutes.slice(0, 3);

      state.habitRouteSelectionContext = topRoutes;

      const routeContext = [];
      for (i = 0; i < topRoutes.length; i++) {
        routeContext.push({
          index: i + 1,
          id: topRoutes[i].id,
          name: topRoutes[i].route_name,
          from: topRoutes[i].from,
          to: topRoutes[i].to
        })
      }

      // const latestRoute = state.habitSavedRoutes[0];
      // await drawHabitRouteOnMap(latestRoute);

      return {
        followUpText: [
          "Here are your saved routes: ",
          ...routeContext.map(r => `${r.index}. ${r.name}`),
          "Please select your route to analyze."
        ].join("\n"),
        chatContext: JSON.stringify({
          chat_context: {
            mode: "awaiting_habit_route_selection",
            expected_action: "load_habit_route",
            shown_routes: routeContext,
            description: "If the user replies with a number or route name, it refers to selecting one of these routes to load."
          }
        })
      };

    }
    case "plan_route": {
      await openRoutePlannerAction();
      return {
        followUpText: await handlePlanRoute(data.params),
        chatContext: null
      }
    }

    // Case select_habit_route
    case "select_habit_route": {
      const route_index = Number(params?.route_index);
      const route_name = params?.route_name?.trim();

      let route = null;

      if (!Number.isNaN(route_index) && route_index > 0) {
        route = state.habitRouteSelectionContext?.[route_index - 1]
      }

      else if (route_name) {
        route = state.habitRouteSelectionContext?.find(r =>
          (r.route_name || "").toLowerCase().includes(route_name.toLowerCase())
        );
      }

      if (!route) {
        return {
          followUpText: `Unable to load route. Please select from the list provided.`,
          chatContext: null
        };
      }

      const result = await drawHabitRouteOnMap(route);
      document.getElementById('habit-plan-selected-wrap').style.display = 'block';

      try {
        const intelRes = await window.fastAuthFetch(`/api/ml/route-intel`, {
          method: "POST",
          body: JSON.stringify({ link_ids: route.link_ids })
        });
        const intelData = await intelRes.json();

        if (result && result.summary) {
          renderHabitPanelResult(route, result.summary, "now", intelData);
        }
      } catch (err) {
        console.error("Bot failed to load intel", err);
      }


      return {
        followUpText: `Loaded route ${route.route_name}. You can now view details about the route.`,
        chatContext: JSON.stringify({
          chat_context: {
            mode: "awaiting_habit_route_analysis",
            expected_action: "habit_route_select_jam",
            selected_route: state.habitRouteChatContext,
            available_jams: state.habitRouteChatContext?.route_jam_pins,
            description: "The user now can ask about route information, such as total jams, select jam by number, or request reroute."
          }
        })
      };
    }
    // End Case select_habit_route

    // Start Case select_jam
    case "select_jam": {

      // Get the string provided by the backend
      const raw_index = String(data.params?.jam_index).toLowerCase();
      const currentLinkId = state.selectedJamPinID ? parseInt(state.selectedJamPinID.replace("jam-pin-", "")) : null;
      const currentIndexInList = state.activeRoutePins.findIndex(p => p.link_id === currentLinkId);
      let jam_index;
      // The index of jam
      if (raw_index.includes("next")) {
        jam_index = currentIndexInList + 2;
      } else if (raw_index.includes("prev")) {
        jam_index = currentIndexInList;
      } else {
        jam_index = Number(raw_index);
      }
      jam_index = Math.max(1, Math.min(jam_index, state.activeRoutePins.length));
      // Open the popup using the jam index
      const jam_res = await selectHabitJam(jam_index);

      // Initialize the fail selection text, to fill it in based on cause of failure
      let jam_fail_text = "";

      // Failure type: User has not selected a route yet
      if (!state.currSelectedRoute) {
        jam_fail_text = "No route selected! Please select a route first."
      }
      // Failure type: There are no jams detected on the selected route
      else if (!state.habitRouteChatContext?.route_jam_pins?.length) {
        jam_fail_text = "There are no jams on this road!"
      }
      // Failure type: The number user provided is out of index range, more than num of jams 
      else if (!jam_res) {
        jam_fail_text = "Please select a valid jam!"
      }

      // Success, return text + context 
      if (jam_res) {
        return {
          followUpText: `Selected jam! Would you like to change paths to avoid this jam?`,
          chatContext: JSON.stringify({
            chat_context: {
              mode: "awaiting_jam_reroute",
              expected_action: "reroute_jam, habit_route_select_jam",
              selected_map_pin: state.selectedJamPinID,
              description: "The user can now ask to reroute or calcalulate new path, to avoid the jam. Users can also ask to go to 'next' or 'previous' jam. You can call this function again and add or subtract 1 from the current jam index."
            }
          })
        }
      }
      // Fail, return failure text
      return {
        followUpText: jam_fail_text,
        chatContext: null
      }
    }
    // End Case select_jam

    // Start case reroute_from_jam
    // Over here, we want to get the jam_id, retrieve the link_id and segment j 
    // So that we can call simulateReroute
    case "reroute_from_jam": {
      const jam_index = state.selectedJamPinID;

      // Failure type: User has not selected a route yet
      if (!state.currSelectedRoute) {
        return { followUpText: "No route selected! Please select a route first.", chatContext: null };
      }
      // Failure type: No Jam Mappin selected
      if (!state.selectedJamPinID) {
        return { followUpText: "No jam selected! Please click on a jam pin first.", chatContext: null };
      }

      // Get the jam object based on jam index
      jam_context = state.habitRouteJams[`${jam_index}`];
      // Retrieve link_id and segment
      jam_link_id = jam_context.link_id;
      jam_segment = jam_context.segment_index;
      reroute_res = await simulateReroute(jam_link_id, jam_segment);

      if (reroute_res.success) {
        reroute_context = {
          current_route_eta: state.habitRouteChatContext.predicted_eta,
          alternate_route_eta: state.alternateRouteContext.newEta
        }
        return {
          followUpText: `Calculated alternate route! Accept route?`,
          chatContext: JSON.stringify({
            mode: "awaiting_user_confirmation",
            expected_action: "confirm_reroute, reject_reroute",
            reroute_context: reroute_context,
            description: "An alternative route is generated. User can now accept or reject the alternate route. Or they can ask you for help for their decision. You can help by comparing the estimated arrival times."
          })
        }
      }
      if (!reroute_res.success) {
        return {
          followUpText: "Reroute unsuccessful!",
          chatContext: null
        }
      }
    }
    // End Case reroute_from_jam

    // Start Case reroute_from_jam_decision
    case "reroute_from_jam_decision": {
      const reroute_decision = params?.reroute_decision

      // Failure type: No alternate route
      if (!state.alternateRouteContext) {
        return {
          followUpText: "There is no alternate route currently pending!",
          chatContext: null
        };
      }

      if (reroute_decision) {
        await acceptAltRoute();
        return {
          followUpText: data.text || "I have selected the new route for you!",
          chatContext: JSON.stringify({
            mode: "accepted_alternate_route",
            description: "The alternate route was accepted and successfully drawn on the map. It is now the active route."
          })
        }
      }
      else {
        await rejectAltRoute();
        return {
          followUpText: data.text || "Understood. I have rejected the alternate route!",
          chatContext: JSON.stringify({
            mode: "accepted_alternate_route",
            description: "The alternate route was rejected and cleared from the UI. The user is back on their original route."
          })
        }
      }
    }
    // End Case reroute_from_jam_decision

    // Start Case for Live Journey and Feedback
    case "start_journey": {
      if (!state.currSelectedRoute) {
        return {
          followUpText: "Please select a saved route first before starting the journey.",
          chatContext: null
        };
      }

      startJourneySimulation();

      return {
        followUpText: "Live journey started.",
        chatContext: JSON.stringify({
          chat_context: {
            mode: "journey_active",
            expected_action: "submit_journey_feedback",
            description: "The user is now in live journey mode and can report congestion, accident, or road work."
          }
        })
      };
    }

    case "submit_journey_feedback": {
      if (!state.journeyActive) {
        return {
          followUpText: "Start a journey first before submitting journey feedback.",
          chatContext: null
        };
      }

      hudFeedbackState.type = String(params.feedback_type || "").toUpperCase();
      hudFeedbackState.severity = String(params.severity || "MEDIUM").toUpperCase();

      await executeHudSubmit();

      return {
        followUpText: `Submitted ${hudFeedbackState.severity.toLowerCase()} ${hudFeedbackState.type.toLowerCase()} feedback for your current journey location.`,
        chatContext: null
      };
    }

    default:
      return "Action not implemented yet!"
  }
}

// CHATBOT ACTION: Open Habit Routes View
async function openHabitRoutesAction() {
  const btn = document.getElementById("nav-route-planner-btn");
  if (btn) btn.click();

  if (window.switchSidebar) {
    window.switchSidebar('habits');
  }

  await loadHabitRoutesFromServer();
}

// CHATBOT ACTION: Router planner
async function handlePlanRoute(params) {
  const from = params?.from?.trim();
  const to = params?.to?.trim();

  if (!from || !to) {
    return "Please provide both a starting point and a destination.";
  }

  const fromInput = document.getElementById("route-start-postal");
  const toInput = document.getElementById("route-end-postal");
  const calcBtn = document.getElementById("route-calculate-btn");

  if (!fromInput || !toInput || !calcBtn) {
    return "Route planner UI is not available right now.";
  }

  console.log("route planner page:", document.getElementById("route-planner"));
  console.log("start input:", document.getElementById("route-start-postal"));
  console.log("end input:", document.getElementById("route-end-postal"));

  fromInput.value = from;
  toInput.value = to;

  calcBtn.click();

  return `Planning route from ${from} to ${to}.`;
}

async function openRoutePlannerAction() {
  const btn = document.getElementById("nav-route-planner-btn");
  if (btn) btn.click();



}


// Helper function to open up Jam Map Pin
async function selectHabitJam(pinIndex) {
  const index = pinIndex - 1;
  const targetJam = state.activeRoutePins[index];
  if (targetJam === undefined) {
    return "No active jam!"
  }

  const systemPinID = `jam-pin-${targetJam.link_id}`;
  const jam = state.habitRouteJams[systemPinID];
  if (!jam || !jam.pin) {
    return false;
  }

  jam.pin.openPopup();
  state.selectedJamPinID = systemPinID;
  return true;
}


// INTEGRATED PAGE Helper function to switch tabs between route details and saved routes list
function switchSidebar(tab) {
  const planner = document.getElementById('planner-tab-content');
  const habits = document.getElementById('habit_tab_content');
  const pBtn = document.getElementById('btn-tab-planner');
  const hBtn = document.getElementById('btn-tab-habits');
  const analysisWrap = document.getElementById("habit-plan-selected-wrap");
  const title = document.getElementById("habit-tab-title");

  if (tab === 'planner') {
    planner.style.display = 'block';
    habits.style.display = 'none';
    analysisWrap.style.display = "none";
    title.style.display = "none";


    pBtn.style.borderBottom = '2px solid #3b82f6';
    pBtn.style.color = 'black';

    hBtn.style.borderBottom = 'none';
    hBtn.style.color = '#94a3b8';

  } else {
    planner.style.display = 'none';
    habits.style.display = 'block';
    analysisWrap.style.display = "none";
    title.style.display = "block";


    hBtn.style.borderBottom = '2px solid #3b82f6';
    hBtn.style.color = 'black';

    pBtn.style.borderBottom = 'none';
    pBtn.style.color = '#94a3b8';

    loadHabitRoutesFromServer();
  }
}
window.switchSidebar = switchSidebar;


// For expressway toolbar -----------
document.getElementById('map-toggle-expressways-btn').addEventListener('click', (e) => {
  const dropdown = document.getElementById('expressways-dropdown-menu');
  dropdown.classList.toggle('show');
  e.stopPropagation(); // Stops the click from immediately hiding it again
});

// Hide the dropdown if the user clicks anywhere else on the page
document.addEventListener('click', (e) => {
  const wrapper = document.getElementById('expressways-wrapper');
  const dropdown = document.getElementById('expressways-dropdown-menu');
  if (dropdown && dropdown.classList.contains('show') && !wrapper.contains(e.target)) {
    dropdown.classList.remove('show');
  }
});

// Listen for when check/uncheck an expressway
document.querySelectorAll('.exp-checkbox').forEach(checkbox => {
  checkbox.addEventListener('change', (e) => {
    const expresswayName = e.target.value;
    const isChecked = e.target.checked;

    console.log(`User toggled ${expresswayName} to ${isChecked}`);

    //  Leaflet logic here to show/hide the specific expressway layer
  });
});

function updateGuestFeatureVisibility() {
  console.log("Guest visibility check bypassed.");
}

// ADMIN TOOL SECTION FOR RECORD AND REPLAY
document.getElementById("admin-tools-btn")?.addEventListener("click", () => {
  const modal = document.getElementById("admin-tools-modal");
  modal?.classList.toggle("hidden");
});

// DRAGGABLE MODAL
(function enableAdminDrag() {
  const modal = document.getElementById("admin-tools-modal");
  const header = document.getElementById("admin-tools-header");

  if (!modal || !header) return;

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;

    const rect = modal.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // switch to left/top positioning (avoid right-based conflicts)
    modal.style.right = "auto";
    modal.style.left = rect.left + "px";
    modal.style.top = rect.top + "px";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    modal.style.left = (e.clientX - offsetX) + "px";
    modal.style.top = (e.clientY - offsetY) + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
})();

// Start Recording 
document.getElementById("admin-start-recording-btn").addEventListener("click", async () => {
  const route = state.currSelectedRoute;

  if (!route || !Array.isArray(route.link_ids) || !route.link_ids.length) {
    return;
  }

  const res = await window.fastAuthFetch("/api/replay/start", {
    method: "POST",
    body: JSON.stringify({
      route_id: route.id || null,
      route_name: route.route_name || "Unnnamed Route",
      link_ids: route.link_ids
    })
  });

  const data = await res.json()

  if (!res.ok) {
    return;
  }

  state.adminReplayRecordingId = data.recording_id || null;
  document.getElementById("admin-recording-status").textContent = "Recording..";
})
// End Start Recording

// Handle Stop Recording
document.getElementById("admin-stop-recording-btn").addEventListener("click", async () => {
  const route = state.currSelectedRoute;

  if (!route) {
    return;
  }

  const res = await window.fastAuthFetch("/api/replay/stop", {
    method: "POST",
    body: JSON.stringify({
      recording_id: state.adminReplayRecordingId || null,
      route_name: route.route_name || "Unnamed route"
    })
  });

  const data = await res.json();

  if (!res.ok) {
    return;
  }

  state.adminReplayRecordingId = null;
  document.getElementById("admin-recording-status").textContent = "Idle";
});
// End Handle Stop Recording

// END ADMIN TOOL SECTION
