const latestMobileLocation = {
  lat: null,
  lon: null,
  accuracy: null,
  timestamp: null,
  source: 'none',
  deviceName: ''
};

const sourceCache = new Map();
const realtimeCameraFallback = { time: 0, value: [] };
const incidentCameraMatchCache = new Map();
const mockIncidentRuntime = {
  step: 0,
  stateById: new Map()
};

module.exports = {
  latestMobileLocation,
  sourceCache,
  realtimeCameraFallback,
  incidentCameraMatchCache,
  mockIncidentRuntime
};
