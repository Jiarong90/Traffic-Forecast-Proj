// Route planner trip cost estimation and saved vehicle selection.
  const FUEL_PRICES = { ron92: 3.39, ron95: 3.44, ron98: 3.92 };
  const VEHICLE_TYPES = {
    sedan: { label: "Sedan", consumption: 8.0, fuelGrade: "ron95" },
    suv: { label: "SUV", consumption: 11.0, fuelGrade: "ron95" },
    mpv: { label: "MPV", consumption: 12.0, fuelGrade: "ron95" },
    motorcycle: { label: "Motorcycle", consumption: 4.5, fuelGrade: "ron95" }
  };
  const ERP_THRESHOLD_M = 1000;
  const ERP_GANTRIES = [
    { id: "AR_UBKR", name: "Upper Boon Keng Rd (Lorong 1 Geylang)", lat: 1.30878, lng: 103.86338, rates: [{ s: "07:30", e: "07:35", c: 2.0 }, { s: "07:35", e: "07:55", c: 4.0 }, { s: "07:55", e: "08:00", c: 3.0 }, { s: "08:00", e: "08:30", c: 2.0 }, { s: "08:30", e: "08:35", c: 3.0 }, { s: "08:35", e: "08:55", c: 4.0 }, { s: "08:55", e: "09:00", c: 3.5 }, { s: "09:00", e: "09:25", c: 3.0 }, { s: "09:25", e: "09:30", c: 2.5 }, { s: "09:30", e: "09:55", c: 2.0 }, { s: "09:55", e: "10:00", c: 1.0 }] },
    { id: "AR_KALLANG_BAHRU", name: "Kallang Bahru from PIE", lat: 1.3145, lng: 103.8618, rates: [{ s: "07:30", e: "07:35", c: 1.0 }, { s: "07:35", e: "07:55", c: 2.0 }, { s: "08:00", e: "08:30", c: 2.0 }, { s: "08:30", e: "08:35", c: 3.0 }, { s: "08:35", e: "08:55", c: 4.0 }, { s: "08:55", e: "09:00", c: 3.5 }, { s: "09:00", e: "09:25", c: 3.0 }, { s: "09:25", e: "09:30", c: 2.5 }, { s: "09:30", e: "09:55", c: 2.0 }, { s: "09:55", e: "10:00", c: 1.0 }] },
    { id: "AR_BENDEMEER", name: "Bendemeer Rd SB (Woodsville Interchange)", lat: 1.3205, lng: 103.8658, rates: [{ s: "08:00", e: "08:05", c: 0.5 }, { s: "08:05", e: "08:25", c: 1.0 }, { s: "08:30", e: "08:35", c: 1.5 }, { s: "08:35", e: "08:55", c: 2.0 }, { s: "08:55", e: "09:00", c: 1.5 }, { s: "09:00", e: "09:25", c: 1.0 }, { s: "09:25", e: "09:30", c: 0.5 }] },
    { id: "AYE_CITY", name: "AYE Citybound (Jurong Town Hall / Clementi Ave 6 & 2)", lat: 1.30435, lng: 103.74703, rates: [{ s: "07:30", e: "07:35", c: 2.0 }, { s: "07:35", e: "07:55", c: 4.0 }, { s: "07:55", e: "08:00", c: 3.0 }, { s: "08:00", e: "08:30", c: 2.0 }, { s: "08:30", e: "08:35", c: 3.0 }, { s: "08:35", e: "08:55", c: 4.0 }, { s: "08:55", e: "09:00", c: 3.5 }, { s: "09:00", e: "09:25", c: 3.0 }, { s: "09:25", e: "09:30", c: 2.5 }, { s: "09:30", e: "09:55", c: 2.0 }, { s: "09:55", e: "10:00", c: 1.0 }, { s: "17:30", e: "17:35", c: 1.5 }, { s: "17:35", e: "17:55", c: 3.0 }, { s: "17:55", e: "18:00", c: 2.0 }, { s: "18:00", e: "18:25", c: 1.0 }, { s: "18:25", e: "18:30", c: 0.5 }] },
    { id: "AYE_PORTSDOWN", name: "AYE between Portsdown Rd & Alexandra Rd", lat: 1.29717, lng: 103.79347, rates: [{ s: "07:30", e: "07:35", c: 2.0 }, { s: "07:35", e: "07:55", c: 4.0 }, { s: "07:55", e: "08:00", c: 3.0 }, { s: "08:00", e: "08:30", c: 2.0 }, { s: "08:30", e: "08:35", c: 3.0 }, { s: "08:35", e: "08:55", c: 4.0 }, { s: "08:55", e: "09:00", c: 3.5 }, { s: "09:00", e: "09:25", c: 3.0 }, { s: "09:25", e: "09:30", c: 2.5 }, { s: "09:30", e: "09:55", c: 2.0 }, { s: "09:55", e: "10:00", c: 1.0 }] },
    { id: "AYE_TUAS", name: "AYE Tuasbound after North Buona Vista", lat: 1.30501, lng: 103.78918, rates: [{ s: "17:05", e: "17:25", c: 1.0 }, { s: "17:30", e: "17:35", c: 2.0 }, { s: "17:35", e: "17:55", c: 3.0 }, { s: "17:55", e: "18:00", c: 2.5 }, { s: "18:00", e: "18:25", c: 2.0 }, { s: "18:30", e: "18:35", c: 2.5 }, { s: "18:35", e: "18:55", c: 3.0 }, { s: "18:55", e: "19:00", c: 2.0 }, { s: "19:00", e: "19:25", c: 1.0 }, { s: "19:25", e: "19:30", c: 0.5 }] },
    { id: "CTE_BRADDELL", name: "CTE after Braddell Rd / Serangoon Rd / Balestier slip", lat: 1.33985, lng: 103.84678, rates: [{ s: "07:30", e: "07:35", c: 1.0 }, { s: "07:35", e: "07:55", c: 2.0 }, { s: "08:00", e: "08:05", c: 2.5 }, { s: "08:05", e: "08:25", c: 3.0 }, { s: "08:30", e: "08:35", c: 4.0 }, { s: "08:35", e: "08:55", c: 5.0 }, { s: "08:55", e: "09:00", c: 4.5 }, { s: "09:00", e: "09:25", c: 4.0 }, { s: "09:25", e: "09:30", c: 3.5 }, { s: "09:30", e: "09:55", c: 3.0 }, { s: "09:55", e: "10:00", c: 1.5 }, { s: "17:30", e: "17:35", c: 2.0 }, { s: "17:35", e: "17:55", c: 3.0 }, { s: "17:55", e: "18:00", c: 2.5 }, { s: "18:00", e: "18:25", c: 2.0 }, { s: "18:30", e: "18:35", c: 2.5 }, { s: "18:35", e: "18:55", c: 3.0 }, { s: "18:55", e: "19:00", c: 2.0 }, { s: "19:00", e: "19:25", c: 1.0 }, { s: "19:25", e: "19:30", c: 0.5 }] },
    { id: "CTE_NB_PIE_BRAD", name: "CTE NB between PIE & Braddell Rd", lat: 1.3415, lng: 103.8472, rates: [{ s: "07:30", e: "07:35", c: 1.0 }, { s: "07:35", e: "07:55", c: 2.0 }, { s: "08:00", e: "08:05", c: 2.5 }, { s: "08:05", e: "08:25", c: 3.0 }, { s: "08:30", e: "08:35", c: 4.0 }, { s: "08:35", e: "08:55", c: 5.0 }, { s: "08:55", e: "09:00", c: 4.5 }, { s: "09:00", e: "09:25", c: 4.0 }, { s: "09:25", e: "09:30", c: 3.5 }, { s: "09:30", e: "09:55", c: 3.0 }, { s: "09:55", e: "10:00", c: 1.5 }] },
    { id: "CTE_AMK", name: "CTE between AMK Ave 1 & Braddell Rd", lat: 1.35471, lng: 103.84382, rates: [{ s: "07:30", e: "07:35", c: 1.0 }, { s: "07:35", e: "07:55", c: 2.0 }, { s: "08:00", e: "08:05", c: 2.5 }, { s: "08:05", e: "08:25", c: 3.0 }, { s: "08:30", e: "08:35", c: 4.0 }, { s: "08:35", e: "08:55", c: 5.0 }, { s: "08:55", e: "09:00", c: 4.5 }, { s: "09:00", e: "09:25", c: 4.0 }, { s: "09:25", e: "09:30", c: 3.5 }, { s: "09:30", e: "09:55", c: 3.0 }, { s: "09:55", e: "10:00", c: 1.5 }] },
    { id: "CTE_NB_JB", name: "CTE NB between Jalan Bahagia & PIE", lat: 1.3316, lng: 103.848, rates: [{ s: "17:30", e: "17:35", c: 0.5 }, { s: "17:35", e: "17:55", c: 1.0 }, { s: "18:00", e: "18:55", c: 1.0 }, { s: "18:55", e: "19:00", c: 0.5 }] },
    { id: "KPE_DEFU", name: "KPE SB after Defu Flyover", lat: 1.36369, lng: 103.89349, rates: [{ s: "07:00", e: "07:05", c: 1.0 }, { s: "07:05", e: "07:25", c: 2.0 }, { s: "17:05", e: "17:25", c: 1.0 }, { s: "17:30", e: "17:35", c: 2.0 }, { s: "17:35", e: "17:55", c: 4.0 }, { s: "18:00", e: "18:55", c: 4.0 }, { s: "18:55", e: "19:00", c: 3.5 }, { s: "19:00", e: "19:25", c: 3.0 }, { s: "19:25", e: "19:30", c: 2.0 }, { s: "19:30", e: "20:00", c: 1.0 }] },
    { id: "MCE_WB", name: "MCE WB (before Central Blvd / Maxwell Rd exit)", lat: 1.277, lng: 103.854, rates: [{ s: "07:30", e: "07:35", c: 2.5 }, { s: "07:35", e: "07:55", c: 4.0 }, { s: "08:00", e: "08:05", c: 4.5 }, { s: "08:05", e: "08:25", c: 5.0 }, { s: "08:30", e: "08:35", c: 5.5 }, { s: "08:35", e: "08:55", c: 6.0 }, { s: "08:55", e: "09:00", c: 4.0 }, { s: "09:00", e: "09:25", c: 2.0 }, { s: "09:25", e: "09:30", c: 1.5 }] },
    { id: "PIE_KALLANG", name: "PIE after Kallang Bahru / Bendemeer slip", lat: 1.3133, lng: 103.8668, rates: [{ s: "07:30", e: "07:35", c: 0.5 }, { s: "07:35", e: "07:55", c: 1.0 }, { s: "08:00", e: "08:25", c: 1.0 }, { s: "08:30", e: "08:35", c: 1.5 }, { s: "08:35", e: "08:55", c: 2.0 }, { s: "08:55", e: "09:00", c: 1.5 }, { s: "09:00", e: "09:25", c: 1.0 }, { s: "09:25", e: "09:30", c: 0.5 }, { s: "17:30", e: "17:35", c: 0.5 }, { s: "17:35", e: "17:55", c: 1.0 }, { s: "18:00", e: "18:25", c: 1.0 }, { s: "18:30", e: "18:35", c: 0.5 }, { s: "18:35", e: "18:55", c: 1.0 }, { s: "18:55", e: "19:00", c: 0.5 }] },
    { id: "PIE_ADAM", name: "PIE EB after Adam Rd & Mount Pleasant slip", lat: 1.3254, lng: 103.8184, rates: [{ s: "07:30", e: "07:35", c: 1.0 }, { s: "07:35", e: "07:55", c: 2.0 }, { s: "08:00", e: "08:05", c: 3.0 }, { s: "08:05", e: "08:25", c: 4.0 }, { s: "08:30", e: "08:35", c: 4.5 }, { s: "08:35", e: "08:55", c: 5.0 }, { s: "08:55", e: "09:00", c: 4.5 }, { s: "09:00", e: "09:25", c: 4.0 }, { s: "09:25", e: "09:30", c: 3.5 }, { s: "09:30", e: "09:55", c: 3.0 }, { s: "09:55", e: "10:00", c: 1.5 }] },
    { id: "PIE_EUNOS", name: "PIE WB before Eunos Link", lat: 1.3196, lng: 103.899, rates: [{ s: "07:30", e: "07:35", c: 0.5 }, { s: "07:35", e: "07:55", c: 1.0 }, { s: "08:00", e: "08:25", c: 1.0 }, { s: "08:30", e: "08:35", c: 1.5 }, { s: "08:35", e: "08:55", c: 2.0 }, { s: "08:55", e: "09:00", c: 1.5 }, { s: "09:00", e: "09:25", c: 1.0 }, { s: "09:25", e: "09:30", c: 0.5 }, { s: "17:30", e: "17:35", c: 0.5 }, { s: "17:35", e: "17:55", c: 1.0 }, { s: "18:00", e: "18:25", c: 1.0 }, { s: "18:30", e: "18:35", c: 0.5 }, { s: "18:35", e: "18:55", c: 1.0 }, { s: "18:55", e: "19:00", c: 0.5 }] }
  ];
  const ERP_ZONES = [
    { latMin: 1.280, latMax: 1.325, lngMin: 103.730, lngMax: 103.800, gantryIds: ["AYE_CITY"] },
    { latMin: 1.285, latMax: 1.312, lngMin: 103.785, lngMax: 103.805, gantryIds: ["AYE_PORTSDOWN"] },
    { latMin: 1.295, latMax: 1.315, lngMin: 103.782, lngMax: 103.800, gantryIds: ["AYE_TUAS"] },
    { latMin: 1.330, latMax: 1.360, lngMin: 103.838, lngMax: 103.852, gantryIds: ["CTE_BRADDELL", "CTE_NB_PIE_BRAD", "CTE_AMK"] },
    { latMin: 1.325, latMax: 1.340, lngMin: 103.842, lngMax: 103.855, gantryIds: ["CTE_NB_JB"] },
    { latMin: 1.350, latMax: 1.385, lngMin: 103.883, lngMax: 103.905, gantryIds: ["KPE_DEFU"] },
    { latMin: 1.270, latMax: 1.290, lngMin: 103.840, lngMax: 103.870, gantryIds: ["MCE_WB"] },
    { latMin: 1.308, latMax: 1.322, lngMin: 103.858, lngMax: 103.878, gantryIds: ["PIE_KALLANG"] },
    { latMin: 1.318, latMax: 1.335, lngMin: 103.810, lngMax: 103.828, gantryIds: ["PIE_ADAM"] },
    { latMin: 1.312, latMax: 1.328, lngMin: 103.890, lngMax: 103.910, gantryIds: ["PIE_EUNOS"] },
    { latMin: 1.304, latMax: 1.322, lngMin: 103.856, lngMax: 103.872, gantryIds: ["AR_UBKR", "AR_KALLANG_BAHRU", "AR_BENDEMEER"] }
  ];
  let costVehicleType = "sedan";
  let lastCostDistanceM = 0;
  let lastCostCoords = [];

  function havDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearPathForErp(coords, gLat, gLng, threshold) {
    for (let i = 0; i < coords.length; i += 1) {
      const [lat, lng] = coords[i];
      if (havDistance(lat, lng, gLat, gLng) <= threshold) return true;
      if (i < coords.length - 1) {
        const [nLat, nLng] = coords[i + 1];
        if (havDistance((lat + nLat) / 2, (lng + nLng) / 2, gLat, gLng) <= threshold) return true;
      }
    }
    return false;
  }

  function timeToMinutes(t) {
    const parts = String(t || "").split(":").map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function calcErpForRoute(coords, vehicleType) {
    const now = new Date();
    if (now.getDay() === 0) return { total: 0, gantries: [] };
    const nowM = now.getHours() * 60 + now.getMinutes();
    const multiplier = vehicleType === "motorcycle" ? 0.5 : 1.0;
    let total = 0;
    const hit = [];
    const charged = new Set();

    ERP_ZONES.forEach((zone) => {
      const inZone = coords.some(([lat, lng]) => lat >= zone.latMin && lat <= zone.latMax && lng >= zone.lngMin && lng <= zone.lngMax);
      if (!inZone) return;
      zone.gantryIds.forEach((gid) => {
        if (charged.has(gid)) return;
        const g = ERP_GANTRIES.find((x) => x.id === gid);
        if (!g) return;
        const active = g.rates.find((r) => nowM >= timeToMinutes(r.s) && nowM < timeToMinutes(r.e) && r.c > 0);
        if (!active) return;
        const charge = +(active.c * multiplier).toFixed(2);
        total += charge;
        hit.push({ name: g.name, charge });
        charged.add(gid);
      });
    });

    ERP_GANTRIES.forEach((g) => {
      if (charged.has(g.id) || !nearPathForErp(coords, g.lat, g.lng, ERP_THRESHOLD_M)) return;
      const active = g.rates.find((r) => nowM >= timeToMinutes(r.s) && nowM < timeToMinutes(r.e) && r.c > 0);
      if (!active) return;
      const charge = +(active.c * multiplier).toFixed(2);
      total += charge;
      hit.push({ name: g.name, charge });
      charged.add(g.id);
    });
    return { total: +total.toFixed(2), gantries: hit };
  }

  function getTripCostConfig() {
    const vehicle = VEHICLE_TYPES[costVehicleType] || VEHICLE_TYPES.sedan;
    const fuelSel = document.getElementById("cost-fuel-grade");
    const vehicleSel = document.getElementById("cost-vehicle-select");
    const settings = getCurrentUserSettings();
    let vehicleType = costVehicleType;
    let vehicleLabel = vehicle.label;
    let fuelGrade = fuelSel && fuelSel.value ? fuelSel.value : vehicle.fuelGrade;
    let consumption = Number(vehicle.consumption || 0);
    if (vehicleSel && vehicleSel.value !== "") {
      const savedVehicle = (settings.vehicles || [])[Number(vehicleSel.value)];
      if (savedVehicle) {
        const savedType = VEHICLE_TYPES[savedVehicle.vehicleType] || vehicle;
        vehicleType = savedVehicle.vehicleType || vehicleType;
        vehicleLabel = savedVehicle.name || savedType.label;
        fuelGrade = savedVehicle.fuelGrade || fuelGrade;
        consumption = Number(savedVehicle.consumption || consumption);
        if (fuelSel && fuelSel.value !== fuelGrade) fuelSel.value = fuelGrade;
      }
    }
    return {
      vehicleType,
      vehicleLabel,
      fuelGrade,
      consumption
    };
  }

  function computeTripCostMetrics(distanceM, coords) {
    const config = getTripCostConfig();
    const distKm = Number(distanceM || 0) / 1000;
    const litres = (distKm * config.consumption) / 100;
    const pricePerL = FUEL_PRICES[config.fuelGrade] || FUEL_PRICES.ron95;
    const fuelCost = +(litres * pricePerL).toFixed(2);
    const erpData = calcErpForRoute(Array.isArray(coords) ? coords : [], config.vehicleType);
    return {
      config,
      litres: +litres.toFixed(2),
      fuelCost,
      erpCost: erpData.total,
      totalCost: +(fuelCost + erpData.total).toFixed(2)
    };
  }

  function refreshCostVehicleSelect() {
    const selectRow = document.getElementById("cost-saved-vehicle-row");
    const selectEl = document.getElementById("cost-vehicle-select");
    const settings = getCurrentUserSettings();
    const vehicles = Array.isArray(settings.vehicles) ? settings.vehicles.slice(0, 3) : [];
    if (selectRow) selectRow.classList.toggle("hidden", !vehicles.length);
    if (selectEl) {
      const currentValue = selectEl.value;
      selectEl.innerHTML = `<option value="">User own vehicle</option>`;
      vehicles.forEach((vehicle, index) => {
        const typeDef = VEHICLE_TYPES[vehicle.vehicleType] || VEHICLE_TYPES.sedan;
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `${vehicle.name} · ${typeDef.label}`;
        selectEl.appendChild(option);
      });
      if (vehicles.some((_, index) => String(index) === currentValue)) {
        selectEl.value = currentValue;
      } else {
        selectEl.value = "";
      }
    }
    const config = getTripCostConfig();
    const consumptionEl = document.getElementById("cost-consumption");
    if (consumptionEl) consumptionEl.textContent = `${config.consumption.toFixed(1)} L/100km`;
  }

  function updateTripCost(distanceM, coords) {
    lastCostDistanceM = Number(distanceM || 0);
    lastCostCoords = Array.isArray(coords) ? coords.slice() : [];
    refreshCostVehicleSelect();
    if (state.routePlans.length) renderRouteCards();
  }

  function resetCostPanel() {
    lastCostDistanceM = 0;
    lastCostCoords = [];
    refreshCostVehicleSelect();
  }

  function bindTripCostControls() {
    ["sedan", "suv", "mpv", "motorcycle"].forEach((type) => {
      const btn = document.getElementById(`cost-type-${type}`);
      if (!btn) return;
      btn.addEventListener("click", function () {
        costVehicleType = type;
        ["sedan", "suv", "mpv", "motorcycle"].forEach((t) => {
          const item = document.getElementById(`cost-type-${t}`);
          if (item) item.classList.toggle("active", t === type);
        });
        updateTripCost(lastCostDistanceM, lastCostCoords);
      });
    });
    const fuelSel = document.getElementById("cost-fuel-grade");
    if (fuelSel) fuelSel.addEventListener("change", function () {
      updateTripCost(lastCostDistanceM, lastCostCoords);
    });
    const vehicleSel = document.getElementById("cost-vehicle-select");
    if (vehicleSel) vehicleSel.addEventListener("change", function () {
      updateTripCost(lastCostDistanceM, lastCostCoords);
    });
    refreshCostVehicleSelect();
    resetCostPanel();
  }
  window.refreshTripCostVehicleSelect = refreshCostVehicleSelect;
  window.updateTripCost = updateTripCost;
  window.resetTripCostPanel = resetCostPanel;
