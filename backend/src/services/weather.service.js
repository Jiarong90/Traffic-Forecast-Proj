const config = require('../../config');

function readWeatherCoordsOrSendError(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Invalid lat/lon parameters' });
    return null;
  }
  return { lat, lon };
}

function ensureWeatherApiKeyOrSendError(res) {
  if (!config.OPENWEATHER_API_KEY) {
    res.status(500).json({ error: 'OPENWEATHER_API_KEY not configured' });
    return false;
  }
  return true;
}

module.exports = {
  readWeatherCoordsOrSendError,
  ensureWeatherApiKeyOrSendError
};
