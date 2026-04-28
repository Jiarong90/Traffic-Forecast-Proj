module.exports = function registerWeatherAiRoutes(ctx) {
  const {
    app,
    OPENWEATHER_API_KEY,
    OPENWEATHER_CURRENT_API,
    OPENWEATHER_FORECAST_API,
    PY_ML_ENGINE_PATH,
    nowIso,
    readWeatherCoordsOrSendError,
    ensureWeatherApiKeyOrSendError,
    callGeminiText,
    callFastApiJson,
    runPythonJsonScript
  } = ctx;

app.get('/api/weather/current', async (req, res) => {
  const coords = readWeatherCoordsOrSendError(req, res);
  if (!coords) return;
  if (!ensureWeatherApiKeyOrSendError(res)) return;
  try {
    const { lat, lon } = coords;
    const url = `${OPENWEATHER_CURRENT_API}?lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(OPENWEATHER_API_KEY)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenWeather API error: ${r.status}`);
    const d = await r.json();
    res.json({
      temp: Math.round(d.main?.temp),
      feels: Math.round(d.main?.feels_like),
      desc: d.weather?.[0]?.description || 'unknown',
      humidity: d.main?.humidity,
      wind: d.wind?.speed,
      pressure: d.main?.pressure,
      visibility: ((d.visibility || 0) / 1000).toFixed(1),
      sunrise: Number(d.sys?.sunrise) || null,
      sunset: Number(d.sys?.sunset) || null
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch weather', details: e.message });
  }
});

app.get('/api/weather/forecast', async (req, res) => {
  const coords = readWeatherCoordsOrSendError(req, res);
  if (!coords) return;
  if (!ensureWeatherApiKeyOrSendError(res)) return;
  try {
    const { lat, lon } = coords;
    const now = Date.now();
    const url = `${OPENWEATHER_FORECAST_API}?lat=${lat}&lon=${lon}&units=metric&appid=${encodeURIComponent(OPENWEATHER_API_KEY)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenWeather Forecast API error: ${r.status}`);
    const d = await r.json();
    const value = (d.list || [])
      .filter(item => {
        const ts = (item.dt || 0) * 1000;
        return ts > now && ts <= now + 24 * 60 * 60 * 1000;
      })
      .slice(0, 3)
      .map(item => ({
        dt: item.dt,
        temp: Math.round(item.main?.temp),
        desc: item.weather?.[0]?.description || 'unknown',
        pop: Math.round((item.pop || 0) * 100),
        rain: item.rain?.['3h'] || 0
      }));
    res.json({ value });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch weather forecast', details: e.message });
  }
});

app.post('/api/ai/weather-advice', async (req, res) => {
  const location = req.body?.location || {};
  const weather = req.body?.weather || {};
  const forecast = Array.isArray(req.body?.forecast) ? req.body.forecast : [];
  if (!location?.display || !weather?.desc) {
    return res.status(400).json({ error: 'Missing location/weather parameters' });
  }
  const future = forecast.map((f) => {
    const t = new Date((f.dt || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${t}: ${f.desc}, ${f.temp}°C, rain chance ${f.pop}%`;
  }).join('\n');
  const prompt = `
You are a Singapore travel advisor.
Give 4 bullet points starting with "•".
Location: ${location.display}
Current: ${weather.desc}, ${weather.temp}°C, humidity ${weather.humidity}%, wind ${weather.wind} m/s
Next hours:
${future}
Include:
1) go out or not
2) what to wear
3) umbrella needed?
4) driving tip
`.trim();
  try {
    const text = await callGeminiText(prompt);
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: 'AI advice generation failed', details: e.message });
  }
});

function buildIncidentReasonFallback({ message, incidentType, severity, createdAt }) {
  const text = `${message || ''} ${incidentType || ''}`.toLowerCase();
  const score = Number(severity) || 0;
  const hour = Number.isFinite(new Date(createdAt).getHours()) ? new Date(createdAt).getHours() : null;
  const isPeak = hour !== null && ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20));

  if (text.includes('accident') || text.includes('collision') || text.includes('crash')) {
    return 'A collision or lane blockage is likely forcing vehicles to merge and slow down.';
  }
  if (text.includes('breakdown') || text.includes('stalled') || text.includes('vehicle')) {
    return 'A broken-down vehicle is likely reducing usable lane space and creating a bottleneck.';
  }
  if (text.includes('road work') || text.includes('roadwork') || text.includes('maintenance') || text.includes('works')) {
    return 'Road works are likely narrowing the carriageway and causing slower merging traffic.';
  }
  if (text.includes('obstacle') || text.includes('debris')) {
    return 'An obstacle on the road is likely making drivers brake and pass the area more cautiously.';
  }
  if (text.includes('congestion') || text.includes('jam') || text.includes('slow traffic')) {
    return isPeak
      ? 'Peak-period demand and repeated braking are likely causing traffic to build up.'
      : 'Heavy traffic build-up is likely causing stop-start movement and reduced road capacity.';
  }
  if (text.includes('closure') || text.includes('closed')) {
    return 'A lane or road closure is likely diverting traffic into fewer lanes and increasing delay.';
  }
  if (text.includes('rain') || text.includes('wet')) {
    return 'Wet conditions are likely making drivers keep larger gaps and reduce speed.';
  }
  if (score >= 3) {
    return 'A serious disruption is likely reducing available lanes and causing drivers to merge slowly.';
  }
  if (score === 2) {
    return 'A moderate disruption is likely creating intermittent braking and short queues.';
  }
  return 'Drivers are likely slowing to pass the affected section safely, causing a temporary traffic build-up.';
}

function locationTerms(area, cameraName) {
  const stopWords = new Set([
    'road', 'street', 'avenue', 'drive', 'lane', 'link', 'expressway', 'highway',
    'before', 'after', 'towards', 'near', 'along', 'singapore', 'camera',
    'north', 'south', 'east', 'west', 'central', 'region', 'exit', 'entrance'
  ]);
  return Array.from(new Set(`${area || ''} ${cameraName || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !stopWords.has(word))));
}

function reasonRepeatsLocation(reason, area, cameraName) {
  const cleanReason = String(reason || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cleanArea = String(area || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleanReason) return true;
  if (cleanArea.length >= 12 && cleanReason.includes(cleanArea)) return true;

  const terms = locationTerms(area, cameraName);
  const matches = terms.filter((term) => cleanReason.includes(term)).length;
  const locationPhrase = /\b(at|near|around|along|towards|before|after)\b/.test(cleanReason);
  return locationPhrase && matches >= Math.min(2, terms.length || 2);
}

app.post('/api/ai/incident-summary', async (req, res) => {
  const incident = req.body?.incident || {};
  const message = String(incident.message || incident.type || 'Traffic incident').trim();
  const incidentType = String(incident.incidentType || incident.type || message || 'Traffic incident').trim();
  const area = String(incident.area || 'Unknown area').trim();
  const createdAt = String(incident.createdAt || nowIso()).trim();
  const cameraName = String(incident.cameraName || 'None').trim();
  const severity = Number(incident.severity || incident.severityScore || 0) || 0;
  const fallbackReason = buildIncidentReasonFallback({ message, incidentType, severity, createdAt });
  const prompt = `You are a Singapore traffic assistant writing for everyday drivers. Return strict JSON only with keys: location,time,reason,duration.
Incident text: ${message}
Incident type: ${incidentType}
Area: ${area}
Reported at: ${createdAt}
Camera: ${cameraName}
Severity level: ${severity || 'unknown'}
Rules:
- reason must be plain, human, easy to understand, no jargon, no code-like words.
- reason should sound like a real person explaining likely cause in one short sentence.
- reason must infer the likely cause from incident type, time, and context.
- reason must not repeat, quote, or paraphrase the Area or Camera value.
- reason must describe why traffic is affected, not where it happened.
- duration should be practical and easy for drivers to understand.
Keep each value within 1 sentence.`;
  try {
    const text = await callGeminiText(prompt);
    let parsed = null;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch (_) { }
    }
    if (!parsed) {
      parsed = {
        location: area,
        time: createdAt,
        reason: fallbackReason,
        duration: '30-90 minutes (estimated)'
      };
    }
    let humanReason = String(parsed.reason || '').trim() || fallbackReason;
    if (reasonRepeatsLocation(humanReason, area, cameraName)) {
      humanReason = fallbackReason;
    }
    res.json({
      location: parsed.location || area,
      time: parsed.time || createdAt,
      reason: humanReason,
      duration: parsed.duration || '30-90 minutes (estimated)'
    });
  } catch (e) {
    res.status(500).json({ error: 'AI incident summary generation failed', details: e.message });
  }
});

app.post('/api/ml/traffic-impact', async (req, res) => {
  const weather = req.body?.weather || {};
  const forecast = Array.isArray(req.body?.forecast) ? req.body.forecast : [];
  if (!weather || !forecast.length) {
    return res.status(400).json({ error: 'weather and forecast are required' });
  }
  try {
    const maxRainPop = Math.max(...forecast.map((item) => Number(item?.pop) || 0), 0);
    const totalRain = forecast.reduce((sum, item) => sum + (Number(item?.rain) || 0), 0);
    const now = new Date();
    const payload = {
      temp: Number(weather.temp) || 0,
      feels: Number(weather.feels) || 0,
      humidity: Number(weather.humidity) || 0,
      wind: Number(weather.wind) || 0,
      visibility: Number(weather.visibility) || 0,
      pressure: Number(weather.pressure) || 0,
      rain_pop: maxRainPop,
      rain_amount: totalRain,
      desc: String(weather.desc || ''),
      hour: now.getHours(),
      day_of_week: now.getDay() === 0 ? 6 : now.getDay() - 1
    };
    let result;
    try {
      result = await callFastApiJson('/compute/ml-traffic-impact', payload, 15000);
    } catch (fastApiErr) {
      console.warn(`FastAPI ML traffic impact fell back to python script: ${fastApiErr.message}`);
      result = await runPythonJsonScript(PY_ML_ENGINE_PATH, payload, 15000);
    }
    res.json(result);
  } catch (error) {
    console.error('ML traffic impact prediction failed:', error.message);
    res.status(500).json({ error: 'ML traffic impact prediction failed', details: error.message });
  }
});
};
