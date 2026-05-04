const config = require('../config');
const { pool } = require('./db');
const state = require('./state');
const common = require('./utils/common');
const auth = require('./services/auth.service');
const payload = require('./services/payload.service');
const mobile = require('./services/mobile.service');
const data = require('./services/data.service');
const python = require('./services/python.service');
const gemini = require('./services/gemini.service');
const weather = require('./services/weather.service');

function createApiRouteContext(app) {
  return {
    app,
    SIGNUP_CODE_TTL_MIN: config.SIGNUP_CODE_TTL_MIN,
    pool,
    latestMobileLocation: state.latestMobileLocation,
    realtimeCameraFallback: state.realtimeCameraFallback,
    NEWS_ACCIDENT_RSS: config.NEWS_ACCIDENT_RSS,
    NEWS_RULE_RSS: config.NEWS_RULE_RSS,
    ONEMOTORING_ERP_KML_URL: config.ONEMOTORING_ERP_KML_URL,
    ONEMOTORING_PGS_KML_URL: config.ONEMOTORING_PGS_KML_URL,
    OPENWEATHER_API_KEY: config.OPENWEATHER_API_KEY,
    OPENWEATHER_CURRENT_API: config.OPENWEATHER_CURRENT_API,
    OPENWEATHER_FORECAST_API: config.OPENWEATHER_FORECAST_API,
    NEWS_API_KEY: config.NEWS_API_KEY,
    PY_ML_ENGINE_PATH: config.PY_ML_ENGINE_PATH,
    ...common,
    ...auth,
    ...payload,
    ...mobile,
    ...data,
    ...python,
    ...gemini,
    ...weather
  };
}

module.exports = { createApiRouteContext };
