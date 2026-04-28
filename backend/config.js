const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const PYTHON_DIR = path.join(ROOT_DIR, 'python');
const PYTHON_DATA_DIR = path.join(PYTHON_DIR, 'data');

const PORT = process.env.PORT || 3000;
const SIGNUP_CODE_TTL_MIN = 10;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fyp_demo';
const DATABASE_SSL = String(process.env.DATABASE_SSL || '').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@fast.local';
const MAIL_DEV_MODE = String(process.env.MAIL_DEV_MODE || 'true').toLowerCase() === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const FASTAPI_BASE_URL = process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000';
const RATE_LIMIT_WINDOW_MS = Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000);
const RATE_LIMIT_MAX = Math.max(10, parseInt(process.env.RATE_LIMIT_MAX || '180', 10) || 180);
const AUTH_RATE_LIMIT_MAX = Math.max(3, parseInt(process.env.AUTH_RATE_LIMIT_MAX || '40', 10) || 40);
const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || '';
const PYTHON_BIN = process.env.PYTHON_BIN || path.join(__dirname, '.venv', 'bin', 'python');

const TRAFFIC_IMAGES_API = 'https://api.data.gov.sg/v1/transport/traffic-images';
const TRAFFIC_INCIDENTS_API = 'https://api.data.gov.sg/v1/transport/traffic-incidents';
const LTA_TRAFFIC_INCIDENTS_API = 'https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents';
const OPENWEATHER_CURRENT_API = 'https://api.openweathermap.org/data/2.5/weather';
const OPENWEATHER_FORECAST_API = 'https://api.openweathermap.org/data/2.5/forecast';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
const LTA_SIGNAL_GEOJSON_PATH = path.join(PYTHON_DATA_DIR, 'LTATrafficSignalAspectGEOJSON.geojson');
const INCIDENT_MOCK_PATH = path.join(PYTHON_DATA_DIR, 'incident_api_mock.json');
const LOCAL_ROAD_NETWORK_PATH = path.join(PYTHON_DATA_DIR, 'sg-road-network-overpass.json');
const ERP_RATES_JSON_PATH = path.join(PYTHON_DATA_DIR, 'erp_rates_2026-03-23.json');
const PY_ENGINE_PATH = path.join(PYTHON_DIR, 'compute', 'routing.py');
const PY_ML_ENGINE_PATH = path.join(PYTHON_DIR, 'ml', 'traffic_predictor.py');
const SPF_RED_LIGHT_API = 'https://api-open.data.gov.sg/v1/public/api/datasets/d_271f8db0ab03ca15ef0f0f9f88bc4d6e/poll-download';
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const SG_BBOX = '1.16,103.60,1.48,104.10';
const NEWS_ACCIDENT_RSS = 'https://news.google.com/rss/search?q=Singapore+traffic+accident+when:7d&hl=en-SG&gl=SG&ceid=SG:en';
const NEWS_RULE_RSS = 'https://news.google.com/rss/search?q=Singapore+LTA+traffic+rule+update&hl=en-SG&gl=SG&ceid=SG:en';
const ONEMOTORING_ERP_KML_URL = 'https://onemotoring.lta.gov.sg/mapapp/kml/erp-kml/erp-kml-0.kml';
const ONEMOTORING_PGS_KML_URL = 'https://onemotoring.lta.gov.sg/mapapp/kml/pgs-kml/pgs-kml-0.kml';
const ONEMOTORING_PARKING_RATE_PAGE_URLS = [
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.1.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.2.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.3.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.4.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.5.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.6.html',
  'https://onemotoring.lta.gov.sg/content/onemotoring/home/owning/ongoing-car-costs/parking/parking_rates.8.html'
];

module.exports = {
  ROOT_DIR,
  FRONTEND_DIR,
  PYTHON_DIR,
  PYTHON_DATA_DIR,
  PORT,
  SIGNUP_CODE_TTL_MIN,
  DATABASE_URL,
  DATABASE_SSL,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  MAIL_DEV_MODE,
  GEMINI_API_KEY,
  OPENWEATHER_API_KEY,
  FASTAPI_BASE_URL,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_MAX,
  LTA_ACCOUNT_KEY,
  PYTHON_BIN,
  TRAFFIC_IMAGES_API,
  TRAFFIC_INCIDENTS_API,
  LTA_TRAFFIC_INCIDENTS_API,
  OPENWEATHER_CURRENT_API,
  OPENWEATHER_FORECAST_API,
  GEMINI_API_URL,
  LTA_SIGNAL_GEOJSON_PATH,
  INCIDENT_MOCK_PATH,
  LOCAL_ROAD_NETWORK_PATH,
  ERP_RATES_JSON_PATH,
  PY_ENGINE_PATH,
  PY_ML_ENGINE_PATH,
  SPF_RED_LIGHT_API,
  OVERPASS_API,
  SG_BBOX,
  NEWS_ACCIDENT_RSS,
  NEWS_RULE_RSS,
  ONEMOTORING_ERP_KML_URL,
  ONEMOTORING_PGS_KML_URL,
  ONEMOTORING_PARKING_RATE_PAGE_URLS,
  STATIC_SOURCE_TTL_MS: 60 * 60 * 1000,
  INCIDENT_SOURCE_TTL_MS: 2 * 60 * 1000,
  ONEMOTORING_SOURCE_TTL_MS: 10 * 60 * 1000,
  MAX_LTA_SIGNAL_POINTS: 2500,
  MAX_OSM_POINTS: 1200,
  MAX_SPF_POINTS: 600,
  ROAD_NETWORK_CACHE_TTL_MS: 30 * 60 * 1000,
  ROAD_NETWORK_STALE_TTL_MS: 6 * 60 * 60 * 1000,
  LOCAL_ROAD_NETWORK_TTL_MS: 12 * 60 * 60 * 1000,
  OVERPASS_FETCH_TIMEOUT_MS: 12000
};
