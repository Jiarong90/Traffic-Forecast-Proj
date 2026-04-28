const { latestMobileLocation } = require('../state');

function getMobileLocationPayload() {
  return {
    lat: latestMobileLocation.lat,
    lon: latestMobileLocation.lon,
    accuracy: latestMobileLocation.accuracy,
    timestamp: latestMobileLocation.timestamp,
    source: latestMobileLocation.source,
    deviceName: latestMobileLocation.deviceName,
    fresh: Number.isFinite(latestMobileLocation.timestamp) ? (Date.now() - latestMobileLocation.timestamp) <= 15000 : false
  };
}

module.exports = { getMobileLocationPayload };
