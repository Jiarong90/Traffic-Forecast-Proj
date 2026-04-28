/**
 * TrafficMLModel — Weather-Based Traffic Impact Prediction
 *
 * Primary  : Calls the Python Flask backend (localhost:7842/predict)
 *            which runs a scikit-learn RandomForestClassifier trained on
 *            LTA-format traffic + weather data.
 *
 * Fallback : If the server is unavailable, falls back to a 12-tree
 *            in-browser Random Forest ensemble for offline / demo use.
 *
 * Usage    : const result = await TrafficMLModel.predict(weather, forecast);
 */

const ML_API_URL = "/api/ml/traffic-impact";

const TrafficMLModel = (function () {

  // ── Feature indices ───────────────────────────────────────────────────────────
  const F_RAIN_POP    = 0;  // Max rain probability across forecast window  (0–1)
  const F_RAIN_AMT    = 1;  // Accumulated rain amount, normalised           (0–1)
  const F_WIND        = 2;  // Wind speed, normalised                        (0–1)
  const F_VIS_IMPACT  = 3;  // Visibility impact (0 = perfect, 1 = none)     (0–1)
  const F_HUMIDITY    = 4;  // Relative humidity                             (0–1)
  const F_TEMP_STRESS = 5;  // Temperature stress (heat/cold deviation)      (0–1)
  const F_FORECAST    = 6;  // Forecast worsening signal                     (0 or 1)

  // ── Feature extraction ────────────────────────────────────────────────────────
  function extractFeatures(weather, forecast) {
    const maxRainPop  = Math.max(...forecast.hourly.map(h => h.pop), 0) / 100;
    const totalRain   = forecast.hourly.reduce((s, h) => s + (h.rain || 0), 0);
    const wind        = parseFloat(weather.wind);
    const vis         = parseFloat(weather.visibility);
    const temp        = weather.temp;

    const rainAmt     = Math.min(totalRain / 20, 1);
    const windNorm    = Math.min(wind / 20, 1);
    const visImpact   = Math.max(0, 1 - vis / 10);
    const tempStress  = temp > 38 ? 1.0
                      : temp > 35 ? 0.8
                      : temp > 32 ? 0.5
                      : temp > 28 ? 0.25 : 0;

    // Forecast trend: is rain probability rising over the coming hours?
    const pops = forecast.hourly.map(h => h.pop);
    const forecastWorse = pops.length >= 2 && pops[pops.length - 1] > pops[0] + 10 ? 1 : 0;

    return [maxRainPop, rainAmt, windNorm, visImpact,
            weather.humidity / 100, tempStress, forecastWorse];
  }

  // ── Decision-tree traversal ───────────────────────────────────────────────────
  // Node  : { f, t, l, r }  — split on feature f at threshold t
  //         features[f] <= t  → left (l);   features[f] > t  → right (r)
  // Leaf  : { c }            — predicted class index (0=Low … 3=Severe)
  function treePredict(node, f) {
    if (node.c !== undefined) return node.c;
    return f[node.f] <= node.t ? treePredict(node.l, f) : treePredict(node.r, f);
  }

  // ── 12 Pre-calibrated Decision Trees ─────────────────────────────────────────

  // T1 — Rain probability is the primary driver
  const T1 = {f:F_RAIN_POP, t:0.35,
    l: {f:F_RAIN_POP, t:0.10,
      l: {c:0},
      r: {f:F_WIND, t:0.25, l:{c:0}, r:{c:1}}},
    r: {f:F_RAIN_POP, t:0.70,
      l: {f:F_WIND, t:0.35, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.88,
        l: {f:F_WIND, t:0.50, l:{c:2}, r:{c:3}},
        r: {c:3}}}};

  // T2 — Visibility is the primary driver
  const T2 = {f:F_VIS_IMPACT, t:0.20,
    l: {f:F_RAIN_POP, t:0.50,
      l: {c:0},
      r: {f:F_WIND, t:0.40, l:{c:1}, r:{c:2}}},
    r: {f:F_VIS_IMPACT, t:0.55,
      l: {f:F_RAIN_POP, t:0.40, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.55, l:{c:2}, r:{c:3}}}};

  // T3 — Wind speed is the primary driver
  const T3 = {f:F_WIND, t:0.25,
    l: {f:F_RAIN_POP, t:0.55,
      l: {c:0},
      r: {f:F_VIS_IMPACT, t:0.30, l:{c:1}, r:{c:2}}},
    r: {f:F_WIND, t:0.55,
      l: {f:F_RAIN_POP, t:0.50, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.60, l:{c:2}, r:{c:3}}}};

  // T4 — Rain accumulation is the primary driver
  const T4 = {f:F_RAIN_AMT, t:0.08,
    l: {f:F_RAIN_POP, t:0.40,
      l: {c:0},
      r: {f:F_VIS_IMPACT, t:0.25, l:{c:1}, r:{c:1}}},
    r: {f:F_RAIN_AMT, t:0.35,
      l: {f:F_WIND, t:0.40, l:{c:2}, r:{c:2}},
      r: {f:F_RAIN_AMT, t:0.70, l:{c:2}, r:{c:3}}}};

  // T5 — Temperature stress + humidity compound
  const T5 = {f:F_TEMP_STRESS, t:0.25,
    l: {f:F_RAIN_POP, t:0.50,
      l: {c:0},
      r: {f:F_HUMIDITY, t:0.85, l:{c:1}, r:{c:2}}},
    r: {f:F_HUMIDITY, t:0.80,
      l: {f:F_RAIN_POP, t:0.50, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.45, l:{c:2}, r:{c:3}}}};

  // T6 — Rain probability × visibility interaction
  const T6 = {f:F_RAIN_POP, t:0.50,
    l: {f:F_VIS_IMPACT, t:0.35,
      l: {c:0},
      r: {f:F_RAIN_POP, t:0.25, l:{c:0}, r:{c:1}}},
    r: {f:F_VIS_IMPACT, t:0.25,
      l: {f:F_RAIN_POP, t:0.75, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.65, l:{c:2}, r:{c:3}}}};

  // T7 — Forecast worsening signal as tiebreaker
  const T7 = {f:F_FORECAST, t:0.5,
    l: {f:F_RAIN_POP, t:0.50,
      l: {f:F_VIS_IMPACT, t:0.30, l:{c:0}, r:{c:1}},
      r: {f:F_WIND,     t:0.40, l:{c:1}, r:{c:2}}},
    r: {f:F_RAIN_POP, t:0.40,
      l: {f:F_VIS_IMPACT, t:0.40, l:{c:1}, r:{c:2}},
      r: {f:F_WIND,     t:0.50, l:{c:2}, r:{c:3}}}};

  // T8 — Wind × visibility compound
  const T8 = {f:F_WIND, t:0.35,
    l: {f:F_VIS_IMPACT, t:0.25,
      l: {f:F_RAIN_POP, t:0.50, l:{c:0}, r:{c:1}},
      r: {f:F_RAIN_POP, t:0.45, l:{c:1}, r:{c:2}}},
    r: {f:F_VIS_IMPACT, t:0.45,
      l: {f:F_RAIN_POP, t:0.55, l:{c:1}, r:{c:2}},
      r: {c:3}}};

  // T9 — Severe weather early-detector
  const T9 = {f:F_RAIN_POP, t:0.80,
    l: {f:F_WIND, t:0.55,
      l: {f:F_VIS_IMPACT, t:0.55, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP,   t:0.50, l:{c:2}, r:{c:2}}},
    r: {f:F_VIS_IMPACT, t:0.25,
      l: {f:F_WIND, t:0.45, l:{c:2}, r:{c:3}},
      r: {c:3}}};

  // T10 — Low-impact discriminator
  const T10 = {f:F_VIS_IMPACT, t:0.15,
    l: {f:F_RAIN_POP, t:0.30,
      l: {c:0},
      r: {f:F_WIND, t:0.20, l:{c:0}, r:{c:1}}},
    r: {f:F_VIS_IMPACT, t:0.45,
      l: {f:F_RAIN_POP, t:0.60, l:{c:1}, r:{c:2}},
      r: {f:F_WIND,     t:0.40, l:{c:2}, r:{c:3}}}};

  // T11 — Humidity × rain combination
  const T11 = {f:F_HUMIDITY, t:0.70,
    l: {f:F_RAIN_POP, t:0.40,
      l: {c:0},
      r: {f:F_VIS_IMPACT, t:0.30, l:{c:1}, r:{c:2}}},
    r: {f:F_RAIN_POP, t:0.50,
      l: {f:F_WIND,     t:0.30, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_AMT, t:0.20, l:{c:2}, r:{c:3}}}};

  // T12 — Moderate-bias balancer tree
  const T12 = {f:F_RAIN_POP, t:0.45,
    l: {f:F_VIS_IMPACT, t:0.20,
      l: {c:0},
      r: {f:F_TEMP_STRESS, t:0.40, l:{c:1}, r:{c:1}}},
    r: {f:F_WIND, t:0.30,
      l: {f:F_HUMIDITY, t:0.80, l:{c:1}, r:{c:2}},
      r: {f:F_RAIN_POP, t:0.70, l:{c:2}, r:{c:3}}}};

  const FOREST = [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12];

  // ── Class metadata ────────────────────────────────────────────────────────────
  const CLASSES = [
    { label: '✅ Low Impact',      css: 'impact-low',      scoreBase: 1.5 },
    { label: '⚠️ Moderate Impact', css: 'impact-moderate', scoreBase: 4.0 },
    { label: '🟠 High Impact',     css: 'impact-high',     scoreBase: 6.5 },
    { label: '🔴 Severe Impact',   css: 'impact-severe',   scoreBase: 9.0 },
  ];

  // ── Clearing time from continuous score ───────────────────────────────────────
  function getClearingTime(score) {
    if (score <= 1)  return '< 5 min';
    if (score <= 2)  return '5–10 min';
    if (score <= 3)  return '10–15 min';
    if (score <= 4)  return '15–25 min';
    if (score <= 5)  return '20–30 min';
    if (score <= 6)  return '35–45 min';
    if (score <= 7)  return '45–60 min';
    if (score <= 8)  return '60–80 min';
    if (score <= 9)  return '80–100 min';
    return '100+ min';
  }

  // ── Context-aware impact summary ──────────────────────────────────────────────
  function buildSummary(cls, topFactors) {
    const pools = [
      // Class 0 — Low
      [
        'Weather conditions are clear and unlikely to affect traffic flow.',
        'Good driving conditions expected. No significant weather-related delays.',
        'Minimal weather impact detected — normal traffic flow anticipated.',
        'Conditions are favourable. Roads should be clear across most routes.'
      ],
      // Class 1 — Moderate
      [
        `${topFactors[0]} may cause minor slowdowns on some routes. Allow extra travel time.`,
        'Moderate weather conditions could affect traffic in exposed areas. Drive with care.',
        'Some weather factors may contribute to reduced speeds. Stay alert on main roads.',
        `${topFactors[0]} detected — conditions manageable but may slow traffic in certain areas.`
      ],
      // Class 2 — High
      [
        `${topFactors[0]} is likely to impact road conditions significantly. Expect slower speeds and delays.`,
        'Adverse weather detected. Significant traffic slowdowns are probable on major routes.',
        `High ${topFactors[0].toLowerCase()} and reduced visibility may cause notable traffic disruption.`,
        'Poor weather conditions may lead to congestion. Consider alternate routes or delayed departure.'
      ],
      // Class 3 — Severe
      [
        'Hazardous weather conditions detected. Severe traffic disruption is likely across most routes.',
        `Extreme ${topFactors[0].toLowerCase()} may cause significant congestion and safety hazards. Avoid travel if possible.`,
        'Weather conditions are dangerous. Major delays expected — consider postponing travel.',
        'Severe conditions affecting road safety. Stay off roads unless absolutely necessary.'
      ]
    ];
    const opts = pools[cls];
    // Deterministic selection based on feature hash to avoid flicker on re-renders
    return opts[0];
  }

  // ── Feature importance ranking ────────────────────────────────────────────────
  function rankFactors(f) {
    return [
      { name: 'Rain Probability', raw: f[F_RAIN_POP],    weight: 0.35, pct: Math.round(f[F_RAIN_POP]    * 100) },
      { name: 'Rain Amount',      raw: f[F_RAIN_AMT],    weight: 0.20, pct: Math.round(f[F_RAIN_AMT]    * 100) },
      { name: 'Wind Speed',       raw: f[F_WIND],        weight: 0.20, pct: Math.round(f[F_WIND]        * 100) },
      { name: 'Visibility',       raw: f[F_VIS_IMPACT],  weight: 0.15, pct: Math.round(f[F_VIS_IMPACT]  * 100) },
      { name: 'Humidity',         raw: f[F_HUMIDITY],    weight: 0.05, pct: Math.round(f[F_HUMIDITY]    * 100) },
      { name: 'Heat Stress',      raw: f[F_TEMP_STRESS], weight: 0.05, pct: Math.round(f[F_TEMP_STRESS] * 100) },
    ].sort((a, b) => (b.raw * b.weight) - (a.raw * a.weight));
  }

  // ── In-browser fallback predict (synchronous) ────────────────────────────────
  function predictLocal(weather, forecast) {
    const f = extractFeatures(weather, forecast);

    const votes = [0, 0, 0, 0];
    FOREST.forEach(tree => votes[treePredict(tree, f)]++);

    const total      = FOREST.length;
    const winClass   = votes.indexOf(Math.max(...votes));
    const confidence = Math.round((votes[winClass] / total) * 100);
    const rawScore   = (votes[0]*1.5 + votes[1]*4.0 + votes[2]*6.5 + votes[3]*9.0) / total;
    const score      = Math.min(10, Math.max(0, Math.round(rawScore * 2) / 2));

    const cls    = CLASSES[winClass];
    const factors = rankFactors(f);

    return {
      score,
      level:        cls.label,
      levelClass:   cls.css,
      summary:      buildSummary(winClass, factors.slice(0,2).map(x => x.name)),
      clearingTime: getClearingTime(score),
      confidence,
      source:       "browser-fallback",
      features: {
        rainPop:    f[F_RAIN_POP],
        rainAmt:    f[F_RAIN_AMT],
        wind:       f[F_WIND],
        visImpact:  f[F_VIS_IMPACT],
        humidity:   f[F_HUMIDITY],
        tempStress: f[F_TEMP_STRESS],
      },
      factors,
    };
  }

  // ── Public async predict — tries Python API, falls back to browser forest ─────
  async function predict(weather, forecast) {
    // Build payload for the API
    const maxRainPop = Math.max(...forecast.hourly.map(h => h.pop), 0);
    const totalRain  = forecast.hourly.reduce((s, h) => s + (h.rain || 0), 0);
    const now        = new Date();

    const payload = {
      temp:         weather.temp,
      feels:        weather.feels,
      humidity:     weather.humidity,
      wind:         parseFloat(weather.wind),
      visibility:   parseFloat(weather.visibility),
      pressure:     weather.pressure,
      rain_pop:     maxRainPop,
      rain_amount:  totalRain,
      desc:         weather.desc,
      hour:         now.getHours(),
      day_of_week:  now.getDay() === 0 ? 6 : now.getDay() - 1,  // Mon=0
    };

    try {
      const res = await fetch(ML_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          weather: {
            temp: weather.temp,
            feels: weather.feels,
            humidity: weather.humidity,
            wind: weather.wind,
            visibility: weather.visibility,
            pressure: weather.pressure,
            desc: weather.desc
          },
          forecast: Array.isArray(forecast?.hourly) ? forecast.hourly : (Array.isArray(forecast) ? forecast : [])
        }),
        signal:  AbortSignal.timeout(6000),
      });

      if (!res.ok) throw new Error(`API responded ${res.status}`);

      const data = await res.json();

      // Normalise API response to the same shape the UI expects
      const f = extractFeatures(weather, forecast);
      return {
        score:        data.score,
        level:        data.level,
        levelClass:   data.levelClass || data.level_class,
        summary:      data.summary,
        clearingTime: data.clearingTime || data.clearing_time,
        confidence:   data.confidence,
        source:       "python-api",
        features: {
          rainPop:    f[F_RAIN_POP],
          rainAmt:    f[F_RAIN_AMT],
          wind:       f[F_WIND],
          visImpact:  f[F_VIS_IMPACT],
          humidity:   f[F_HUMIDITY],
          tempStress: f[F_TEMP_STRESS],
        },
        factors: data.factors.map(fc => ({
          name: fc.name,
          pct:  fc.pct,
          raw:  fc.pct / 100,
          weight: 0.2,
        })),
      };

    } catch (_) {
      // Server offline or timed out — use in-browser Random Forest
      console.warn("[TrafficML] Python API unavailable — using browser fallback.");
      return predictLocal(weather, forecast);
    }
  }

  return { predict };

})();

window.TrafficMLModel = TrafficMLModel;
