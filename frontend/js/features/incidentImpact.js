// MUHSIN'S INCIDENT CLEARANCE PART INTEGRATION

var ML_SVG = '<svg width="22" height="7" viewBox="196 55 240 100" xmlns="http://www.w3.org/2000/svg">' +
  '<line x1="196" y1="72" x2="300" y2="62" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="196" y1="72" x2="300" y2="100" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="196" y1="72" x2="300" y2="138" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="196" y1="100" x2="300" y2="62" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="196" y1="100" x2="300" y2="100" stroke="rgb(155,146,232)" stroke-width="1.2"/>' +
  '<line x1="196" y1="100" x2="300" y2="138" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="196" y1="128" x2="300" y2="62" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="196" y1="128" x2="300" y2="100" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="196" y1="128" x2="300" y2="138" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="320" y1="62" x2="424" y2="84" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="320" y1="100" x2="424" y2="84" stroke="rgb(155,146,232)" stroke-width="1.2"/>' +
  '<line x1="320" y1="138" x2="424" y2="84" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="320" y1="62" x2="424" y2="116" stroke="rgb(74,72,112)" stroke-width="1.2"/>' +
  '<line x1="320" y1="100" x2="424" y2="116" stroke="rgb(107,100,176)" stroke-width="1.2"/>' +
  '<line x1="320" y1="138" x2="424" y2="116" stroke="rgb(155,146,232)" stroke-width="1.2"/>' +
  '<circle cx="196" cy="72" r="10" fill="rgb(38,33,92)" stroke="rgb(127,119,221)" stroke-width="1.5"/>' +
  '<circle cx="196" cy="100" r="10" fill="rgb(38,33,92)" stroke="rgb(127,119,221)" stroke-width="1.5"/>' +
  '<circle cx="196" cy="128" r="10" fill="rgb(38,33,92)" stroke="rgb(127,119,221)" stroke-width="1.5"/>' +
  '<circle cx="310" cy="62" r="10" fill="rgb(60,52,137)" stroke="rgb(175,169,236)" stroke-width="1.5"/>' +
  '<circle cx="310" cy="100" r="13" fill="rgb(127,119,221)" stroke="rgb(238,237,254)" stroke-width="1.5"/>' +
  '<circle cx="310" cy="138" r="10" fill="rgb(60,52,137)" stroke="rgb(175,169,236)" stroke-width="1.5"/>' +
  '<circle cx="424" cy="84" r="10" fill="rgb(83,74,183)" stroke="rgb(206,203,246)" stroke-width="1.5"/>' +
  '<circle cx="424" cy="116" r="13" fill="rgb(127,119,221)" stroke="rgb(238,237,254)" stroke-width="1.5"/>' +
  '</svg>';

async function openIncidentMlPanel(it) {

  const incidentFingerprint = `${it.lat}_${it.lon}_${it.type}_${it.message.substring(0, 15)}`;

  console.log("DEBUG: Function called with data:", it);
  const panel = document.getElementById("incident-ml-panel");
  const badge = document.getElementById("incident-ml-badge");
  const title = document.getElementById("incident-ml-title");
  const meta = document.getElementById("incident-ml-meta");
  const message = document.getElementById("incident-ml-message");
  const body = document.getElementById("incident-ml-body");
  if (!panel) return;

  var typeStr = (it.type || "Incident").toUpperCase();
  badge.textContent = typeStr;
  badge.className = "incident-ml-panel-badge";
  if ((it.type || "").toLowerCase().includes("accident")) badge.classList.add("accident");
  else if ((it.type || "").toLowerCase().includes("heavy")) badge.classList.add("heavy-traffic");
  else if ((it.type || "").toLowerCase().includes("road")) badge.classList.add("roadwork");

  var area = it.area || "";
  var expMatch = area.match(/\b(PIE|CTE|AYE|BKE|KJE|TPE|SLE|MCE|ECP|KPE)\b/i);
  title.textContent = expMatch ? expMatch[1].toUpperCase() : (it.type || "Incident");
  meta.textContent = getIncidentElapsedText(it) + "  ·  Est. impact: " + getIncidentDurationText(it);
  message.textContent = area;

  // Show loading state and slide panel open
  body.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">Loading ML assessment…</div>';
  panel.classList.add("open");

  try {
    const res = await window.fastAuthFetch("/api/ml/incident-predict", {
      method: "POST",
      body: JSON.stringify({
        type: it.type,
        message: it.message || area,
        lat: it.lat,
        lon: it.lon
      })
    });

    if (!res.ok) throw new Error("Fetch failed");

    const ml = await res.json();

    var badgeColors = {
      "impact-low": { bg: "#dcfce7", color: "#15803d", border: "#22c55e", circle: "#22c55e" },
      "impact-moderate": { bg: "#fef9c3", color: "#a16207", border: "#f59e0b", circle: "#f59e0b" },
      "impact-high": { bg: "#ffedd5", color: "#c2410c", border: "#f97316", circle: "#f97316" },
      "impact-severe": { bg: "#fee2e2", color: "#b91c1c", border: "#ef4444", circle: "#ef4444" },
    };
    var bc = badgeColors[ml.impact_css] || { bg: "#f3f4f6", color: "#374151", border: "#9ca3af", circle: "#9ca3af" };
    var signals = Array.isArray(ml.signals) ? ml.signals : [];
    var maxPct = Math.max.apply(null, signals.map(function (s) { return s.pct || 0; })) || 1;

    var signalHtml = signals.map(function (s) {
      var barWidth = Math.round((s.pct / maxPct) * 100);
      var fillColor = s.active ? "#7c3aed" : "#cbd5e1";
      var dot = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + fillColor + ';margin-right:5px;flex-shrink:0;"></span>';
      var tag = s.active ? '<span style="font-size:9px;background:#ede9fe;color:#6d28d9;border-radius:3px;padding:1px 4px;flex-shrink:0;">active</span>' : '';
      return `<div style="margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
                            ${dot}
                            <span style="font-size:11px;color:#374151;font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.name)}</span>
                            ${tag}
                            <span style="font-size:10px;color:#9ca3af;flex-shrink:0;margin-left:4px;">${s.pct}%</span>
                        </div>
                        <div style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
                            <div style="width:${barWidth}%;height:100%;background:${fillColor};border-radius:3px;"></div>
                        </div>
                    </div>`;
    }).join("") || '<div style="color:#9ca3af;font-size:11px;">No specific signals detected</div>';

    var shownPct = signals.reduce(function (sum, s) { return sum + (s.pct || 0); }, 0);
    var remainingPct = Math.max(0, 100 - shownPct);
    var footerHtml = remainingPct > 0
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #f3f4f6;font-size:10px;color:#9ca3af;font-style:italic;">Remaining ${remainingPct}% from incident type, time of day &amp; peak hour — consistent across all predictions.</div>`
      : '';

    // JR prediction section
    const predictionClass = ml.t15_sb < 4
      ? "incident-ml-forecast-value bad"
      : "incident-ml-forecast-value good";

    const predictionSection = `
        <div class="incident-ml-forecast">
          <div class="incident-ml-forecast-title">TRAFFIC FORECAST</div>

          <div class="incident-ml-forecast-row">
            <div class="incident-ml-forecast-col">
              <div class="incident-ml-forecast-label">Current</div>
              <div class="incident-ml-forecast-value">${ml.current_sb ?? "–"}</div>
            </div>

            <div class="incident-ml-forecast-arrow">→</div>

            <div class="incident-ml-forecast-col right">
              <div class="incident-ml-forecast-label">T+15</div>
              <div class="${predictionClass}">${ml.t15_sb ?? "–"}</div>
            </div>
          </div>

          <div class="incident-ml-forecast-status">
            ${escapeHtml(ml.flow_status || "")}
          </div>
        </div>
      `;

    const roads = [...new Set(
      (ml.impact_segments || []).map(s => s.road_name).filter(Boolean)
    )];

    const affectedRoads = roads.length > 0
      ? `
          <div class="incident-ml-affected-roads">
            <div class="incident-ml-affected-roads-title">AFFECTED ROADS</div>
            <div class="incident-ml-road-tags">
              ${roads.slice(0, 4).map(r => `
                <span class="incident-ml-road-tag">${escapeHtml(r)}</span>
              `).join("")}
              ${roads.length > 4 ? `<span class="incident-ml-road-tag">+${roads.length - 4} more</span>` : ""}
            </div>
          </div>
        `
      : `
        <div class="incident-ml-affected-roads">
          <div class="incident-ml-affected-roads-title">AFFECTED ROADS</div>
          <div class="incident-ml-no-roads">No roads affected</div>
        </div>
      `;

    body.innerHTML = `
            <div class="incident-ml-card">
                <div class="incident-ml-card-title">${ML_SVG} ML IMPACT ASSESSMENT</div>
                <div class="incident-ml-severity-row">
                    <div class="incident-ml-score-circle" style="border-color:${bc.circle};">
                        <span class="incident-ml-score-num">${ml.score || "–"}</span>
                        <span class="incident-ml-score-denom">/10</span>
                    </div>
                    <div class="incident-ml-severity-info">
                        <div class="incident-ml-badge" style="background:${bc.bg};color:${bc.color};">⚠️ ${escapeHtml(ml.impact_class || "Unknown")}</div>
                        <div class="incident-ml-summary">${escapeHtml(ml.summary || "")}</div>
                    </div>
                </div>
                <div class="incident-ml-stats">
                    <div class="incident-ml-stat">
                        <div class="incident-ml-stat-label">CLEARING TIME</div>
                        <div class="incident-ml-stat-value">⏱ ${escapeHtml(ml.clearing_time || "–")}</div>
                        <div class="incident-ml-stat-sub">${escapeHtml(ml.clearing_time_ml || "")}</div>
                    </div>
                    <div class="incident-ml-stat">
                        <div class="incident-ml-stat-label">CONFIDENCE</div>
                        <div class="incident-ml-stat-value">🎯 ${ml.confidence || 0}%</div>
                    </div>
                </div>
            </div>
            
            ${predictionSection}
            ${affectedRoads}

            <div class="incident-ml-why">
                <div class="incident-ml-why-title">FEATURE IMPORTANCE (MODEL-WIDE)</div>
                ${signalHtml} ${footerHtml}
            </div>
            
            <div class="incident-ml-feedback-section" style="margin-top: 20px; border-top: 2px solid #f3f4f6; padding-top: 15px;">
                <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                    💬 Feedback
                </div>

                <div id="mini-fb-form" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 15px;">
                    <div style="font-size: 11px; color: #64748b; margin-bottom: 8px; font-weight: 600; text-transform: uppercase;">Incident Active?</div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                        <button class="mini-fb-type-btn" data-type="ACTIVE" style="padding: 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: pointer;">Active</button>
                        <button class="mini-fb-type-btn" data-type="CLEAR" style="padding: 6px; font-size: 11px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: pointer;">Cleared</button>
                    </div>

                    <textarea id="mini-fb-comment" placeholder="Add details..." style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; font-size: 12px; height: 50px; margin-bottom: 8px; box-sizing: border-box;"></textarea>
                    
                    <button id="mini-fb-submit" style="width: 100%; background: #1e293b; color: white; border: none; padding: 8px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">
                        POST FEEDBACK
                    </button>
                </div>

                <div id="mini-fb-list" style="max-height: 200px; overflow-y: auto;">
                    <div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 10px;">Loading updates...</div>
                </div>
            </div>
            `;

    // For Feedback
    async function loadCommunityUpdates() {
      try {
        const res = await window.fastAuthFetch('/api/ml/feedback/list', {
          method: 'POST',
          body: JSON.stringify({ location: incidentFingerprint })
        });
        if (res.ok) {
          const data = await res.json();
          const listEl = document.getElementById('mini-fb-list');

          if (data.reports && data.reports.length > 0) {
            listEl.innerHTML = data.reports.map(fb => `
                    <div style="margin-bottom: 8px; padding: 10px; background: white; border-radius: 6px; border-left: 3px solid ${fb.condition_type === 'CLEAR' ? '#22c55e' : '#f59e0b'};">
                        <div style="font-size: 9px; font-weight: 800; color: #1e293b;">
                            ${fb.condition_type.replace('_', ' ')} · ${new Date(fb.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div style="font-size: 11px; color: #475569;">${escapeHtml(fb.comment)}</div>
                    </div>
                `).join("");
          } else {
            listEl.innerHTML = `<div style="font-size: 11px; color: #94a3b8; text-align: center; padding: 10px;">No updates yet. Be the first!</div>`;
          }
        }
      } catch (e) { console.error("Load failed", e); }
    }

    // Trigger the load immediately after HTML is set
    loadCommunityUpdates();

    // Submit Button Logic
    const submitBtn = document.getElementById('mini-fb-submit');
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const comment = document.getElementById('mini-fb-comment').value;
        const type = document.querySelector('.mini-fb-type-btn.active')?.dataset.type || "UPDATE";

        if (!comment.trim()) return;

        try {
          const res = await window.fastAuthFetch('/api/ml/feedback/save', {
            method: 'POST',
            body: JSON.stringify({
              location: incidentFingerprint,
              condition_type: type,
              comment: comment,
              lat: it.lat,
              lon: it.lon
            })
          });

          if (res.ok) {
            document.getElementById('mini-fb-comment').value = "";
            loadCommunityUpdates();
          }
        } catch (e) { console.error("Save failed", e); }
      };
    }

    // Button Toggles
    document.querySelectorAll('.mini-fb-type-btn').forEach(btn => {
      btn.onclick = function () {
        document.querySelectorAll('.mini-fb-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.style.background = '#e2e8f0';
      };
    });



    console.log("DEBUG: ML Payload received:", ml);

    if (state.currentImpactLayer) {
      state.currentImpactLayer.clearLayers();
    } else {
      console.error("ERROR: state.currentImpactLayer is not initialized!");
      return;
    }

    if (ml.impact_segments && ml.impact_segments.length > 0) {
      console.log(`DEBUG: Drawing ${ml.impact_segments.length} segments.`);

      ml.impact_segments.forEach(seg => {
        if (seg.coords && seg.coords.length === 2) {
          L.polyline(seg.coords, {
            color: '#ef4444',
            weight: 8,
            opacity: 0.8,
            lineCap: 'round'
          }).addTo(state.currentImpactLayer);
        }
      });

      // Flatten segments to get all points for the bounds
      const allPoints = ml.impact_segments.flatMap(s => s.coords);
      const center = [
        allPoints.reduce((sum, p) => sum + p[0], 0) / allPoints.length,
        allPoints.reduce((sum, p) => sum + p[1], 0) / allPoints.length
      ];

      let maxDist = 0;
      allPoints.forEach(p => {
        const d = distance(center, p);
        if (d > maxDist) maxDist = d;
      });
      function distance(a, b) {
        const R = 6371000;
        const toRad = x => x * Math.PI / 180;

        const dLat = toRad(b[0] - a[0]);
        const dLon = toRad(b[1] - a[1]);

        const lat1 = toRad(a[0]);
        const lat2 = toRad(b[0]);

        const x = dLat;
        const y = dLon * Math.cos((lat1 + lat2) / 2);

        return Math.sqrt(x * x + y * y) * R;
      }
      L.circle(center, {
        radius: Math.max(maxDist * 1.8, 120),
        color: '#ef4444',
        fillColor: '#ef4444',
        fillOpacity: 0.2,
        weight: 1.5
      }).addTo(state.currentImpactLayer);

      state.liveMap.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 16 });
    } else {
      console.warn("DEBUG: No impact segments found in backend response.");
    }

  } catch (err) {
    console.error("ML assessment failed:", err);
    body.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">ML assessment unavailable</div>';
  }
}

window.openIncidentMlPanel = openIncidentMlPanel;

function closeIncidentMlPanel() {
  const panel = document.getElementById("incident-ml-panel");

  if (panel) {
    panel.classList.remove("open");
  }

  if (state.currentImpactLayer) {
    state.currentImpactLayer.clearLayers();
  }
}

const incidentMlCloseBtn = document.getElementById("incident-ml-close");

if (incidentMlCloseBtn) {
  incidentMlCloseBtn.addEventListener("click", closeIncidentMlPanel);
}

window.closeIncidentMlPanel = closeIncidentMlPanel;