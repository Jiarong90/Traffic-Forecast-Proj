// HANDLE START JOURNEY

const BAND_TO_KMH = { 1: 7, 2: 15, 3: 25, 4: 35, 5: 45, 6: 55, 7: 65, 8: 85 };

// Calculates distance in Kilometers between two [lat, lon] points
function getDistanceKm(coord1, coord2) {
  const [lat1, lon1] = coord1;
  const [lat2, lon2] = coord2;
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


// START LIVE JOURNEY
let liveJourneyWatchId = null;
let liveJourneyMarker = null;
let lastLiveRouteIndex = -1;

function findNearestRouteIndex(userLatLng, coords) {
  let bestIndex = 0;
  let bestDist = Infinity;

  for (let i = 0; i < coords.length; i++) {
    const d = getDistanceKm([userLatLng.lat, userLatLng.lng], coords[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  return {
    index: bestIndex,
    distanceM: bestDist * 1000
  };
}

function startLiveJourney() {
  const route = state.currSelectedRoute;
  const coords = state.currentRouteCoords || route?.coords;
  const segmentMatches = state.currMatchInfo?.segment_matches || [];

  if (!route || !coords || coords.length < 2 || !segmentMatches.length) {
    alert("Load a route first.");
    return;
  }

  if (!navigator.geolocation || !navigator.geolocation.watchPosition) {
    alert("Live location is not supported on this browser.");
    return;
  }

  state.journeyActive = true;

  const liveBtn = document.getElementById("live-journey-btn");
  if (liveBtn) {
    liveBtn.style.background = "#ef4444";
    liveBtn.textContent = "STOP LIVE";
    liveBtn.setAttribute("onclick", "stopLiveJourney()");
  }

  const simBtn = document.getElementById("sim-control-btn");
  if (simBtn) {
    simBtn.disabled = true;
    simBtn.style.opacity = "0.55";
  }

  const hud = document.getElementById("journey-hud");
  if (hud) hud.classList.remove("hidden");

  if (liveJourneyWatchId !== null) {
    navigator.geolocation.clearWatch(liveJourneyWatchId);
    liveJourneyWatchId = null;
  }

  liveJourneyWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const userLatLng = {
        lat: Number(pos.coords.latitude),
        lng: Number(pos.coords.longitude)
      };

      const nearest = findNearestRouteIndex(userLatLng, coords);

      if (!liveJourneyMarker) {
        liveJourneyMarker = L.circleMarker([userLatLng.lat, userLatLng.lng], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: "#ef4444",
          fillOpacity: 1
        }).bindPopup("Live Location").addTo(state.habitRoutePolylineLayer);
      } else {
        liveJourneyMarker.setLatLng([userLatLng.lat, userLatLng.lng]);
      }

      if (nearest.distanceM > 120) {
        updateHUD([], "Off route", {
          label: "OFF ROUTE",
          type: "orange"
        });
        return;
      }

      if (Math.abs(nearest.index - lastLiveRouteIndex) < 3) {
        return;
      }

      lastLiveRouteIndex = nearest.index;
      updateColorsAhead(coords, segmentMatches, nearest.index);
    },
    (err) => {
      console.error("Live journey GPS failed:", err);
      alert("Unable to access live location.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000
    }
  );
}

function stopLiveJourney() {
  if (liveJourneyWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(liveJourneyWatchId);
    liveJourneyWatchId = null;
  }

  if (liveJourneyMarker && state.plannerMap) {
    state.plannerMap.removeLayer(liveJourneyMarker);
    liveJourneyMarker = null;
  }

  state.journeyActive = false;
  lastLiveRouteIndex = -1;

  const hud = document.getElementById("journey-hud");
  if (hud) hud.classList.add("hidden");

  if (state.currSelectedRoute) {
    drawHabitRouteOnMap(state.currSelectedRoute);
  }

  const liveBtn = document.getElementById("live-journey-btn");
  if (liveBtn) {
    liveBtn.style.background = "#0f172a";
    liveBtn.textContent = "Start Journey";
    liveBtn.setAttribute("onclick", "startLiveJourney()");
  }

  const simBtn = document.getElementById("sim-control-btn");
  if (simBtn) {
    simBtn.disabled = false;
    simBtn.style.opacity = "1";
  }
}

window.startLiveJourney = startLiveJourney;
window.stopLiveJourney = stopLiveJourney;
// END LIVE JOURNEY


window.simInterval = null;
let simMarker = null;
let lastRedrawIndex = -1;
let journeyPollingTimer = null;

const journeyBtnIds = ['sim-control-btn', 'route-journey-btn'];

async function startJourneySimulation() {
  const route = state.currSelectedRoute;
  if (!route || !route.coords) {
    return;
  }

  // Set journey state to active so the system knows user is in journey phase
  state.journeyActive = true;
  // Show the FAST LookAhead journey analysis panel
  const hud = document.getElementById("journey-hud");
  if (hud) {
    hud.classList.remove("hidden");
  }

  // Set a poller to repeatedly poll fresh intel data, as the user moves through the route
  journeyPollingTimer = setInterval(async () => {
    if (!state.journeyActive) {
      return;
    }

    // For each link id in current matches, query backend for route intel.
    const activeMatches = Array.isArray(state.currMatchInfo)
      ? state.currMatchInfo
      : (state.currMatchInfo?.segment_matches || state.currSelectedRoute?.match_info?.segment_matches || []);
    const currentLinkIds = activeMatches.map(m => m.link_id).filter(Boolean);
    try {
      const response = await fastAuthFetch('/api/ml/route-intel', {
        method: "POST",
        body: JSON.stringify({ link_ids: currentLinkIds })
      });

      const freshData = await response.json();

      state.currentRouteIntel = freshData.details;
      state.currentRouteIntelSummary = freshData.summary;
    } catch (err) {
      console.error("Failed to poll route intel: ", err);
    }

  }, 180000);

  if (state.habitRoutePolylineLayer) {
    state.habitRoutePolylineLayer.clearLayers();

  }

  // Reset active route details. They should be updated in this journey instead
  state.activeRoutePins = [];
  state.habitRouteJams = {};


  let coords = route.coords;
  // Grab the currently selected match info
  let matchInfo = state.currMatchInfo || state.currSelectedRoute.match_info
  let segmentMatches = matchInfo.segment_matches || [];

  if (simMarker) {
    state.plannerMap.removeLayer(simMarker);
  }

  // Flip the "Start Journey" button to "Stop Journey"
  journeyBtnIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.background = '#ef4444';
      btn.textContent = "STOP JOURNEY";
      btn.setAttribute('onclick', 'stopJourneySimulation()');
    }
  });

  const carIcon = L.divIcon({
    html: `<div style="width:14px; height:14px; background:#ef4444; border:2px solid white; border-radius:50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
    className: 'sim-car',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
  simMarker = L.marker(coords[0], { icon: carIcon }).addTo(state.plannerMap);

  let currentIndex = 0;
  let accumulatedMins = 0;
  let isFetching = false;

  window.playSimulationLoop = function () {

    if (window.simInterval) {
      clearInterval(window.simInterval);
    }
    window.simInterval = setInterval(async () => {
      if (currentIndex >= coords.length - 1) {
        clearInterval(window.simInterval);
        stopJourneySimulation();
        return;
      }

      // Pull fresh data from state, to handle if alternate route was accepted mid journey
      const currentCoords = state.currentRouteCoords;
      const currentMatches = state.currMatchInfo.segment_matches || [];

      // Iterate the current index
      const oldCoord = currentCoords[currentIndex];
      currentIndex += 1;
      const newCoord = currentCoords[currentIndex];

      simMarker.setLatLng(newCoord);
      // state.plannerMap.panTo(newCoord, { animate: true, duration: 0.5 });

      const distKm = getDistanceKm(oldCoord, newCoord);

      // Get current match at this index
      const currentMatch = currentMatches[currentIndex]
      const band = (currentMatch && currentMatch.prediction) ? currentMatch.prediction.current_val : 5;
      const speedKmh = BAND_TO_KMH[band] || 45;

      const hopMins = (distKm / speedKmh) * 60;
      accumulatedMins += hopMins;

      // Update road ahead based on new location
      updateColorsAhead(currentCoords, currentMatches, currentIndex);


      if (accumulatedMins >= 5 && !isFetching) {
        isFetching = true;

        const remainingCoords = currentCoords.slice(currentIndex);

        try {
          const res = await window.fastAuthFetch("/api/ml/habit-routes/analyze", {
            method: "POST",
            body: JSON.stringify({ coords_json: remainingCoords })
          });

          if (res.ok) {
            const freshData = await res.json();

            accumulatedMins = 0;
            const freshMatches = freshData.match_info.segment_matches;

            state.currMatchInfo.segment_matches = [
              ...state.currMatchInfo.segment_matches.slice(0, currentIndex),
              ...freshMatches
            ];
            // state.currMatchInfo.segment_matches.splice(currentIndex, freshMatches.length, ...freshMatches);

            updateColorsAhead(currentCoords, state.currMatchInfo.segment_matches, currentIndex);
          }
        } catch (err) {
          console.error("Failed")
        } finally {
          isFetching = false;
        }
      }
    }, 300);
  };
  window.playSimulationLoop();
}
window.startJourneySimulation = startJourneySimulation


// For debugging
let lastKnownDistance = 0;
let lastKnownLinkId = null;

// To update segment coloring and generate Jam Piins for only T+15 ahead
function updateColorsAhead(coords, segmentMatches, currentIndex) {
  if (!state.habitRoutePolylineLayer) return;

  let lastPinIndex = -999;

  // if (state.plannerMap.hasLayer(state.activePopup)) {
  //   return false;
  // }
  // Only update every 5 moves to prevent spam
  if (Math.abs(currentIndex - lastRedrawIndex) < 5 && lastRedrawIndex !== -1) {
    return;
  }
  lastRedrawIndex = currentIndex;

  const getBandColor = (b) => {
    if (b <= 3) return "#ef4444";
    if (b <= 5) return "#f59e0b";
    return "#22c55e";
  };
  state.habitRoutePolylineLayer.clearLayers();

  if (state.habitRoutePinLayer) {
    state.habitRoutePinLayer.eachLayer((layer) => {
      if (layer.segmentIndex != undefined && layer.segmentIndex < currentIndex) {
        state.habitRoutePinLayer.removeLayer(layer);
        state.activeRoutePins = state.activeRoutePins.filter(p => p.segmentIndex !== layer.segmentIndex);

        delete state.habitRouteJams[`jam-pin-${layer.link_id}`];

      }
    })
  }

  let allAlerts = [];
  let seenLinks = new Set();
  let minsAheadAccumulator = 0;
  let distAheadAccumulator = 0;

  let currentRoadName = null;
  for (let offset of [0, -1, -2, -3, 1, 2]) {
    let idx = currentIndex + offset;
    if (segmentMatches[idx] && segmentMatches[idx].road_name) {
      currentRoadName = segmentMatches[idx].road_name;
      break;
    }
  }
  currentRoadName = currentRoadName || "Road";
  if (segmentMatches[currentIndex] && segmentMatches[currentIndex].road_name) {
    currentRoadName = segmentMatches[currentIndex].road_name;
  }

  let currentHazard = null;

  for (let offset of [0, -1, 1, -2, 2]) {
    const idx = currentIndex + offset;
    const currentMatch = segmentMatches[idx];
    if (!currentMatch || !currentMatch.prediction) continue;

    const cp = currentMatch.prediction;
    const cIntel = state.currentRouteIntel ? state.currentRouteIntel[currentMatch.link_id] : null;

    const currentVal = parseInt(cp.current_val);
    const predictedVal = parseInt(cp.predicted_val);
    const bandChange = currentVal - predictedVal;

    const isCurrentJam = predictedVal <= 2;
    const isCurrentSlowdown = currentVal >= 6 && bandChange >= 2;

    if (cIntel?.incident_type) {
      currentHazard = { label: cIntel.incident_type.toUpperCase(), type: 'red' };
      break;
    } else if (cIntel?.is_hotspot) {
      currentHazard = { label: "HOTSPOT ZONE", type: 'red' };
      break;
    } else if (isCurrentJam) {
      currentHazard = { label: "JAMMED", type: 'orange' };
      break;
    } else if (isCurrentSlowdown) {
      currentHazard = { label: "SLOWDOWN", type: 'orange' };
      break;
    } else if (cIntel?.is_raining) {
      currentHazard = { label: "RAIN AREA", type: 'blue' };
      break;
    }
  }

  let horizonDrawn = false;
  // Loop through all coordinates to redraw the path
  for (let j = 0; j < coords.length - 1; j++) {
    let line;

    let matchData = segmentMatches[j];
    if (j < currentIndex) {
      // Draw a thin, solid grey line to show where the car has been
      line = L.polyline([coords[j], coords[j + 1]], {
        color: "#cbd5e1",
        weight: 3,
        opacity: 0.6
      });
    } else {
      // Path ahead


      const dist = getDistanceKm(coords[j], coords[j + 1]);
      const p = (matchData && matchData.prediction) ? matchData.prediction : null;

      let effectiveBand = 5;
      let isForecast = false;

      if (p) {
        if (minsAheadAccumulator <= 15) {
          effectiveBand = parseInt(p.current_val);
          isForecast = false;
        }
        else {
          effectiveBand = parseInt(p.predicted_val);
          isForecast = true;
        }
      }

      const band = (matchData && matchData.prediction) ? matchData.prediction.current_val : 5;
      const speed = BAND_TO_KMH[effectiveBand] || 45;
      minsAheadAccumulator += (dist / speed) * 60
      distAheadAccumulator += dist;


      // Draw horizon divider
      if (minsAheadAccumulator > 15 && !horizonDrawn) {
        L.marker([coords[j][0], coords[j][1]], {
          interactive: false, // Let clicks pass through to the road
          icon: L.divIcon({
            className: 'horizon-divider-pin',
            html: `
                        <div style="
                            display: flex; 
                            align-items: center; 
                            transform: translate(-50%, -50%);
                        ">
                            <div style="width: 20px; height: 2px; background: #94a3b8;"></div>
                            <div style="
                                background: #1e293b; 
                                color: #fff; 
                                padding: 2px 8px; 
                                font-size: 9px; 
                                font-weight: 800; 
                                font-family: sans-serif;
                                border-radius: 12px; 
                                white-space: nowrap; 
                                border: 1px solid #94a3b8; 
                                box-shadow: 0 2px 4px rgba(0,0,0,0.5);
                                margin: 0 4px;
                            ">
                                ⏱️ T+15 FORECAST
                            </div>
                            <div style="width: 20px; height: 2px; background: #94a3b8;"></div>
                        </div>
                    `,
            iconSize: [0, 0]
          })
        }).addTo(state.habitRoutePolylineLayer);

        horizonDrawn = true;
      }

      if (minsAheadAccumulator <= 60 && p) {
        const linkId = matchData.link_id;
        const intel = state.currentRouteIntel ? state.currentRouteIntel[segmentMatches[j].link_id] : null;

        const currentVal = parseInt(p.current_val);
        const predictedVal = parseInt(p.predicted_val);
        const bandChange = currentVal - predictedVal;
        let isJam = (parseInt(effectiveBand) <= 2);
        let isSlowdown = currentVal >= 6 && bandChange >= 2;

        // Draw the incidents and hotspots
        if (intel && intel.is_hotspot) {
          const mid = [(coords[j][0] + coords[j + 1][0]) / 2, (coords[j][1] + coords[j + 1][1]) / 2]
          L.marker(mid, {
            icon: L.divIcon({
              html: `<div style="width:10px; height:10px; background:#ef4444; border:1.5px solid white; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,0.5);"></div>`,
              className: '',
              iconSize: [10, 10],
              iconAnchor: [5, 5]
            })
          }).bindPopup("<b>Incident Hotspot</b><br>High frequency of reports here, drive safely!")
            .addTo(state.habitRoutePolylineLayer);
        }

        let category = null;
        if (intel?.incident_type) category = 'incident';
        else if (intel?.is_hotspot) category = 'hotspot';
        else if (isJam) category = 'jam';
        else if (isSlowdown) category = 'slowdown';
        else if (intel?.is_raining) category = 'weather';

        // Only proceed if found a hazard + not already logged this specific category
        if (category && !seenLinks.has(category)) {

          let distString = distAheadAccumulator < 1
            ? `${Math.round(distAheadAccumulator * 1000)}m`
            : `${distAheadAccumulator.toFixed(1)}km`;

          let roadName = matchData.road_name || "Unknown Road";
          let alertObj = { type: '', main: '', sub: '' };

          if (category === 'incident') {
            alertObj.type = 'red';
            alertObj.main = intel.incident_type.toUpperCase();
            alertObj.sub = `${roadName} (${distString})`;
          } else if (category === 'hotspot') {
            alertObj.type = 'red';
            alertObj.main = "INCIDENT HOTSPOT";
            alertObj.sub = `${roadName} (${distString})`;
          } else if (category === 'jam') {
            alertObj.type = 'orange';
            alertObj.main = "JAM AHEAD";
            // Only show the arrow if the speed is actually dropping
            let bandText = (p.current_val !== p.predicted_val) ? `${p.current_val} → ${p.predicted_val}` : `${p.predicted_val}`;
            alertObj.sub = `${roadName} (${distString}) | Band ${bandText}`;
          } else if (category === 'slowdown') {
            alertObj.type = 'orange';
            alertObj.main = "SLOWDOWN";
            alertObj.sub = `${roadName} (${distString}) | Band ${p.current_val} → ${p.predicted_val}`;
          } else if (category === 'weather') {
            alertObj.type = 'blue';
            alertObj.main = "RAIN AHEAD";
            alertObj.sub = `Slippery conditions in ${distString}`;
          }

          allAlerts.push(alertObj);

          // Log the category 
          seenLinks.add(category);
        }

        // Draw the colored predictive line
        line = L.polyline([coords[j], coords[j + 1]], {
          color: getBandColor(effectiveBand),
          weight: 8,
          opacity: 1
        });

        const horizonLabel = isForecast ? "T+15 Forecast" : "Current";

        // Re-bind the popup so you can still click segments during simulation
        line.bindPopup(`
          <div style="font-family: sans-serif; min-width: 180px;">
            <b>${matchData.road_name || "LTA Road"}</b><br>
            <span style="color: #64748b; font-size: 10px;">Reached in approx ${Math.round(minsAheadAccumulator)} mins</span>
            <hr style="margin: 8px 0; border: 0; border-top: 1px solid #eee;">
            ${horizonLabel}: <b style="color:${getBandColor(effectiveBand)}">Band ${effectiveBand}</b>
          </div>
          `);

        const isDrop = (parseInt(p.current_val) - parseInt(p.predicted_val) >= 2);
        const systemPinID = `jam-pin-${matchData.link_id}`
        if ((isJam || isDrop) && !state.habitRouteJams[systemPinID] && (j - lastPinIndex > 15)) {
          const midLat = (coords[j][0] + coords[j + 1][0]) / 2;
          const midLon = (coords[j][1] + coords[j + 1][1]) / 2;

          const pinIndex = state.activeRoutePins.length + 1;

          // Call the helper function to create the marker
          const simPin = createBaseJamMarker(midLat, midLon, matchData.road_name, pinIndex, j, isJam, p, matchData.link_id);
          if (simPin) {
            simPin.addTo(state.habitRoutePinLayer);

            state.activeRoutePins.push({
              link_id: matchData.link_id,
              segmentIndex: j
            });
            state.activeRoutePins.sort((a, b) => a.segmentIndex - b.segmentIndex);

            state.habitRouteJams[systemPinID] = {
              index: pinIndex,
              pin: simPin,
              segmentIndex: j,
              link_id: matchData.link_id,
              road_name: matchData.road_name,
              lat: midLat,
              lon: midLon
            };

            lastPinIndex = j;
          }
        }

      } else {
        // Unmapped segments (Grey dashed)
        line = L.polyline([coords[j], coords[j + 1]], {
          color: "#94a3b8",
          weight: 4,
          opacity: 0.5,
          dashArray: "5, 10"
        });
      }
    }
    line.addTo(state.habitRoutePolylineLayer);
  }
  // Loop ends

  // Draw Incidents
  // const routePoints = coords.map(c => L.latLng(c[0], c[1]));

  // const cleanIncidents = mapLiveIncidentsToRouteEvents(state.mapLiveIncidents || []);
  // cleanIncidents.forEach(inc => {
  //   const incLoc = L.latLng(inc.lat, inc.lon);
  //   const isOnRoute = routePoints.some(p => p.distanceTo(incLoc) < 200);

  //   if (isOnRoute) {
  //     L.marker([inc.lat, inc.lon], {
  //       icon: L.divIcon({
  //         className: '',
  //         html: `<div style="font-size:16px; background:white; border:2px solid ${inc.color}; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.3);">⚠️</div>`,
  //         iconSize: [24, 24],
  //         iconAnchor: [12, 12]
  //       })
  //     }).bindPopup(`<b>${inc.label}</b><br>${inc.message}`)
  //       .addTo(state.habitRoutePolylineLayer);
  //   }
  // })

  updateHUD(allAlerts, currentRoadName, currentHazard);

}

// Draw Incidents / feedback
function drawLiveIncidentsOnRoute(activeCoords) {
  if (!state.incidentMarkerLayer || !state.currSelectedRoute) {
    return;
  }

  // Clear layers first
  state.incidentMarkerLayer.clearLayers();

  const routeCoords = activeCoords || state.currSelectedRoute.coords;
  const routePoints = routeCoords.map(c => L.latLng(c[0], c[1]));

  const incidents = state.mapLiveIncidents || [];

  incidents.forEach(inc => {
    const incLoc = L.latLng(inc.latitude, inc.longitude);
    const isOnRoute = routePoints.some(p => p.distanceTo(incLoc) < 250);

    if (isOnRoute) {
      const displayLabel = `${inc.source} ${inc.type}`;
      const countSuffix = inc.report_count === 1 ? 'user reported' : 'users reported';

      let popupHtml = `
            <div style="font-family: sans-serif; min-width: 160px;">
                <div style="font-size: 10px; color: #94a3b8; font-weight: 800;">${inc.source} REPORT</div>
                <div style="font-size: 12px; font-weight: 800; margin-bottom: 4px;">${inc.type}</div>
                <div style="font-size: 11px; color: #475569; margin-bottom: 12px;">${inc.report_count} ${countSuffix} this incident.</div>
                
                <div style="display: flex; gap: 8px; border-top: 1px solid #f1f5f9; padding-top: 8px;">
                    <button onclick="voteIncident('${inc.id}', 1)" style="flex: 1; border: 1px solid #3b82f6; color: #3b82f6; background: white; padding: 6px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;">
                        Still Active
                    </button>
                    <button onclick="voteIncident('${inc.id}', -1)" style="flex: 1; border: 1px solid #3b82f6; color: #3b82f6; background: white; padding: 6px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;">
                        Clear
                    </button>
                </div>
            </div>
        `;

      L.marker([inc.latitude, inc.longitude], {
        icon: getPin(inc.source, inc.type)
      }).bindPopup(popupHtml).addTo(state.incidentMarkerLayer);
    }
  });
}

// Fetch feedback
async function fetchIncidentFeedback() {
  try {
    const res = await window.fastAuthFetch('/api/ml/incidents/unified', {
      method: 'GET',
    });
    if (res.ok) {
      const data = await res.json();

      state.mapLiveIncidents = data.incidents;

      if (state.currSelectedRoute && state.currSelectedRoute.coords) {
        drawLiveIncidentsOnRoute(state.currSelectedRoute.coords);
      }
    }
  } catch (e) {
    console.error("Failed to fetch incidents", e);
  }
}

async function voteIncident(incidentId, voteValue) {
  try {
    const res = await window.fastAuthFetch('/api/ml/feedback/verify', {
      method: 'POST',
      body: JSON.stringify({
        id: incidentId,
        vote: voteValue
      })
    });

    if (res.ok) {

      if (typeof fetchIncidentFeedback === 'function') {
        fetchIncidentFeedback();
      }
    } else {
      console.error("Backend rejected vote:", await res.text());
    }

  } catch (e) {
    console.error("Verification failed", e);
  }
}
window.voteIncident = voteIncident;

function stopJourneySimulation() {
  if (window.simInterval) {
    console.log("Stopping simulation interval...");
    clearInterval(window.simInterval);
    window.simInterval = null;
  }

  if (journeyPollingTimer) {
    clearInterval(journeyPollingTimer);
  }

  state.journeyActive = false;
  const hud = document.getElementById("journey-hud");
  if (hud) {
    hud.classList.add("hidden");
  }
  if (simMarker) {
    state.plannerMap.removeLayer(simMarker);
    simMarker = null;
  }

  if (state.habitRoutePolylineLayer) {
    state.habitRoutePolylineLayer.clearLayers();
  }

  if (state.habitRoutePinLayer) {
    state.habitRoutePinLayer.clearLayers();
  }

  const btn = document.getElementById('sim-control-btn');
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.background = '#2563eb'; // Reset to blue
    btn.innerHTML = `
            START JOURNEY
        `;
    // Change the onclick back to Start
    btn.setAttribute('onclick', 'startJourneySimulation()');
  }

  if (state.currSelectedRoute) {
    drawHabitRouteOnMap(state.currSelectedRoute);
  }
}
window.stopJourneySimulation = stopJourneySimulation;


// Update the FAST Sentinel panel
function updateHUD(allAlerts, currentRoad, currentHazard) {
  const dot = document.getElementById('hud-dot');
  const body = document.getElementById('hud-body');
  const roadContainer = document.getElementById('hud-road-info-container');

  let hazardBadge = currentHazard
    ? `<div class="hud-hazard-badge" style="font-size: 12px; color: ${currentHazard.type === 'red' ? '#ef4444' : '#f59e0b'};">⚠️ ${currentHazard.label}</div>`
    : `<div style="height: 15px;"></div>`;

  roadContainer.innerHTML = `
    <div class="hud-small-label">Currently on:</div>
    <div class="hud-road-display" title="${currentRoad}">${currentRoad}</div>
    ${hazardBadge}
    <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 8px 0;">
  `;

  let html = `<div class="hud-section-title">Ahead</div>`;

  // Render any alerts
  if (allAlerts && allAlerts.length > 0) {
    dot.className = `dot-${allAlerts[0].type}`;
    allAlerts.slice(0, 3).forEach((alert) => {
      const color = alert.type === 'red' ? '#ef4444' : (alert.type === 'blue' ? '#3b82f6' : '#f59e0b');
      html += `
          <div class="alert-item" style="margin-bottom: 14px; border-left: 2px solid ${color}; padding-left: 10px;">
              <div style="font-size: 12px; font-weight: 600; color: #1e293b; letter-spacing: 0.2px;">${alert.main}</div>
              <div style="font-size: 11px; color: #64748b; font-weight: 400; margin-top: 3px;">${alert.sub}</div>
          </div>
        `;
    });
  } else {
    dot.className = 'dot-green';
  }

  // Check what is actually in the active list
  const hasWeather = allAlerts && allAlerts.some(a => a.main === "RAIN AHEAD");
  const hasIncidents = allAlerts && allAlerts.some(a => a.type === 'red' && a.main !== "INCIDENT HOTSPOT");

  if (!hasIncidents) {
    html += `
          <div class="alert-item" style="margin-bottom: 14px; border-left: 2px solid #22c55e; padding-left: 10px;">
              <div style="font-size: 12px; font-weight: 600; color: #1e293b; letter-spacing: 0.2px;">INCIDENTS</div>
              <div style="font-size: 11px; color: #64748b; font-weight: 400; margin-top: 3px;">No incidents ahead</div>
          </div>
      `;
  }

  if (!hasWeather) {
    html += `
          <div class="alert-item" style="margin-bottom: 14px; border-left: 2px solid #22c55e; padding-left: 10px;">
              <div style="font-size: 12px; font-weight: 600; color: #1e293b; letter-spacing: 0.2px;">WEATHER</div>
              <div style="font-size: 11px; color: #64748b; font-weight: 400; margin-top: 3px;">Clear</div>
          </div>
      `;
  }



  body.innerHTML = html;
}
// End Update HUD

// Journey Feedback
let hudFeedbackState = {
  type: null,
  severity: 'MEDIUM'
};

function toggleFeedbackDrawer() {
  const drawerContent = document.getElementById('drawer-content');
  const hud = document.getElementById('journey-hud');
  const icon = document.getElementById('drawer-icon');

  if (!drawerContent) return;

  const isOpening = drawerContent.classList.contains('hidden');

  drawerContent.classList.toggle('hidden');

  if (hud) {
    hud.classList.toggle('feedback-open', isOpening);
  }

  if (icon) {
    icon.textContent = isOpening ? "✕" : "📝";
  }
}

window.toggleFeedbackDrawer = toggleFeedbackDrawer;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.cmd-btn');
  const drawer = document.getElementById('drawer-content');

  if (!btn || !drawer || !drawer.contains(btn)) {
    return;
  }

  const isSeverityBtn = btn.classList.contains('sev');
  const groupSelector = isSeverityBtn ? '.cmd-btn.sev' : '.cmd-btn.type';

  document.querySelectorAll(groupSelector).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (isSeverityBtn) {
    hudFeedbackState.severity = btn.getAttribute('data-sev');
  } else {
    hudFeedbackState.type = btn.getAttribute('data-type')
  }
})

async function executeHudSubmit() {
  if (!hudFeedbackState.type) {
    return;
  }

  if (!simMarker) {
    return;
  }

  const coords = simMarker.getLatLng();

  const road = document.querySelector('.hud-road-display');
  const roadName = road ? road.innerText : "En Route";

  try {
    const res = await window.fastAuthFetch('/api/ml/feedback/hud_report', {
      method: 'POST',
      body: JSON.stringify({
        location: roadName,
        condition_type: hudFeedbackState.type,
        severity: hudFeedbackState.severity,
        comment: `Reported via FAST Sentinel on ${roadName}`,
        lat: coords.lat,
        lon: coords.lng
      })
    });

    if (res.ok) {
      toggleFeedbackDrawer();
      fetchIncidentFeedback();
    }

  } catch (e) {
    console.error("Failed to submit", e);
  }

}

window.executeHudSubmit = executeHudSubmit;

// END START JOURNEY
