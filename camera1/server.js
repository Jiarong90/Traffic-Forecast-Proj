require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/ui2', express.static(path.join(__dirname, '..', 'UI 2')));

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
function shouldEnableDatabaseSsl(connectionString) {
  if (DATABASE_SSL === 'true' || DATABASE_SSL === 'require') return true;
  if (DATABASE_SSL === 'false' || DATABASE_SSL === 'disable') return false;
  return /supabase\.co/i.test(String(connectionString || ''));
}

function buildPoolConfig(connectionString) {
  const config = { connectionString };
  if (shouldEnableDatabaseSsl(connectionString)) {
    // Supabase 的 PostgreSQL 通常要求 SSL，保留 rejectUnauthorized=false 以兼容托管证书链。
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

const pool = new Pool(buildPoolConfig(DATABASE_URL));
const latestMobileLocation = {
  lat: null,
  lon: null,
  accuracy: null,
  timestamp: null,
  source: 'none',
  deviceName: ''
};

/**
 * 默认模拟配置（管理员可在前端切换/更新）
 *
 * 字段含义：
 * - enabled: 是否启用该配置
 * - events[].ratio: 事件在线路上的相对位置（0~1）
 * - events[].delayMin: 该事件对路线造成的基准延误（分钟）
 * - events[].severity: 严重等级（1~3）
 *
 * 说明：
 * - 该配置仅用于“模拟路线/模拟事故”功能，不影响 LTA 实时事故数据。
 */
const DEFAULT_SIMULATION_CONFIG = {
  enabled: false,
  events: [
    { label: 'Accident', type: 'accident', ratio: 0.28, delayMin: 12, severity: 3, color: '#ef4444' },
    { label: 'Congestion', type: 'congestion', ratio: 0.53, delayMin: 9, severity: 2, color: '#f59e0b' },
    { label: 'Roadwork', type: 'roadwork', ratio: 0.76, delayMin: 7, severity: 1, color: '#a855f7' }
  ]
};

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, expected] = parts;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return false;
  }
}

function isUsableEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const basic = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
  if (!basic) return false;
  const blocked = new Set(['example.com', 'test.com', 'localhost', 'local']);
  const domain = value.split('@')[1] || '';
  return !blocked.has(domain);
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 6 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

function normalizeRouteItem(item, index) {
  const name = String(item?.name || `Route ${index + 1}`).trim().slice(0, 80);
  const start = String(item?.start || '').trim().slice(0, 160);
  const end = String(item?.end || '').trim().slice(0, 160);
  if (!start || !end) return null;
  return { name: name || `Route ${index + 1}`, start, end };
}

function normalizeUserSettings(payload) {
  const companyLocation = String(payload?.companyLocation || '').trim().slice(0, 160);
  const homeLocation = String(payload?.homeLocation || '').trim().slice(0, 160);
  const commuteToWorkTime = String(payload?.commuteToWorkTime || '').trim().slice(0, 10);
  const commuteToHomeTime = String(payload?.commuteToHomeTime || '').trim().slice(0, 10);
  const routesRaw = Array.isArray(payload?.frequentRoutes) ? payload.frequentRoutes.slice(0, 3) : [];
  const frequentRoutes = routesRaw.map((r, i) => normalizeRouteItem(r, i)).filter(Boolean);
  return {
    companyLocation,
    homeLocation,
    commuteToWorkTime,
    commuteToHomeTime,
    frequentRoutes
  };
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function sendVerificationEmail(email, code, name) {
  const subject = 'FAST Email Verification Code';
  const text = `Hi ${name || 'User'}, your FAST verification code is ${code}. It will expire in ${SIGNUP_CODE_TTL_MIN} minutes.`;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.sendMail({
      from: SMTP_FROM,
      to: email,
      subject,
      text
    });
    return { delivered: true };
  }

  if (MAIL_DEV_MODE) {
    console.log(`[DEV MAIL] ${email} verification code: ${code}`);
    return { delivered: false, devCode: code };
  }

  throw new Error('SMTP not configured');
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role
  };
}

function trimText(value, maxLen = 255) {
  return String(value || '').trim().slice(0, maxLen);
}

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

function normalizeUserProfilePayload(payload) {
  const genderRaw = trimText(payload?.gender, 20);
  const allowedGender = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
  const gender = allowedGender.has(genderRaw.toLowerCase()) ? genderRaw.toLowerCase() : '';
  const birthday = trimText(payload?.birthday, 20);
  return {
    bio: trimText(payload?.bio, 1000),
    gender,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : '',
    region: trimText(payload?.region, 120),
    profession: trimText(payload?.profession, 120),
    school: trimText(payload?.school, 160)
  };
}

function requireSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase Auth is not fully configured');
  }
}

async function supabaseAuthRequest(pathname, { method = 'GET', body, accessToken = '', serviceRole = false } = {}) {
  requireSupabaseConfig();
  const url = `${SUPABASE_URL}/auth/v1${pathname}`;
  const apiKey = serviceRole ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const headers = {
    apikey: apiKey
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else if (serviceRole) headers.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

  const resp = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try {
    data = await resp.json();
  } catch (_) {}
  if (!resp.ok) {
    const message = data?.msg || data?.error_description || data?.error || `Supabase Auth error: ${resp.status}`;
    throw new Error(message);
  }
  return data;
}

async function supabasePasswordSignIn(email, password) {
  return supabaseAuthRequest('/token?grant_type=password', {
    method: 'POST',
    body: { email, password }
  });
}

async function supabaseGetUser(accessToken) {
  return supabaseAuthRequest('/user', { accessToken });
}

async function supabaseAdminCreateUser({ email, password, name, role = 'user' }) {
  return supabaseAuthRequest('/admin/users', {
    method: 'POST',
    serviceRole: true,
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    }
  });
}

async function supabaseAdminDeleteUser(userId) {
  return supabaseAuthRequest(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    serviceRole: true
  });
}

async function supabaseUserUpdate(accessToken, payload) {
  return supabaseAuthRequest('/user', {
    method: 'PUT',
    accessToken,
    body: payload
  });
}

async function ensureUserProfile(userId, email, name, role = 'user') {
  const safeRole = role === 'admin' ? 'admin' : 'user';
  const safeName = String(name || email || 'FAST User').trim().slice(0, 80) || 'FAST User';
  const result = await pool.query(
    `
    INSERT INTO app_user_profiles (user_id, email, name, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = COALESCE(NULLIF(app_user_profiles.name, ''), EXCLUDED.name),
      updated_at = EXCLUDED.updated_at
    RETURNING user_id AS id, email, name, role
    `,
    [userId, email, safeName, safeRole, nowIso(), nowIso()]
  );
  return result.rows[0];
}

async function getUserProfileById(userId) {
  const result = await pool.query(
    `
    SELECT
      user_id AS id,
      email,
      name,
      role,
      bio,
      gender,
      birthday,
      region,
      profession,
      school
    FROM app_user_profiles
    WHERE user_id = $1
    `,
    [userId]
  );
  return result.rows[0] || null;
}

async function getSupabaseAuthUserByEmail(email) {
  const result = await pool.query(
    `
    SELECT id, email, raw_user_meta_data, created_at
    FROM auth.users
    WHERE lower(email) = lower($1) AND deleted_at IS NULL
    LIMIT 1
    `,
    [email]
  );
  return result.rows[0] || null;
}

function pickProfileName(authUser, fallbackEmail) {
  return String(authUser?.raw_user_meta_data?.name || fallbackEmail || 'FAST User').trim().slice(0, 80) || 'FAST User';
}

async function initAuthDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_profiles (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','admin')),
      bio TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      birthday DATE,
      region TEXT NOT NULL DEFAULT '',
      profession TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_user_profiles_email
      ON app_user_profiles (lower(email));

    CREATE TABLE IF NOT EXISTS app_user_settings (
      user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      company_location TEXT NOT NULL DEFAULT '',
      home_location TEXT NOT NULL DEFAULT '',
      commute_to_work_time TEXT NOT NULL DEFAULT '',
      commute_to_home_time TEXT NOT NULL DEFAULT '',
      frequent_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_user_feedback_reports (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      comment TEXT NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_app_user_feedback_reports_created_at
      ON app_user_feedback_reports (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_app_user_feedback_reports_user_id
      ON app_user_feedback_reports (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signup_verifications (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_sent_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS habit_routes (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      route_name TEXT NOT NULL,
      from_label TEXT NOT NULL,
      to_label TEXT NOT NULL,
      coords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
      link_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      alert_start_time TEXT NOT NULL DEFAULT '07:30',
      alert_end_time TEXT NOT NULL DEFAULT '09:00'
    );

    CREATE INDEX IF NOT EXISTS idx_habit_routes_user_id
      ON habit_routes (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS saved_places (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      place_name TEXT NOT NULL,
      label TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traffic_alerts (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      route_id BIGINT NOT NULL REFERENCES habit_routes(id) ON DELETE CASCADE,
      affected_link_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      is_dismissed BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);

  await pool.query(`
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS birthday DATE;
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS profession TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS school TEXT NOT NULL DEFAULT '';
  `);

  await pool.query(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT(key) DO NOTHING
    `,
    ['simulation_config', JSON.stringify(DEFAULT_SIMULATION_CONFIG), nowIso()]
  );

  try {
    let adminAuthUser = await getSupabaseAuthUserByEmail('admin@fast.local');
    if (!adminAuthUser) {
      adminAuthUser = await supabaseAdminCreateUser({
        email: 'admin@fast.local',
        password: 'Admin12345!',
        name: 'FAST Admin',
        role: 'admin'
      });
    }
    if (adminAuthUser) {
      await ensureUserProfile(adminAuthUser.id, adminAuthUser.email, pickProfileName(adminAuthUser, adminAuthUser.email), 'admin');
    }
    let normalAuthUser = await getSupabaseAuthUserByEmail('user@fast.local');
    if (!normalAuthUser) {
      normalAuthUser = await supabaseAdminCreateUser({
        email: 'user@fast.local',
        password: 'User12345!',
        name: 'FAST User',
        role: 'user'
      });
    }
    if (normalAuthUser) {
      await ensureUserProfile(normalAuthUser.id, normalAuthUser.email, pickProfileName(normalAuthUser, normalAuthUser.email), 'user');
    }
  } catch (error) {
    console.warn(`Supabase auth profile bootstrap skipped: ${error.message}`);
  }
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Please log in first' });
    const authUser = await supabaseGetUser(token);
    if (!authUser?.id || !authUser?.email) return res.status(401).json({ error: 'Please log in first' });
    let profile = await getUserProfileById(authUser.id);
    if (!profile) {
      const role = String(authUser?.user_metadata?.role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
      profile = await ensureUserProfile(authUser.id, authUser.email, pickProfileName(authUser, authUser.email), role);
    }
    req.session = { token, user: toPublicUser(profile) };
    next();
  } catch (error) {
    console.error('Authentication failed:', error.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

async function getSimulationConfig() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, ['simulation_config']);
  const row = rows[0];
  if (!row) return DEFAULT_SIMULATION_CONFIG;
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.events)) return DEFAULT_SIMULATION_CONFIG;
    return parsed;
  } catch (_) {
    return DEFAULT_SIMULATION_CONFIG;
  }
}

function validateSimulationConfig(config) {
  if (!config || typeof config !== 'object') return 'Invalid config format';
  if (!Array.isArray(config.events)) return 'events must be an array';
  if (typeof config.enabled !== 'boolean') return 'enabled must be a boolean';
  if (config.events.length > 12) return 'maximum 12 events';
  for (const evt of config.events) {
    if (typeof evt !== 'object') return 'event item must be an object';
    if (typeof evt.label !== 'string' || !evt.label.trim()) return 'event.label is required';
    if (!Number.isFinite(Number(evt.ratio)) || Number(evt.ratio) <= 0 || Number(evt.ratio) >= 1) return 'event.ratio must be between 0 and 1';
    if (!Number.isFinite(Number(evt.delayMin)) || Number(evt.delayMin) < 1 || Number(evt.delayMin) > 60) return 'event.delayMin must be between 1 and 60';
    if (!Number.isFinite(Number(evt.severity)) || Number(evt.severity) < 1 || Number(evt.severity) > 3) return 'event.severity must be between 1 and 3';
  }
  return null;
}

function normalizeFeedbackPayload(payload) {
  const location = String(payload?.location || '').trim().slice(0, 200);
  const conditionType = String(payload?.conditionType || '').trim().toUpperCase().slice(0, 40);
  const severity = String(payload?.severity || '').trim().toUpperCase().slice(0, 20);
  const comment = String(payload?.comment || '').trim().slice(0, 1000);
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  return {
    location,
    conditionType,
    severity,
    comment,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null
  };
}

function validateFeedbackPayload(feedback) {
  if (!feedback.location) return 'Location is required';
  if (!feedback.comment) return 'Comment is required';
  const allowedTypes = new Set(['CONGESTION', 'ACCIDENT', 'ROAD WORK', 'CLEAR']);
  if (!allowedTypes.has(feedback.conditionType)) return 'Invalid condition type';
  const allowedSeverities = new Set(['LOW', 'MEDIUM', 'HIGH']);
  if (!allowedSeverities.has(feedback.severity)) return 'Invalid severity';
  return null;
}

function toPublicFeedbackRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    location: row.location,
    conditionType: row.condition_type,
    severity: row.severity,
    comment: row.comment,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    createdAt: row.created_at
  };
}

function normalizeHabitRouteCoords(input) {
  if (!Array.isArray(input)) return [];
  return input.map((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      const lat = Number(point[0]);
      const lon = Number(point[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
      return null;
    }
    if (point && typeof point === 'object') {
      const lat = Number(point.lat ?? point.latitude);
      const lon = Number(point.lon ?? point.lng ?? point.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    }
    return null;
  }).filter(Boolean);
}

function normalizeHabitRoutePayload(payload) {
  const coords = normalizeHabitRouteCoords(payload?.coords_json || payload?.coords);
  const routeName = String(payload?.route_name || '').trim().slice(0, 120);
  const fromLabel = String(payload?.from_label || payload?.from || '').trim().slice(0, 160);
  const toLabel = String(payload?.to_label || payload?.to || '').trim().slice(0, 160);
  const distanceM = Number(payload?.distance_m ?? payload?.distanceM ?? 0);
  const linkIdsRaw = Array.isArray(payload?.link_ids) ? payload.link_ids : [];
  const linkIds = linkIdsRaw.map((item) => String(item?.link_id || item || '').trim()).filter(Boolean).slice(0, 500);
  const alertEnabled = Boolean(payload?.alert_enabled);
  const alertStartTime = String(payload?.alert_start_time || '07:30').trim().slice(0, 5);
  const alertEndTime = String(payload?.alert_end_time || '09:00').trim().slice(0, 5);
  return {
    routeName: routeName || `${fromLabel || 'Start'} → ${toLabel || 'Destination'}`,
    fromLabel,
    toLabel,
    coords,
    distanceM: Number.isFinite(distanceM) ? distanceM : 0,
    linkIds,
    alertEnabled,
    alertStartTime,
    alertEndTime
  };
}

function validateHabitRoutePayload(payload) {
  if (!payload.fromLabel) return 'Start location is required';
  if (!payload.toLabel) return 'Destination is required';
  if (!Array.isArray(payload.coords) || payload.coords.length < 2) return 'Route coordinates are required';
  return null;
}

function validateHabitRouteTimes(startTime, endTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return 'Alert time window must use HH:MM format';
  }
  return null;
}

function toPublicHabitRouteRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    route_name: row.route_name,
    from_label: row.from_label,
    to_label: row.to_label,
    coords_json: Array.isArray(row.coords_json) ? row.coords_json : [],
    distance_m: Number(row.distance_m || 0),
    link_ids: Array.isArray(row.link_ids) ? row.link_ids : [],
    alert_enabled: Boolean(row.alert_enabled),
    alert_start_time: row.alert_start_time,
    alert_end_time: row.alert_end_time,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}

function parseTimeValue(timeText) {
  const match = String(timeText || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinAlertWindow(startTime, endTime, now = new Date()) {
  const start = parseTimeValue(startTime);
  const end = parseTimeValue(endTime);
  if (start === null || end === null) return true;
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function latLonToMeters(lat, lon, refLat, refLon) {
  const x = (lon - refLon) * 111320 * Math.cos(refLat * Math.PI / 180);
  const y = (lat - refLat) * 110540;
  return { x, y };
}

function pointToSegmentDistanceMeters(point, segA, segB) {
  const refLat = point[0];
  const refLon = point[1];
  const p = { x: 0, y: 0 };
  const a = latLonToMeters(segA[0], segA[1], refLat, refLon);
  const b = latLonToMeters(segB[0], segB[1], refLat, refLon);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-9) return Math.hypot(a.x, a.y);
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const projX = a.x + abx * t;
  const projY = a.y + aby * t;
  return Math.hypot(projX - p.x, projY - p.y);
}

function distancePointToPolylineMeters(point, coords) {
  if (!Array.isArray(coords) || coords.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const segA = coords[i];
    const segB = coords[i + 1];
    const d = pointToSegmentDistanceMeters(point, segA, segB);
    if (d < best) best = d;
  }
  return best;
}

function classifyHabitSegment(incidentDistanceM) {
  if (incidentDistanceM <= 180) return { predBand: 2, currentBand: '2', status: 'Heavy Congestion', color: '#ef4444' };
  if (incidentDistanceM <= 450) return { predBand: 4, currentBand: '4', status: 'Moderate Traffic', color: '#eab308' };
  return { predBand: 6, currentBand: '6', status: 'Free Flow', color: '#22c55e' };
}

function buildHabitRouteAnalysis(coords, incidents) {
  const safeCoords = normalizeHabitRouteCoords(coords);
  const safeIncidents = Array.isArray(incidents) ? incidents.filter((item) => Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lon))) : [];
  const segmentMatches = [];
  const matchedLinks = [];

  for (let i = 0; i < safeCoords.length - 1; i += 1) {
    const segA = safeCoords[i];
    const segB = safeCoords[i + 1];
    let nearestIncident = null;
    let nearestDistance = Infinity;
    for (const incident of safeIncidents) {
      const d = pointToSegmentDistanceMeters([Number(incident.lat), Number(incident.lon)], segA, segB);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIncident = incident;
      }
    }

    const segmentId = `habit-seg-${i + 1}`;
    const traffic = classifyHabitSegment(nearestDistance);
    const roadName = nearestIncident && nearestDistance <= 600
      ? `Near ${deriveIncidentArea(nearestIncident.message, nearestIncident.lat, nearestIncident.lon)}`
      : `Route segment ${i + 1}`;

    const segmentMatch = {
      segment_index: i,
      link_id: segmentId,
      road_name: roadName,
      distance_m: Number.isFinite(nearestDistance) ? Math.round(nearestDistance) : null,
      incident_id: nearestIncident?.id || null,
      current_band: traffic.currentBand,
      pred_band: traffic.predBand,
      traffic_status: traffic.status,
      color: traffic.color
    };
    segmentMatches.push(segmentMatch);
    matchedLinks.push({ link_id: segmentId, road_name: roadName });
  }

  return {
    coords: safeCoords,
    match_info: {
      matched_links: matchedLinks,
      segment_matches: segmentMatches
    }
  };
}


// data.gov.sg 交通摄像头接口（无需密钥，公开可用）
const TRAFFIC_IMAGES_API = 'https://api.data.gov.sg/v1/transport/traffic-images';
const TRAFFIC_INCIDENTS_API = 'https://api.data.gov.sg/v1/transport/traffic-incidents';
const LTA_TRAFFIC_INCIDENTS_API = 'https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents';
const OPENWEATHER_CURRENT_API = 'https://api.openweathermap.org/data/2.5/weather';
const OPENWEATHER_FORECAST_API = 'https://api.openweathermap.org/data/2.5/forecast';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
const LTA_SIGNAL_GEOJSON_PATH = path.join(__dirname, 'data', 'LTATrafficSignalAspectGEOJSON.geojson');
const INCIDENT_MOCK_PATH = path.join(__dirname, 'data', 'incident_api_mock.json');
const LOCAL_ROAD_NETWORK_PATH = path.join(__dirname, 'data', 'sg-road-network-overpass.json');
const ERP_RATES_JSON_PATH = path.join(__dirname, 'data', 'erp_rates_2026-03-23.json');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const PY_ENGINE_PATH = path.join(__dirname, 'py', 'compute_engine.py');
const PY_ML_ENGINE_PATH = path.join(__dirname, 'py', 'ml_traffic_predictor.py');
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
const STATIC_SOURCE_TTL_MS = 60 * 60 * 1000;
const INCIDENT_SOURCE_TTL_MS = 2 * 60 * 1000;
const ONEMOTORING_SOURCE_TTL_MS = 10 * 60 * 1000;
const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || '';
const MAX_LTA_SIGNAL_POINTS = 2500;
const MAX_OSM_POINTS = 1200;
const MAX_SPF_POINTS = 600;
const sourceCache = new Map();
const ROAD_NETWORK_CACHE_TTL_MS = 30 * 60 * 1000;
const ROAD_NETWORK_STALE_TTL_MS = 6 * 60 * 60 * 1000;
const LOCAL_ROAD_NETWORK_TTL_MS = 12 * 60 * 60 * 1000;
const OVERPASS_FETCH_TIMEOUT_MS = 12000;
const rateLimitStore = new Map();
const realtimeCameraFallback = { time: 0, value: [] };
const incidentCameraMatchCache = new Map();
const mockIncidentRuntime = {
  step: 0,
  stateById: new Map()
};

function getClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, maxRequests, keySuffix = '' }) {
  return (req, res, next) => {
    const now = Date.now();
    if (rateLimitStore.size > 10000) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (!v || now > v.resetAt) rateLimitStore.delete(k);
      }
    }
    const key = `${getClientIp(req)}:${keySuffix || 'global'}`;
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    next();
  };
}

app.use((req, res, next) => {
  const start = Date.now();
  const reqId = crypto.randomBytes(6).toString('hex');
  req.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = req.session?.user?.id ? `u:${req.session.user.id}` : 'guest';
    console.log(`[REQ ${reqId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${duration}ms ip=${getClientIp(req)} ${userId}`);
  });
  next();
});

app.use('/api', createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: RATE_LIMIT_MAX, keySuffix: 'api' }));
app.use('/api/auth', createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: AUTH_RATE_LIMIT_MAX, keySuffix: 'auth' }));

async function issueSignupCode({ name, email, password }) {
  if (!name || !email || !password) {
    return { status: 400, body: { error: 'name/email/password are required' } };
  }
  if (!isUsableEmail(email)) {
    return { status: 400, body: { error: 'Please enter a valid usable email address (for future email notifications)' } };
  }
  if (!isStrongPassword(password)) {
    return { status: 400, body: { error: 'Password must be at least 6 chars and include uppercase, lowercase and number' } };
  }

  const existingAuthUser = await getSupabaseAuthUserByEmail(email);
  if (existingAuthUser) return { status: 409, body: { error: 'Email is already registered' } };

  const code = generateVerificationCode();
  const codeHash = hashVerificationCode(code);
  const passwordHash = hashPassword(password);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MIN * 60 * 1000).toISOString();

  await pool.query(
    `
    INSERT INTO signup_verifications (email, name, password_hash, code_hash, expires_at, attempts, last_sent_at, created_at)
    VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
    ON CONFLICT(email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      attempts = 0,
      last_sent_at = EXCLUDED.last_sent_at
    `,
    [email, name, passwordHash, codeHash, expiresAt, createdAt, createdAt]
  );

  const mailResult = await sendVerificationEmail(email, code, name);
  const body = { ok: true, message: 'Verification code sent, please check your email' };
  if (mailResult.devCode) body.devCode = mailResult.devCode;
  return { status: 200, body };
}

app.post('/api/auth/signup/request-code', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  try {
    const result = await issueSignupCode({ name, email, password });
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Failed to send verification code:', error.message);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

app.post('/api/auth/signup/verify-code', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!email || !code) {
    return res.status(400).json({ error: 'email/code are required' });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid verification code format, it must be 6 digits' });
  }
  try {
    const existingUser = await getSupabaseAuthUserByEmail(email);
    if (existingUser) return res.status(409).json({ error: 'Email already registered, delete the account before reusing this email for testing' });

    const verResult = await pool.query(
      `
      SELECT email, name, password_hash, code_hash, expires_at, attempts
      FROM signup_verifications
      WHERE email = $1
      `,
      [email]
    );
    const ver = verResult.rows[0];
    if (!ver) return res.status(400).json({ error: 'Please request a verification code first' });
    if (new Date(ver.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code expired, please resend' });
    }
    if (ver.attempts >= 8) {
      return res.status(429).json({ error: 'Too many code attempts, please resend' });
    }
    if (hashVerificationCode(code) !== ver.code_hash) {
      await pool.query(`UPDATE signup_verifications SET attempts = attempts + 1 WHERE email = $1`, [email]);
      return res.status(400).json({ error: 'Verification code is incorrect' });
    }

    const password = req.body?.password ? String(req.body.password || '').trim() : null;
    let plainPassword = password;
    if (!plainPassword || !verifyPassword(plainPassword, ver.password_hash)) {
      return res.status(400).json({ error: 'Original password is required to complete signup in the new auth system' });
    }

    const created = await supabaseAdminCreateUser({ email, password: plainPassword, name: ver.name, role: 'user' });
    await ensureUserProfile(created.id, email, ver.name, 'user');
    await pool.query(`DELETE FROM signup_verifications WHERE email = $1`, [email]);

    const signedIn = await supabasePasswordSignIn(email, plainPassword);
    res.json({
      token: signedIn.access_token,
      user: toPublicUser({
        id: created.id,
        email,
        name: ver.name,
        role: 'user'
      })
    });
  } catch (error) {
    console.error('Verification signup failed:', error.message);
    res.status(500).json({ error: 'Verification signup failed' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  res.status(410).json({ error: 'Please use /api/auth/signup/request-code and /api/auth/signup/verify-code to complete signup' });
});

app.post('/api/auth/signup/resend-code', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  try {
    const result = await issueSignupCode({ name, email, password });
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Failed to resend verification code:', error.message);
    res.status(500).json({ error: 'Failed to resend verification code' });
  }
});

app.delete('/api/auth/account', requireAuth, async (req, res) => {
  const password = String(req.body?.password || '').trim();
  if (!password) return res.status(400).json({ error: 'Enter current password to confirm account deletion' });
  try {
    await supabasePasswordSignIn(req.session.user.email, password);
    await supabaseAdminDeleteUser(req.session.user.id);
    await pool.query(`DELETE FROM app_user_profiles WHERE user_id = $1`, [req.session.user.id]);
    res.json({ ok: true, message: 'Account deleted.' });
  } catch (error) {
    console.error('Failed to delete account:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.get('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfileById(req.session.user.id);
    if (!user) return res.status(404).json({ error: 'User does not exist' });
    const settingsQ = await pool.query(
      `
      SELECT company_location, home_location, commute_to_work_time, commute_to_home_time, frequent_routes
      FROM app_user_settings
      WHERE user_id = $1
      `,
      [user.id]
    );
    const row = settingsQ.rows[0];
    const settings = row ? {
      companyLocation: row.company_location || '',
      homeLocation: row.home_location || '',
      commuteToWorkTime: row.commute_to_work_time || '',
      commuteToHomeTime: row.commute_to_home_time || '',
      frequentRoutes: Array.isArray(row.frequent_routes) ? row.frequent_routes.slice(0, 3) : []
    } : {
      companyLocation: '',
      homeLocation: '',
      commuteToWorkTime: '',
      commuteToHomeTime: '',
      frequentRoutes: []
    };
    res.json({ user: toPublicUser(user), settings });
  } catch (error) {
    console.error('Failed to load user settings:', error.message);
    res.status(500).json({ error: 'Failed to load user settings' });
  }
});

app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const user = await getUserProfileById(req.session.user.id);
    if (!user) return res.status(404).json({ error: 'User does not exist' });
    const profile = {
      bio: user.bio || '',
      gender: user.gender || '',
      birthday: user.birthday ? new Date(user.birthday).toISOString().slice(0, 10) : '',
      region: user.region || '',
      profession: user.profession || '',
      school: user.school || ''
    };
    res.json({ user: toPublicUser(user), profile });
  } catch (error) {
    console.error('Failed to load user profile:', error.message);
    res.status(500).json({ error: 'Failed to load user profile' });
  }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const profile = normalizeUserProfilePayload(req.body || {});
    const updated = await pool.query(
      `
      UPDATE app_user_profiles
      SET
        bio = $2,
        gender = $3,
        birthday = NULLIF($4, '')::date,
        region = $5,
        profession = $6,
        school = $7,
        updated_at = $8
      WHERE user_id = $1
      RETURNING
        user_id AS id,
        email,
        name,
        role,
        bio,
        gender,
        birthday,
        region,
        profession,
        school
      `,
      [
        req.session.user.id,
        profile.bio,
        profile.gender,
        profile.birthday,
        profile.region,
        profile.profession,
        profile.school,
        nowIso()
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
    res.json({
      ok: true,
      user: toPublicUser(updated.rows[0]),
      profile: {
        bio: updated.rows[0].bio || '',
        gender: updated.rows[0].gender || '',
        birthday: updated.rows[0].birthday ? new Date(updated.rows[0].birthday).toISOString().slice(0, 10) : '',
        region: updated.rows[0].region || '',
        profession: updated.rows[0].profession || '',
        school: updated.rows[0].school || ''
      }
    });
  } catch (error) {
    console.error('Failed to save user profile:', error.message);
    res.status(500).json({ error: 'Failed to save user profile' });
  }
});

app.put('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const settings = normalizeUserSettings(req.body || {});
    await pool.query(
      `
      INSERT INTO app_user_settings (
        user_id, company_location, home_location, commute_to_work_time, commute_to_home_time, frequent_routes, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT(user_id) DO UPDATE SET
        company_location = EXCLUDED.company_location,
        home_location = EXCLUDED.home_location,
        commute_to_work_time = EXCLUDED.commute_to_work_time,
        commute_to_home_time = EXCLUDED.commute_to_home_time,
        frequent_routes = EXCLUDED.frequent_routes,
        updated_at = EXCLUDED.updated_at
      `,
      [
        req.session.user.id,
        settings.companyLocation,
        settings.homeLocation,
        settings.commuteToWorkTime,
        settings.commuteToHomeTime,
        JSON.stringify(settings.frequentRoutes),
        nowIso()
      ]
    );
    const syncPlaces = async (label, placeName) => {
      const value = String(placeName || '').trim();
      await pool.query(`DELETE FROM saved_places WHERE user_id = $1 AND label = $2`, [req.session.user.id, label]);
      if (!value) {
        return;
      }
      await pool.query(
        `
        INSERT INTO saved_places (user_id, place_name, label, lat, lon, created_at)
        VALUES ($1, $2, $3, NULL, NULL, $4)
        `,
        [req.session.user.id, value, label, nowIso()]
      );
    };
    await syncPlaces('COMPANY', settings.companyLocation);
    await syncPlaces('HOME', settings.homeLocation);
    res.json({ ok: true, settings });
  } catch (error) {
    console.error('Failed to save user settings:', error.message);
    res.status(500).json({ error: 'Failed to save user settings' });
  }
});


app.put('/api/user/name', requireAuth, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Please enter a name' });
  if (name.length > 80) return res.status(400).json({ error: 'Name is too long (max 80 chars)' });
  try {
    const updated = await pool.query(
      `
      UPDATE app_user_profiles
      SET name = $1, updated_at = $3
      WHERE user_id = $2
      RETURNING user_id AS id, name, email, role
      `,
      [name, req.session.user.id, nowIso()]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
    await supabaseUserUpdate(req.session.token, { data: { name } });
    res.json({ ok: true, user: toPublicUser(updated.rows[0]) });
  } catch (error) {
    console.error('Failed to update name:', error.message);
    res.status(500).json({ error: 'Failed to update name' });
  }
});

app.put('/api/user/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '').trim();
  const newPassword = String(req.body?.newPassword || '').trim();
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Please enter current and new password' });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 6 chars and include uppercase, lowercase and number' });
  }
  try {
    await supabasePasswordSignIn(req.session.user.email, currentPassword);
    await supabaseUserUpdate(req.session.token, { password: newPassword });
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to change password:', error.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();
  if (!email || !password) return res.status(400).json({ error: 'email/password are required' });
  try {
    const signedIn = await supabasePasswordSignIn(email, password);
    const authUser = signedIn.user || await supabaseGetUser(signedIn.access_token);
    let profile = await getUserProfileById(authUser.id);
    if (!profile) {
      const role = String(authUser?.user_metadata?.role || '').trim().toLowerCase() === 'admin' ? 'admin' : (email === 'admin@fast.local' ? 'admin' : 'user');
      profile = await ensureUserProfile(authUser.id, authUser.email, pickProfileName(authUser, authUser.email), role);
    }
    res.json({ token: signedIn.access_token, user: toPublicUser(profile) });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  res.json({ ok: true });
});

app.get('/api/admin/simulation-config', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json({ config: await getSimulationConfig() });
  } catch (error) {
    console.error('Failed to load simulation config:', error.message);
    res.status(500).json({ error: 'Failed to load simulation config' });
  }
});

app.put('/api/admin/simulation-config', requireAuth, requireAdmin, async (req, res) => {
  const config = req.body;
  const error = validateSimulationConfig(config);
  if (error) return res.status(400).json({ error });
  try {
    await pool.query(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `,
      ['simulation_config', JSON.stringify(config), nowIso()]
    );
    res.json({ ok: true, config });
  } catch (e) {
    console.error('Failed to save simulation config:', e.message);
    res.status(500).json({ error: 'Failed to save simulation config' });
  }
});

app.get('/api/admin/users/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalQ = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_profiles`);
    const verifiedQ = await pool.query(`SELECT COUNT(*)::int AS verified FROM auth.users WHERE deleted_at IS NULL AND email_confirmed_at IS NOT NULL`);
    const adminQ = await pool.query(`SELECT COUNT(*)::int AS admins FROM app_user_profiles WHERE role = 'admin'`);
    const userQ = await pool.query(`SELECT COUNT(*)::int AS normal_users FROM app_user_profiles WHERE role = 'user'`);
    const activeSessionQ = await pool.query(`SELECT COUNT(*)::int AS active_sessions FROM auth.sessions`);
    const new7dQ = await pool.query(`SELECT COUNT(*)::int AS new_7d FROM app_user_profiles WHERE created_at >= NOW() - INTERVAL '7 days'`);

    res.json({
      totalUsers: totalQ.rows[0].total,
      verifiedUsers: verifiedQ.rows[0].verified,
      adminUsers: adminQ.rows[0].admins,
      normalUsers: userQ.rows[0].normal_users,
      activeSessions: activeSessionQ.rows[0].active_sessions,
      newUsers7d: new7dQ.rows[0].new_7d
    });
  } catch (error) {
    console.error('Failed to load user statistics:', error.message);
    res.status(500).json({ error: 'Failed to load user statistics' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10) || 100, 500));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  try {
    const rows = await pool.query(
      `
      SELECT
        p.user_id AS id,
        p.name,
        p.email,
        p.role,
        (u.email_confirmed_at IS NOT NULL) AS email_verified,
        p.created_at
      FROM app_user_profiles p
      LEFT JOIN auth.users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_profiles`);
    res.json({ total: total.rows[0].total, limit, offset, value: rows.rows });
  } catch (error) {
    console.error('Failed to load user list:', error.message);
    res.status(500).json({ error: 'Failed to load user list' });
  }
});

app.post('/api/feedback', requireAuth, async (req, res) => {
  const feedback = normalizeFeedbackPayload(req.body || {});
  const error = validateFeedbackPayload(feedback);
  if (error) return res.status(400).json({ error });
  try {
    const inserted = await pool.query(
      `
      INSERT INTO app_user_feedback_reports (
        user_id, location, condition_type, severity, comment, latitude, longitude, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        user_id,
        $9::text AS user_name,
        $10::text AS user_email,
        location,
        condition_type,
        severity,
        comment,
        latitude,
        longitude,
        created_at
      `,
      [
        req.session.user.id,
        feedback.location,
        feedback.conditionType,
        feedback.severity,
        feedback.comment,
        feedback.latitude,
        feedback.longitude,
        nowIso(),
        req.session.user.name,
        req.session.user.email
      ]
    );
    res.json({ ok: true, item: toPublicFeedbackRow(inserted.rows[0]) });
  } catch (error) {
    console.error('Failed to submit feedback:', error.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

app.get('/api/feedback/mine', requireAuth, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10) || 10, 20));
  try {
    const result = await pool.query(
      `
      SELECT
        f.id,
        f.user_id,
        u.name AS user_name,
        u.email AS user_email,
        f.location,
        f.condition_type,
        f.severity,
        f.comment,
        f.latitude,
        f.longitude,
        f.created_at
      FROM app_user_feedback_reports f
      JOIN app_user_profiles u ON u.user_id = f.user_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      LIMIT $2
      `,
      [req.session.user.id, limit]
    );
    res.json({ value: result.rows.map(toPublicFeedbackRow) });
  } catch (error) {
    console.error('Failed to load user feedback:', error.message);
    res.status(500).json({ error: 'Failed to load user feedback' });
  }
});

app.get('/api/admin/feedback', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '200', 10) || 200, 500));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  try {
    const rows = await pool.query(
      `
      SELECT
        f.id,
        f.user_id,
        u.name AS user_name,
        u.email AS user_email,
        f.location,
        f.condition_type,
        f.severity,
        f.comment,
        f.latitude,
        f.longitude,
        f.created_at
      FROM app_user_feedback_reports f
      JOIN app_user_profiles u ON u.user_id = f.user_id
      ORDER BY f.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM app_user_feedback_reports`);
    res.json({ total: total.rows[0].total, limit, offset, value: rows.rows.map(toPublicFeedbackRow) });
  } catch (error) {
    console.error('Failed to load admin feedback list:', error.message);
    res.status(500).json({ error: 'Failed to load admin feedback list' });
  }
});

app.get('/api/habit-routes', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM habit_routes
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.session.user.id]
    );
    res.json({ routes: result.rows.map(toPublicHabitRouteRow) });
  } catch (error) {
    console.error('Failed to load habit routes:', error.message);
    res.status(500).json({ error: 'Failed to load habit routes' });
  }
});

app.post('/api/habit-routes', requireAuth, async (req, res) => {
  const payload = normalizeHabitRoutePayload(req.body || {});
  const error = validateHabitRoutePayload(payload) || validateHabitRouteTimes(payload.alertStartTime, payload.alertEndTime);
  if (error) return res.status(400).json({ error });
  try {
    const inserted = await pool.query(
      `
      INSERT INTO habit_routes (
        user_id, route_name, from_label, to_label, coords_json, distance_m, link_ids,
        alert_enabled, alert_start_time, alert_end_time, created_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        req.session.user.id,
        payload.routeName,
        payload.fromLabel,
        payload.toLabel,
        JSON.stringify(payload.coords),
        payload.distanceM,
        JSON.stringify(payload.linkIds),
        payload.alertEnabled,
        payload.alertStartTime,
        payload.alertEndTime,
        nowIso()
      ]
    );
    res.json({ ok: true, route: toPublicHabitRouteRow(inserted.rows[0]) });
  } catch (error) {
    console.error('Failed to save habit route:', error.message);
    res.status(500).json({ error: 'Failed to save habit route' });
  }
});

app.patch('/api/habit-routes/:id', requireAuth, async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'Invalid route id' });
  const routeName = req.body?.route_name === undefined ? null : String(req.body.route_name || '').trim().slice(0, 120);
  const alertEnabled = req.body?.alert_enabled;
  const alertStartTime = req.body?.alert_start_time === undefined ? null : String(req.body.alert_start_time || '').trim().slice(0, 5);
  const alertEndTime = req.body?.alert_end_time === undefined ? null : String(req.body.alert_end_time || '').trim().slice(0, 5);
  if (routeName !== null && !routeName) return res.status(400).json({ error: 'Route name is required' });
  const timeError = (alertStartTime !== null || alertEndTime !== null)
    ? validateHabitRouteTimes(alertStartTime || '07:30', alertEndTime || '09:00')
    : null;
  if (timeError) return res.status(400).json({ error: timeError });

  try {
    const updated = await pool.query(
      `
      UPDATE habit_routes
      SET
        route_name = COALESCE($3, route_name),
        alert_enabled = COALESCE($4, alert_enabled),
        alert_start_time = COALESCE($5, alert_start_time),
        alert_end_time = COALESCE($6, alert_end_time)
      WHERE id = $1 AND user_id = $2
      RETURNING *
      `,
      [
        routeId,
        req.session.user.id,
        routeName,
        typeof alertEnabled === 'boolean' ? alertEnabled : null,
        alertStartTime,
        alertEndTime
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'Habit route not found' });
    res.json({ ok: true, route: toPublicHabitRouteRow(updated.rows[0]) });
  } catch (error) {
    console.error('Failed to update habit route:', error.message);
    res.status(500).json({ error: 'Failed to update habit route' });
  }
});

app.delete('/api/habit-routes/:id', requireAuth, async (req, res) => {
  const routeId = Number(req.params.id);
  if (!Number.isFinite(routeId)) return res.status(400).json({ error: 'Invalid route id' });
  try {
    const result = await pool.query(
      `DELETE FROM habit_routes WHERE id = $1 AND user_id = $2 RETURNING id`,
      [routeId, req.session.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Habit route not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete habit route:', error.message);
    res.status(500).json({ error: 'Failed to delete habit route' });
  }
});

app.post('/api/habit-routes/analyze', requireAuth, async (req, res) => {
  const coords = normalizeHabitRouteCoords(req.body?.coords_json || req.body?.coords);
  if (coords.length < 2) return res.status(400).json({ error: 'Route coordinates are required' });
  try {
    const incidents = await fetchTrafficIncidentsRaw();
    res.json(buildHabitRouteAnalysis(coords, incidents));
  } catch (error) {
    console.error('Failed to analyze habit route:', error.message);
    res.status(500).json({ error: 'Failed to analyze habit route' });
  }
});

app.get('/api/my-alerts', requireAuth, async (req, res) => {
  try {
    const [routesResult, incidents] = await Promise.all([
      pool.query(
        `
        SELECT *
        FROM habit_routes
        WHERE user_id = $1 AND alert_enabled = TRUE
        ORDER BY created_at DESC
        `,
        [req.session.user.id]
      ),
      fetchTrafficIncidentsRaw()
    ]);
    await pool.query(
      `
      UPDATE traffic_alerts
      SET is_dismissed = TRUE
      WHERE user_id = $1 AND expires_at <= NOW()
      `,
      [req.session.user.id]
    );

    const alerts = [];
    const now = new Date();
    for (const row of routesResult.rows) {
      const route = toPublicHabitRouteRow(row);
      if (!isWithinAlertWindow(route.alert_start_time, route.alert_end_time, now)) continue;
      for (const incident of incidents) {
        const distanceM = distancePointToPolylineMeters([Number(incident.lat), Number(incident.lon)], route.coords_json);
        if (!Number.isFinite(distanceM) || distanceM > 450) continue;
        const affectedLinkIds = Array.isArray(route.link_ids) ? route.link_ids.slice(0, 50) : [];
        const existing = await pool.query(
          `
          SELECT id, is_dismissed, created_at, expires_at
          FROM traffic_alerts
          WHERE user_id = $1
            AND route_id = $2
            AND affected_link_ids = $3::jsonb
            AND expires_at > NOW()
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [req.session.user.id, route.id, JSON.stringify(affectedLinkIds)]
        );
        let alertId = existing.rows[0]?.id || null;
        let dismissed = Boolean(existing.rows[0]?.is_dismissed);
        if (!alertId) {
          const inserted = await pool.query(
            `
            INSERT INTO traffic_alerts (user_id, route_id, affected_link_ids, created_at, expires_at, is_dismissed)
            VALUES ($1, $2, $3::jsonb, $4, $5, FALSE)
            RETURNING id
            `,
            [req.session.user.id, route.id, JSON.stringify(affectedLinkIds), nowIso(), new Date(Date.now() + 15 * 60 * 1000).toISOString()]
          );
          alertId = inserted.rows[0]?.id || null;
        }
        if (dismissed) continue;
        alerts.push({
          id: alertId,
          route_id: route.id,
          route_name: route.route_name,
          incident_id: incident.id,
          message: incident.message,
          area: deriveIncidentArea(incident.message, incident.lat, incident.lon),
          distance_m: Math.round(distanceM),
          created_at: incident.createdAt
        });
      }
    }

    alerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(alerts);
  } catch (error) {
    console.error('Failed to load route alerts:', error.message);
    res.status(500).json({ error: 'Failed to load route alerts' });
  }
});

app.post('/api/my-alerts/dismiss', requireAuth, async (req, res) => {
  const routeId = Number(req.body?.routeId);
  const alertId = Number(req.body?.alertId);
  if (!Number.isFinite(routeId) || !Number.isFinite(alertId)) return res.status(400).json({ error: 'routeId and alertId are required' });
  try {
    const routeCheck = await pool.query(
      `SELECT id FROM habit_routes WHERE id = $1 AND user_id = $2`,
      [routeId, req.session.user.id]
    );
    if (!routeCheck.rows[0]) return res.status(404).json({ error: 'Habit route not found' });

    await pool.query(
      `
      UPDATE traffic_alerts
      SET is_dismissed = TRUE, expires_at = GREATEST(expires_at, $4)
      WHERE id = $1 AND user_id = $2 AND route_id = $3
      `,
      [alertId, req.session.user.id, routeId, nowIso()]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to dismiss route alert:', error.message);
    res.status(500).json({ error: 'Failed to dismiss route alert' });
  }
});

async function withCache(key, ttlMs, loader) {
  const now = Date.now();
  const cached = sourceCache.get(key);
  if (cached && now - cached.time < ttlMs) return cached.value;
  const value = await loader();
  sourceCache.set(key, { time: now, value });
  return value;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
}

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bcar\s*park\b/g, ' ')
    .replace(/\bshopping\s*centre\b/g, ' ')
    .replace(/\bshopping\s*center\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\bp\d+\b/g, ' ')
    .replace(/\brws\b/g, ' resorts world sentosa ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTextCached(url, ttlMs = ONEMOTORING_SOURCE_TTL_MS) {
  return withCache(`text:${url}`, ttlMs, async () => {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FAST/1.0 (OneMotoring integration)' }
    });
    if (!resp.ok) throw new Error(`Failed to fetch source: ${resp.status}`);
    return resp.text();
  });
}

function parsePlacemarkBlocks(kmlText) {
  return Array.from(String(kmlText || '').matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi)).map((m) => m[1]);
}

function parseErpKml(kmlText) {
  return parsePlacemarkBlocks(kmlText).map((block, index) => {
    const nameMatch = block.match(/<td>([^<]+)<\/td>/i);
    const coordMatch = block.match(/<coordinates>\s*([0-9.\-]+),([0-9.\-]+),0\s*<\/coordinates>/i);
    const ddlMatch = block.match(/iframe\s+src="([^"]+_ddl\.html)"/i);
    if (!nameMatch || !coordMatch) return null;
    const ddlUrl = ddlMatch
      ? `https:${ddlMatch[1].startsWith('//') ? ddlMatch[1] : `//${ddlMatch[1].replace(/^https?:\/\//i, '')}`}`
      : '';
    return {
      id: `erp-${index + 1}`,
      name: decodeHtmlEntities(nameMatch[1]),
      lat: parseFloat(coordMatch[2]),
      lon: parseFloat(coordMatch[1]),
      ddlUrl
    };
  }).filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

function parsePgsKml(kmlText) {
  return parsePlacemarkBlocks(kmlText).map((block, index) => {
    const nameMatch = block.match(/<b>([^<]+)<\/b>/i);
    const coordMatch = block.match(/<coordinates>\s*([0-9.\-]+),([0-9.\-]+),0\s*<\/coordinates>/i);
    const imageMatch = block.match(/<img[^>]+src="([^"]+Parking\/[^"]+)"/i);
    const availabilityTimeMatch = block.match(/Parking Lots Availability is correct as at\s*([^<\n]+)/i);
    const availabilityCountMatch = block.match(/font-size:31px;font-weight:bold;'>([^<]+)<\/span>/i);
    if (!nameMatch || !coordMatch) return null;
    const imageUrl = imageMatch
      ? `https:${imageMatch[1].startsWith('//') ? imageMatch[1] : `//${imageMatch[1].replace(/^https?:\/\//i, '')}`}`
      : '';
    return {
      id: `pgs-${index + 1}`,
      name: decodeHtmlEntities(nameMatch[1]),
      lat: parseFloat(coordMatch[2]),
      lon: parseFloat(coordMatch[1]),
      imageUrl,
      availability: decodeHtmlEntities(availabilityCountMatch?.[1] || ''),
      availabilityUpdatedAt: decodeHtmlEntities(availabilityTimeMatch?.[1] || '')
    };
  }).filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

function parseParkingRatesPage(html, sourceUrl) {
  const rows = [];
  const rowMatches = Array.from(String(html || '').matchAll(/<tr>([\s\S]*?)<\/tr>/gi));
  rowMatches.forEach((rowMatch) => {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*data-label="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi))
      .map((m) => ({
        label: decodeHtmlEntities(m[1]),
        value: stripHtml(m[2])
      }));
    if (cells.length < 5) return;
    const row = Object.fromEntries(cells.map((c) => [c.label, c.value]));
    const carPark = row['Car Park'];
    if (!carPark) return;
    rows.push({
      name: carPark,
      normalizedName: normalizeLookupName(carPark),
      weekdayBefore: row['Weekdays before 5/6pm'] || '',
      weekdayAfter: row['Weekdays after 5/6pm'] || '',
      saturday: row['Saturdays'] || '',
      sunday: row['Sundays/Public Holidays'] || '',
      sourceUrl
    });
  });
  return rows;
}

function findBestParkingRateMatch(name, rows) {
  const target = normalizeLookupName(name);
  if (!target) return null;
  const exact = rows.find((row) => row.normalizedName === target);
  if (exact) return exact;
  const contains = rows.find((row) => row.normalizedName.includes(target) || target.includes(row.normalizedName));
  if (contains) return contains;
  const targetTokens = target.split(' ').filter(Boolean);
  let best = null;
  let bestScore = 0;
  rows.forEach((row) => {
    const rowTokens = row.normalizedName.split(' ').filter(Boolean);
    const overlap = targetTokens.filter((token) => rowTokens.includes(token)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = row;
    }
  });
  return bestScore >= 2 ? best : null;
}

async function fetchParkingRatesLookup() {
  const pages = await Promise.all(
    ONEMOTORING_PARKING_RATE_PAGE_URLS.map(async (url) => parseParkingRatesPage(await fetchTextCached(url), url))
  );
  return pages.flat();
}

async function fetchLocalErpRates() {
  return withCache(`json:${ERP_RATES_JSON_PATH}`, ONEMOTORING_SOURCE_TTL_MS, async () => {
    const raw = await fs.readFile(ERP_RATES_JSON_PATH, 'utf8');
    return JSON.parse(raw);
  });
}

function roundRoadCacheCoord(value) {
  return Number(toNumber(value).toFixed(3));
}

function makeRoadNetworkCacheKey(s, w, n, e) {
  return [
    'road-network',
    roundRoadCacheCoord(s),
    roundRoadCacheCoord(w),
    roundRoadCacheCoord(n),
    roundRoadCacheCoord(e)
  ].join(':');
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildRoutePlanFriendlyError(error) {
  const raw = String(error?.message || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('overpass')
    || lower.includes('road network')
    || lower.includes('timed out')
    || lower.includes('aborterror')
    || /\b504\b/.test(raw)
    || /\b502\b/.test(raw)
    || /\b503\b/.test(raw)
  ) {
    return {
      status: 503,
      error: 'Route planning temporarily unavailable',
      details: 'Road network service timed out while preparing the route. Please retry in 30-60 seconds or choose a shorter route.',
      retryable: true
    };
  }
  return {
    status: 500,
    error: 'Python route planning failed',
    details: raw || 'Unknown route planning error',
    retryable: false
  };
}

function pointWithinBbox(lat, lon, s, w, n, e) {
  return lat >= s && lat <= n && lon >= w && lon <= e;
}

function subsetRoadNetworkByBbox(roads, s, w, n, e, marginDeg = 0.004) {
  const elements = Array.isArray(roads?.elements) ? roads.elements : [];
  const s2 = s - marginDeg;
  const w2 = w - marginDeg;
  const n2 = n + marginDeg;
  const e2 = e + marginDeg;
  const filtered = elements.filter((el) => {
    const geom = Array.isArray(el?.geometry) ? el.geometry : [];
    if (!geom.length) return false;
    return geom.some((p) => pointWithinBbox(Number(p?.lat), Number(p?.lon), s2, w2, n2, e2));
  });
  if (!filtered.length) return null;
  return { version: roads?.version, generator: roads?.generator, osm3s: roads?.osm3s, elements: filtered };
}

async function loadLocalRoadNetworkSnapshot() {
  return withCache('local-road-network-sg', LOCAL_ROAD_NETWORK_TTL_MS, async () => {
    const raw = await fs.readFile(LOCAL_ROAD_NETWORK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.elements) || !parsed.elements.length) {
      throw new Error('Local road network snapshot is empty');
    }
    return parsed;
  });
}

function downsample(items, maxCount) {
  if (!Array.isArray(items) || items.length <= maxCount) return items;
  const sampled = [];
  const step = items.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    sampled.push(items[Math.floor(i * step)]);
  }
  return sampled;
}

async function callGeminiText(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  const resp = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  if (!resp.ok) {
    throw new Error(`Gemini API error: ${resp.status}`);
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function decodeHtmlLite(text = '') {
  return String(text || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml) {
  const items = [];
  const itemBlocks = String(xml || '').match(/<item[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
    if (!title || !link) continue;
    items.push({
      title: decodeHtmlLite(title).trim(),
      link: decodeHtmlLite(link).trim(),
      publishedAt: new Date(pubDate || nowIso()).toISOString()
    });
  }
  return items;
}

async function fetchRss(url) {
  const resp = await fetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!resp.ok) throw new Error(`RSS fetch failed: ${resp.status}`);
  const xml = await resp.text();
  return parseRssItems(xml);
}

async function fetchTrafficImageCameras() {
  const cameras = await withCache('data-gov-traffic-images', 45 * 1000, async () => {
    const response = await fetch(TRAFFIC_IMAGES_API);
    if (!response.ok) {
      throw new Error(`data.gov.sg API error: ${response.status}`);
    }
    const data = await response.json();
    return (data.items || [])
      .flatMap(item => (item.cameras || []).map(cam => ({
        CameraID: `dgov-${cam.camera_id}`,
        Latitude: cam.location?.latitude,
        Longitude: cam.location?.longitude,
        ImageLink: cam.image,
        Name: `LTA Traffic Camera ${cam.camera_id}`,
        Source: 'data.gov.sg Traffic Images',
        HasRealtimeImage: true
      })));
  });
  realtimeCameraFallback.time = Date.now();
  realtimeCameraFallback.value = Array.isArray(cameras) ? cameras : [];
  return cameras;
}

function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function deriveIncidentArea(message, lat, lon) {
  const msg = String(message || '').trim();
  if (msg) {
    const parts = msg.split(/ - |,|;/).map(s => s.trim()).filter(Boolean);
    if (parts[0]) return parts[0];
  }
  return `(${lat?.toFixed?.(4) || lat}, ${lon?.toFixed?.(4) || lon})`;
}

function toNumOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inferImpactByType(type, message = '') {
  const t = `${type || ''} ${message || ''}`.toLowerCase();
  if (/(accident|collision|crash|fire|fatal)/.test(t)) {
    return { spreadRadiusKm: 2.2, minMin: 50, maxMin: 110 };
  }
  if (/(roadwork|construction|road works|works)/.test(t)) {
    return { spreadRadiusKm: 1.5, minMin: 45, maxMin: 95 };
  }
  if (/(breakdown|stalled|vehicle breakdown)/.test(t)) {
    return { spreadRadiusKm: 1.2, minMin: 25, maxMin: 60 };
  }
  if (/(heavy traffic|congestion|jam)/.test(t)) {
    return { spreadRadiusKm: 1.0, minMin: 20, maxMin: 45 };
  }
  return { spreadRadiusKm: 0.9, minMin: 15, maxMin: 35 };
}

function buildIncidentImpactMeta(raw) {
  const inferred = inferImpactByType(raw?.type, raw?.message);
  const ltaMin = toNumOrNull(raw?.estimatedImpactMin ?? raw?.estimated_impact_min ?? raw?.impactMin ?? raw?.impact_min);
  const ltaMax = toNumOrNull(raw?.estimatedImpactMax ?? raw?.estimated_impact_max ?? raw?.impactMax ?? raw?.impact_max);
  const radius = toNumOrNull(raw?.spreadRadiusKm ?? raw?.spread_radius_km ?? raw?.radiusKm ?? raw?.radius_km);

  let minMin = ltaMin ?? inferred.minMin;
  let maxMin = ltaMax ?? inferred.maxMin;
  if (maxMin < minMin) {
    const tmp = minMin;
    minMin = maxMin;
    maxMin = tmp;
  }
  return {
    spreadRadiusKm: Number((radius ?? inferred.spreadRadiusKm).toFixed(1)),
    estimatedDurationMin: Math.max(1, Math.round(minMin)),
    estimatedDurationMax: Math.max(Math.round(minMin), Math.round(maxMin))
  };
}

function getImpactFromIncidentRow(row) {
  return buildIncidentImpactMeta({
    type: row.Type || row.type,
    message: row.Message || row.message,
    estimated_impact_min: row.estimated_impact_min,
    estimated_impact_max: row.estimated_impact_max
  });
}

function buildMockIncidentRecord(row, now, overrides = {}) {
  const impact = getImpactFromIncidentRow(row);
  return {
    id: String(row.incident_id || row.id || '').trim(),
    type: row.Type || row.type || 'Incident',
    message: row.Message || row.message || 'Mock incident',
    lat: toNumber(row.Latitude ?? row.lat),
    lon: toNumber(row.Longitude ?? row.lon),
    createdAt: now,
    riskLevel: row.risk_level || 'Medium',
    lifecycleState: overrides.lifecycleState || 'Active',
    source: 'mock',
    estimatedDurationMin: impact.estimatedDurationMin,
    estimatedDurationMax: impact.estimatedDurationMax,
    spreadRadiusKm: impact.spreadRadiusKm,
    notes: overrides.notes ?? (row.notes || '')
  };
}

async function normalizeIncidentListLocal(list, prefix, defaultCreatedAt = nowIso()) {
  return (list || [])
    .map((x, idx) => {
      const message = x.Message || x.message || x.Description || x.Type || '';
      const lat = toNumber(x.Latitude ?? x.latitude ?? x.Lat);
      const lon = toNumber(x.Longitude ?? x.longitude ?? x.Lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const impact = buildIncidentImpactMeta({
        type: x.Type || x.type,
        message,
        estimated_impact_min: x.estimated_impact_min ?? x.EstimatedImpactMin,
        estimated_impact_max: x.estimated_impact_max ?? x.EstimatedImpactMax,
        spread_radius_km: x.spread_radius_km ?? x.SpreadRadiusKm
      });
      return {
        id: x.IncidentID || x.id || `${prefix}-incident-${idx + 1}`,
        message,
        type: x.Type || x.type || 'Incident',
        lat,
        lon,
        createdAt: x.CreatedAt || x.Created || x.updated_at || defaultCreatedAt,
        estimatedDurationMin: impact.estimatedDurationMin,
        estimatedDurationMax: impact.estimatedDurationMax,
        spreadRadiusKm: impact.spreadRadiusKm
      };
    })
    .filter(Boolean);
}

async function normalizeIncidentList(list, prefix) {
  try {
    const payload = {
      list: Array.isArray(list) ? list : [],
      prefix,
      defaultCreatedAt: nowIso()
    };
    const result = await callFastApiJson('/compute/normalize-incidents', payload, 10000);
    if (Array.isArray(result?.value)) return result.value;
    throw new Error('FastAPI normalize_incidents returned invalid format');
  } catch (err) {
    try {
      const result = await runPythonCompute('normalize_incidents', {
        list: Array.isArray(list) ? list : [],
        prefix,
        defaultCreatedAt: nowIso()
      }, 10000);
      if (Array.isArray(result?.value)) return result.value;
      throw new Error('Python normalize_incidents returned invalid format');
    } catch (fallbackErr) {
      console.warn(`FastAPI incident normalization fell back to Node.js: ${err.message}; python fallback: ${fallbackErr.message}`);
      return normalizeIncidentListLocal(list, prefix);
    }
  }
}

async function loadMockIncidentSpecs() {
  return withCache('incident-mock-specs', 60 * 1000, async () => {
    const raw = await fs.readFile(INCIDENT_MOCK_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const value = Array.isArray(parsed?.value) ? parsed.value : [];
    const absentPolls = Math.max(1, parseInt(parsed?.resolution_absent_polls || '2', 10) || 2);
    return { value, absentPolls };
  });
}

async function fetchMockIncidentsWithResolution() {
  const spec = await loadMockIncidentSpecs();
  const step = mockIncidentRuntime.step++;
  const now = nowIso();
  const active = [];
  let resolvedNow = 0;
  let clearingNow = 0;

  for (const row of spec.value) {
    const id = String(row.incident_id || row.id || '').trim();
    if (!id) continue;
    const presentUntil = Number.isFinite(Number(row.present_until_step)) ? Number(row.present_until_step) : -1;
    const alwaysPresent = presentUntil < 0;
    const presentNow = alwaysPresent || step <= presentUntil;
    const prev = mockIncidentRuntime.stateById.get(id) || { absentStreak: 0, resolved: false, seenCount: 0 };

    let next = { ...prev };
    if (presentNow) {
      next.absentStreak = 0;
      next.resolved = false;
      next.seenCount = (next.seenCount || 0) + 1;
      next.lastSeenAt = now;
      const nearEnd = !alwaysPresent && step >= Math.max(0, presentUntil - 1);
      const lifecycleState = nearEnd ? 'Clearing' : 'Active';
      if (lifecycleState === 'Clearing') clearingNow += 1;
      active.push(buildMockIncidentRecord(row, now, { lifecycleState }));
    } else {
      next.absentStreak = (next.absentStreak || 0) + 1;
      if (next.absentStreak >= spec.absentPolls) {
        if (!next.resolved) resolvedNow += 1;
        next.resolved = true;
        next.resolvedAt = now;
      } else if (!next.resolved) {
        clearingNow += 1;
        active.push({
          ...buildMockIncidentRecord(row, now, {
            lifecycleState: 'Clearing',
            notes: `${row.notes || ''}; missing ${next.absentStreak}/${spec.absentPolls}`
          }),
          message: `[Clearing check] ${row.Message || row.message || 'Mock incident'}`
        });
      }
    }
    mockIncidentRuntime.stateById.set(id, next);
  }

  return {
    value: active,
    meta: {
      source: 'mock',
      pollStep: step,
      resolutionAbsentPolls: spec.absentPolls,
      activeCount: active.length,
      clearingCount: clearingNow,
      resolvedCount: resolvedNow,
      generatedAt: now
    }
  };
}

async function fetchTrafficIncidentsRaw() {
  /**
   * 实时事故数据拉取与标准化入口
   *
   * 数据源优先级：
   * 1) LTA DataMall（若配置了 LTA_ACCOUNT_KEY 且返回可用）
   * 2) data.gov.sg 公开事故接口
   *
   * 标准化策略：
   * - 优先调用 Python op: normalize_incidents 统一字段和影响范围
   * - Python 异常时回退 parseListLocal（Node 本地实现）
   *
   * 缓存策略：
   * - 通过 withCache 控制拉取频率，避免过于频繁访问上游接口
   */
  return withCache('data-gov-traffic-incidents', INCIDENT_SOURCE_TTL_MS, async () => {
    if (LTA_ACCOUNT_KEY) {
      try {
        const ltaResp = await fetch(LTA_TRAFFIC_INCIDENTS_API, {
          headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' }
        });
        if (ltaResp.ok) {
          const ltaData = await ltaResp.json();
          const ltaIncidents = await normalizeIncidentList(ltaData?.value, 'lta');
          if (ltaIncidents.length > 0) return ltaIncidents;
        }
      } catch (_) {}
    }

    const response = await fetch(TRAFFIC_INCIDENTS_API);
    if (!response.ok) throw new Error(`data.gov.sg incidents API error: ${response.status}`);
    const data = await response.json();
    return normalizeIncidentList((data.value || data.items || data || []), 'dgov');
  });
}

async function runPythonCompute(op, payload, timeoutMs = 12000) {
  /**
   * 统一 Python 子进程调用器
   *
   * 职责：
   * - 负责把 payload 通过 stdin 传入 Python
   * - 收集 stdout/stderr 并解析 JSON
   * - 对超时、启动失败、非 0 退出码做统一错误包装
   *
   * 为什么统一：
   * - 路由规划、事故标准化、事件评估都复用这一套调用协议
   * - 便于后续替换为 HTTP 微服务时集中改造
   */
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PY_ENGINE_PATH, '--op', op], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Python compute timeout: ${op}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Python startup failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Python compute failed(code=${code}): ${stderr.trim() || 'unknown error'}`));
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(`Python output parse failed: ${parseErr.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

async function runPythonJsonScript(scriptPath, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Python script timeout: ${path.basename(scriptPath)}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Python startup failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Python script failed(code=${code}): ${stderr.trim() || 'unknown error'}`));
      }
      try {
        resolve(JSON.parse(stdout || '{}'));
      } catch (parseErr) {
        reject(new Error(`Python output parse failed: ${parseErr.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

async function callFastApiJson(pathname, payload, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${FASTAPI_BASE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: payload || {} }),
      signal: controller.signal
    });
    let data = {};
    try {
      data = await resp.json();
    } catch (_) {}
    if (!resp.ok) {
      throw new Error(data?.detail || data?.error || `FastAPI error: ${resp.status}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`FastAPI timeout: ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toPythonRealtimeCameras(cameras) {
  return (cameras || []).map((cam) => ({
    CameraID: cam.CameraID,
    Latitude: toNumber(cam.Latitude),
    Longitude: toNumber(cam.Longitude),
    ImageLink: cam.ImageLink || null,
    Name: cam.Name || null
  }));
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stableIncidentMatchKey(inc) {
  const lat = Number(inc?.lat);
  const lon = Number(inc?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${Math.round(lat * 10000)}:${Math.round(lon * 10000)}`;
}

function cameraCoord(cam) {
  return {
    lat: parseFloat(cam?.Latitude),
    lon: parseFloat(cam?.Longitude)
  };
}

function safeNearestRealtimeCamera(inc, cameras) {
  const incLat = Number(inc?.lat);
  const incLon = Number(inc?.lon);
  if (!Number.isFinite(incLat) || !Number.isFinite(incLon)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const cam of cameras || []) {
    const c = cameraCoord(cam);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const d = distanceMeters(incLat, incLon, c.lat, c.lon);
    if (!Number.isFinite(d)) continue;
    if (d < bestDist) {
      bestDist = d;
      best = cam;
    }
  }
  if (!best || bestDist > 2000) return null;
  return { ...best, dist: bestDist };
}

function attachNearestRealtimeCameraLocal(incidents, cameras) {
  const normalizedCameras = Array.isArray(cameras) ? cameras : [];
  const now = Date.now();
  const staleMs = 5 * 60 * 1000;
  return incidents.map((inc) => {
    const key = stableIncidentMatchKey(inc);
    const cached = key ? incidentCameraMatchCache.get(key) : null;
    let nearest = safeNearestRealtimeCamera(inc, normalizedCameras);
    if (!nearest && cached && (now - cached.time) <= staleMs) {
      nearest = cached.camera;
    }
    if (key && nearest) {
      incidentCameraMatchCache.set(key, { time: now, camera: nearest });
    }

    const impact = buildIncidentImpactMeta(inc);
    return {
      id: inc.id,
      type: inc.type,
      message: inc.message,
      area: deriveIncidentArea(inc.message, inc.lat, inc.lon),
      lat: inc.lat,
      lon: inc.lon,
      createdAt: inc.createdAt,
      spreadRadiusKm: inc.spreadRadiusKm ?? impact.spreadRadiusKm,
      estimatedDurationMin: inc.estimatedDurationMin ?? impact.estimatedDurationMin,
      estimatedDurationMax: inc.estimatedDurationMax ?? impact.estimatedDurationMax,
      imageLink: nearest?.ImageLink || null,
      cameraName: nearest?.Name || null,
      cameraDistanceMeters: nearest?.dist ? Math.round(nearest.dist) : null
    };
  });
}

async function attachNearestRealtimeCamera(incidents, cameras) {
  /**
   * 事故点 -> 最近实时摄像头匹配
   *
   * 当前策略：
   * - 优先 Python enrich_incidents_with_cameras（同一路径下复用统一规则）
   * - Python 不可用时回退 Node 本地匹配（attachNearestRealtimeCameraLocal）
   *
   * 这样可以保证：
   * - 线上稳定性（Python 挂了也不至于整个接口不可用）
   * - 逻辑一致性（正常情况下都以 Python 规则为准）
   */
  try {
    const payload = {
      incidents: Array.isArray(incidents) ? incidents : [],
      cameras: toPythonRealtimeCameras(cameras)
    };
    const result = await callFastApiJson('/compute/enrich-incidents-with-cameras', payload, 10000);
    if (Array.isArray(result?.value)) return result.value;
    throw new Error('FastAPI returned invalid data format');
  } catch (err) {
    try {
      const payload = {
        incidents: Array.isArray(incidents) ? incidents : [],
        cameras: toPythonRealtimeCameras(cameras)
      };
      const result = await runPythonCompute('enrich_incidents_with_cameras', payload, 10000);
      if (Array.isArray(result?.value)) return result.value;
      throw new Error('Python returned invalid data format');
    } catch (fallbackErr) {
      console.warn(`FastAPI incident matching fell back to Node.js: ${err.message}; python fallback: ${fallbackErr.message}`);
      return attachNearestRealtimeCameraLocal(incidents, cameras);
    }
  }
}

async function loadLtaSignalGeoJsonCameras() {
  return withCache('lta-signal-geojson', STATIC_SOURCE_TTL_MS, async () => {
    const content = await fs.readFile(LTA_SIGNAL_GEOJSON_PATH, 'utf-8');
    const geo = JSON.parse(content);
    const features = downsample((geo.features || []), MAX_LTA_SIGNAL_POINTS);
    return features
      .filter(f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates))
      .map((f, idx) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const uniq = p.UNIQUE_ID ?? p.OBJECTID_1 ?? idx;
        return {
          CameraID: `lta-signal-${uniq}`,
          Latitude: lat,
          Longitude: lon,
          Name: p.TYP_NAM ? `LTA signal point (${p.TYP_NAM})` : `LTA signal point ${uniq}`,
          Source: 'LTA Traffic Signal GeoJSON',
          HasRealtimeImage: false,
          Note: 'No realtime image (public point only)'
        };
      });
  });
}

function parseKmlCoordinates(kmlText) {
  const points = [];
  const placemarks = kmlText.match(/<Placemark[\s\S]*?<\/Placemark>/g) || [];
  for (const pm of placemarks) {
    const coordMatch = pm.match(/<coordinates>\s*([^<]+)\s*<\/coordinates>/i);
    if (!coordMatch) continue;
    const [lonRaw, latRaw] = coordMatch[1].split(',').map(s => s.trim());
    const lon = parseFloat(lonRaw);
    const lat = parseFloat(latRaw);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const nameMatch = pm.match(/<name>\s*([^<]+)\s*<\/name>/i);
    points.push({
      lat,
      lon,
      name: nameMatch ? nameMatch[1].trim() : null
    });
  }
  return points;
}

async function fetchSpfRedLightCameras() {
  return withCache('spf-red-light', STATIC_SOURCE_TTL_MS, async () => {
    let pollResp = await fetch(SPF_RED_LIGHT_API);
    if (!pollResp.ok) {
      pollResp = await fetch(SPF_RED_LIGHT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    }
    if (!pollResp.ok) {
      throw new Error(`SPF dataset API error: ${pollResp.status}`);
    }
    const pollData = await pollResp.json();
    const fileUrl = pollData?.data?.url;
    if (!fileUrl) {
      throw new Error('SPF dataset did not return download URL');
    }
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) {
      throw new Error(`SPF dataset file download failed: ${fileResp.status}`);
    }
    const kml = await fileResp.text();
    const points = downsample(parseKmlCoordinates(kml), MAX_SPF_POINTS);
    return points.map((p, idx) => ({
      CameraID: `spf-redlight-${idx + 1}`,
      Latitude: p.lat,
      Longitude: p.lon,
      Name: p.name ? `SPF red-light camera (${p.name})` : `SPF red-light camera ${idx + 1}`,
      Source: 'Singapore Police Force Red Light Cameras',
      HasRealtimeImage: false,
      Note: 'No realtime image (public point only)'
    }));
  });
}

async function fetchOsmCameraLocations() {
  return withCache('osm-cameras', STATIC_SOURCE_TTL_MS, async () => {
    const query = `
[out:json][timeout:25];
(
  node["man_made"="surveillance"]["surveillance:type"~"camera"](${SG_BBOX});
  node["highway"="speed_camera"](${SG_BBOX});
);
out body;
    `.trim();
    const resp = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
    if (!resp.ok) {
      throw new Error(`Overpass API error: ${resp.status}`);
    }
    const data = await resp.json();
    const elements = downsample((data.elements || []), MAX_OSM_POINTS);
    return elements
      .filter(el => el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number')
      .map((el, idx) => ({
        CameraID: `osm-camera-${el.id || idx}`,
        Latitude: el.lat,
        Longitude: el.lon,
        Name: el.tags?.name || `OSM public camera point ${el.id || idx}`,
        Source: 'OpenStreetMap Camera Nodes',
        HasRealtimeImage: false,
        Note: 'No realtime image (public point only)'
      }));
  });
}

// 代理交通摄像头接口（避免跨域）
app.get('/api/traffic-images', async (req, res) => {
  try {
    const cameras = await fetchTrafficImageCameras();
    res.json({ value: cameras });
  } catch (error) {
    console.error('Failed to load traffic camera data:', error.message);
    res.status(500).json({ error: 'Failed to load camera data', details: error.message });
  }
});

// 聚合多源摄像头数据（含无实时图片点位）
app.get('/api/cameras', async (req, res) => {
  const tasks = [
    ['dataGovTrafficImages', fetchTrafficImageCameras()],
    ['ltaSignalGeoJson', loadLtaSignalGeoJsonCameras()],
    ['spfRedLightCameras', fetchSpfRedLightCameras()],
    ['osmCameraNodes', fetchOsmCameraLocations()]
  ];
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));

  const value = [];
  const warnings = [];
  settled.forEach((result, idx) => {
    const sourceName = tasks[idx][0];
    if (result.status === 'fulfilled') {
      value.push(...result.value);
    } else {
      warnings.push({
        source: sourceName,
        error: result.reason?.message || String(result.reason)
      });
    }
  });

  const realtimeOnly = String(req.query.realtimeOnly || '').toLowerCase();
  const max = Math.max(1, Math.min(parseInt(req.query.max || '10000', 10) || 10000, 10000));
  let filtered = value;
  if (realtimeOnly === '1' || realtimeOnly === 'true') {
    filtered = filtered.filter(v => v.HasRealtimeImage && v.ImageLink);
  }
  filtered = filtered.slice(0, max);

  res.json({
    value: filtered,
    meta: {
      total: filtered.length,
      realtimeWithImage: filtered.filter(v => v.HasRealtimeImage && v.ImageLink).length,
      locationOnly: filtered.filter(v => !v.HasRealtimeImage).length,
      warnings,
      generatedAt: new Date().toISOString()
    }
  });
});

app.get('/api/incidents', async (req, res) => {
  try {
    const source = String(req.query.source || 'live').toLowerCase();
    if (source === 'mock') {
      const mock = await fetchMockIncidentsWithResolution();
      const [cameraResult] = await Promise.allSettled([fetchTrafficImageCameras()]);
      const cameras = cameraResult.status === 'fulfilled'
        ? (cameraResult.value || [])
        : (realtimeCameraFallback.value || []);
      const withCameras = await attachNearestRealtimeCamera(mock.value, cameras);
      const withImagesOnly = String(req.query.withImagesOnly || '0').toLowerCase();
      const max = Math.max(1, Math.min(parseInt(req.query.max || '30', 10) || 30, 100));
      const filtered = (withImagesOnly === '1' || withImagesOnly === 'true')
        ? withCameras.filter(i => i.imageLink)
        : withCameras;
      return res.json({
        value: filtered.slice(0, max),
        meta: {
          ...mock.meta,
          total: filtered.length,
          generatedAt: nowIso()
        }
      });
    }

    const [incidentsResult, camerasResult] = await Promise.allSettled([
      fetchTrafficIncidentsRaw(),
      fetchTrafficImageCameras()
    ]);
    if (incidentsResult.status !== 'fulfilled') {
      throw new Error(incidentsResult.reason?.message || 'Incident data source unavailable');
    }
    const incidents = incidentsResult.value || [];
    const cameras = camerasResult.status === 'fulfilled'
      ? (camerasResult.value || [])
      : (realtimeCameraFallback.value || []);
    const warnings = [];
    if (camerasResult.status !== 'fulfilled') {
      warnings.push({
        source: 'dataGovTrafficImages',
        fallback: realtimeCameraFallback.value?.length ? 'stale-cache' : 'no-camera-data',
        error: camerasResult.reason?.message || 'Camera source unavailable'
      });
    }

    const withCameras = await attachNearestRealtimeCamera(incidents, cameras);
    const withImagesOnly = String(req.query.withImagesOnly || '0').toLowerCase();
    const max = Math.max(1, Math.min(parseInt(req.query.max || '30', 10) || 30, 100));
    const filtered = (withImagesOnly === '1' || withImagesOnly === 'true')
      ? withCameras.filter(i => i.imageLink)
      : withCameras;

    res.json({
      value: filtered.slice(0, max),
      meta: {
        source: 'live',
        total: filtered.length,
        cameraFallbackCount: camerasResult.status === 'fulfilled' ? 0 : (realtimeCameraFallback.value?.length || 0),
        warnings,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Failed to load live incidents:', error.message);
    res.status(500).json({ error: 'Failed to load live incidents', details: error.message });
  }
});

// Alerts 右侧资讯流：近 7 天事故新闻 + 最新交通规则更新
app.get('/api/traffic-info-feed', async (req, res) => {
  try {
    /**
     * 新闻专栏数据聚合（Alerts 右栏）
     *
     * “交通相关”判断方式：
     * - 不是对全文做机器学习分类，而是通过 RSS 查询词先做主题过滤
     *   NEWS_ACCIDENT_RSS: Singapore traffic accident when:7d
     *   NEWS_RULE_RSS:     Singapore LTA traffic rule update
     *
     * “最近一周”判断方式：
     * - 对每条新闻 publishedAt 转时间戳
     * - 满足 ts >= now-7天 且 ts <= now+10分钟（容忍源站时区微偏差）
     *
     * 返回结构：
     * - weeklyNews: 最近7天事故新闻（最多20条，按时间倒序）
     * - latestRule: 最新一条规则更新新闻
     * - warnings:   某一上游源失败时的告警信息
     */
    const feed = await withCache('traffic-info-feed', 15 * 60 * 1000, async () => {
      const nowMs = Date.now();
      const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
      const settled = await Promise.allSettled([
        fetchRss(NEWS_ACCIDENT_RSS),
        fetchRss(NEWS_RULE_RSS)
      ]);

      const warnings = [];
      const accidentItems = settled[0].status === 'fulfilled' ? settled[0].value : [];
      const ruleItems = settled[1].status === 'fulfilled' ? settled[1].value : [];
      if (settled[0].status !== 'fulfilled') {
        warnings.push({ source: 'weeklyNews', error: settled[0].reason?.message || 'Incident news source unavailable' });
      }
      if (settled[1].status !== 'fulfilled') {
        warnings.push({ source: 'latestRule', error: settled[1].reason?.message || 'Rules news source unavailable' });
      }

      const weeklyNews = (accidentItems || [])
        .filter((it) => {
          const ts = new Date(it.publishedAt || 0).getTime();
          return Number.isFinite(ts) && ts >= weekAgoMs && ts <= nowMs + 10 * 60 * 1000;
        })
        .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
        .slice(0, 20);

      const latestRule = (ruleItems || [])
        .filter((it) => Number.isFinite(new Date(it.publishedAt || 0).getTime()))
        .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())[0] || null;

      return {
        weeklyNews,
        latestRule,
        generatedAt: nowIso(),
        warnings
      };
    });
    res.json(feed);
  } catch (error) {
    console.error('Failed to load traffic info feed:', error.message);
    res.status(500).json({
      weeklyNews: [],
      latestRule: null,
      generatedAt: nowIso(),
      warnings: [{ source: 'feed', error: error.message || 'Traffic info feed fetch failed' }]
    });
  }
});

// 地点转坐标（支持邮编或地名；优先 OneMap，邮编时补充 postcode.dabase.com）
app.get('/api/geocode', async (req, res) => {
  /**
   * 地理编码入口（起点/终点文本 -> 坐标）
   *
   * 设计目标：
   * - 同时支持邮编、地名、MRT 站名
   * - 与天气模块统一 OneMap 优先策略
   *
   * 数据源优先顺序：
   * 1) OneMap（主源）
   * 2) postcode.dabase.com（仅邮编）
   * 3) Nominatim（兜底）
   */
  const query = (req.query.q || req.query.location || req.query.postal || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Please enter start/destination (postal code or place)' });
  }
  const isPostal = /^\d{6}$/.test(query);
  const maybeMrt = /mrt|station/i.test(query);

  function pickBestOneMapResult(results, originalQuery) {
    if (!Array.isArray(results) || !results.length) return null;
    const q = String(originalQuery || '').toLowerCase();
    const scored = results.map((r, idx) => {
      const building = String(r.BUILDING || '').toLowerCase();
      const address = String(r.ADDRESS || '').toLowerCase();
      const searchVal = String(r.SEARCHVAL || '').toLowerCase();
      let score = 0;
      if (q && (building.includes(q) || address.includes(q) || searchVal.includes(q))) score += 3;
      if (building.includes('mrt') || building.includes('station') || searchVal.includes('mrt') || searchVal.includes('station')) score += 4;
      if (address.includes('mrt')) score += 2;
      return { r, idx, score };
    });
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return scored[0]?.r || null;
  }

  async function oneMapLookup(searchVal) {
    const r = await fetch(`https://developers.onemap.sg/commonapi/search?searchVal=${encodeURIComponent(searchVal)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`);
    if (!r.ok) return null;
    const d = await r.json();
    const best = pickBestOneMapResult(d?.results || [], query);
    if (!best) return null;
    return {
      lat: parseFloat(best.LATITUDE || best.latitude),
      lon: parseFloat(best.LONGITUDE || best.longitude),
      display: best.ADDRESS || best.BUILDING || best.SEARCHVAL || searchVal,
      postal: best.POSTAL || '',
      building: best.BUILDING || ''
    };
  }

  const sources = [
    // 1) OneMap 搜索（与天气模块一致，支持地名和邮编）
    async () => {
      const candidates = [query];
      if (!isPostal && !maybeMrt) {
        candidates.push(`${query} MRT`, `${query} MRT Station`);
      }
      for (const c of candidates) {
        const found = await oneMapLookup(c);
        if (found) return found;
      }
      return null;
    },
    // 2) postcode.dabase.com（仅处理邮编）
    async () => {
      if (!isPostal) return null;
      const r = await fetch(`https://postcode.dabase.com/?postcode=${query}`);
      if (!r.ok) return null;
      const geo = await r.json();
      if (geo?.geometry?.coordinates) {
        const [lon, lat] = geo.geometry.coordinates;
        return { lat, lon, display: geo.properties?.Place || query, postal: query };
      }
      return null;
    },
    // 3) Nominatim 兜底
    async () => {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' Singapore')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'SingaporeTrafficApp/1.0 (Route Planner)' } }
      );
      const d = await r.json();
      if (d?.length > 0) {
        const x = d[0];
        return { lat: parseFloat(x.lat), lon: parseFloat(x.lon), display: x.display_name };
      }
      return null;
    }
  ];

  for (const fn of sources) {
    try {
      const result = await fn();
      if (result) return res.json(result);
    } catch (e) {
      continue;
    }
  }
  res.status(404).json({ error: `Location \"${query}\" not found, try postal code or a more complete place name` });
});

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Invalid lat/lon parameters' });
  }
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&format=jsonv2&addressdetails=1`,
      { headers: { 'User-Agent': 'SingaporeTrafficApp/1.0 (Reverse Geocode)' } }
    );
    if (!r.ok) throw new Error(`Reverse geocode API error: ${r.status}`);
    const d = await r.json();
    const address = d?.address || {};
    const name =
      d?.name ||
      address.amenity ||
      address.building ||
      address.road ||
      address.suburb ||
      address.neighbourhood ||
      d?.display_name ||
      'Current Location';
    return res.json({
      lat,
      lon,
      display: name,
      postal: address.postcode || '',
      address: d?.display_name || name
    });
  } catch (e) {
    return res.status(500).json({ error: 'Reverse geocode failed', details: e.message });
  }
});

app.get('/api/onemotoring/erp', async (req, res) => {
  try {
    const [kmlText, localRates] = await Promise.all([
      fetchTextCached(ONEMOTORING_ERP_KML_URL),
      fetchLocalErpRates().catch(() => ({ gantries: {} }))
    ]);
    const items = parseErpKml(kmlText);
    const enriched = items.map((item) => {
      const gantryNoMatch = String(item.name || '').match(/\((\d+)\)\s*$/);
      const gantryNo = gantryNoMatch ? gantryNoMatch[1] : '';
      const localBands = gantryNo ? (localRates?.gantries?.[gantryNo] || []) : [];
      return {
        ...item,
        gantryNo,
        localRates: Array.isArray(localBands) ? localBands : []
      };
    });
    res.json({
      value: enriched,
      meta: {
        total: enriched.length,
        source: 'OneMotoring traffic.smart ERP KML',
        sourceUrl: ONEMOTORING_ERP_KML_URL,
        generatedAt: nowIso()
      }
    });
  } catch (error) {
    console.error('Failed to load OneMotoring ERP markers:', error.message);
    res.status(500).json({ error: 'Failed to load ERP markers' });
  }
});

app.get('/api/onemotoring/pgs', async (req, res) => {
  try {
    const [kmlText, parkingRates] = await Promise.all([
      fetchTextCached(ONEMOTORING_PGS_KML_URL),
      fetchParkingRatesLookup()
    ]);
    const items = parsePgsKml(kmlText).map((item) => {
      const matchedRate = findBestParkingRateMatch(item.name, parkingRates);
      return {
        ...item,
        rates: matchedRate ? {
          name: matchedRate.name,
          weekdayBefore: matchedRate.weekdayBefore,
          weekdayAfter: matchedRate.weekdayAfter,
          saturday: matchedRate.saturday,
          sunday: matchedRate.sunday,
          sourceUrl: matchedRate.sourceUrl
        } : null
      };
    });
    res.json({
      value: items,
      meta: {
        total: items.length,
        source: 'OneMotoring traffic.smart PGS KML + official parking rates pages',
        sourceUrl: ONEMOTORING_PGS_KML_URL,
        generatedAt: nowIso()
      }
    });
  } catch (error) {
    console.error('Failed to load OneMotoring PGS markers:', error.message);
    res.status(500).json({ error: 'Failed to load PGS markers' });
  }
});

app.get('/api/mobile-location/latest', (req, res) => {
  res.json(getMobileLocationPayload());
});

app.post('/api/mobile-location/update', (req, res) => {
  const lat = parseFloat(req.body?.lat);
  const lon = parseFloat(req.body?.lon);
  const accuracy = parseFloat(req.body?.accuracy);
  const deviceName = trimText(req.body?.deviceName || 'Android device', 80);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Invalid lat/lon' });
  }
  latestMobileLocation.lat = lat;
  latestMobileLocation.lon = lon;
  latestMobileLocation.accuracy = Number.isFinite(accuracy) ? accuracy : null;
  latestMobileLocation.timestamp = Date.now();
  latestMobileLocation.source = 'mobile';
  latestMobileLocation.deviceName = deviceName;
  return res.json({ ok: true, value: getMobileLocationPayload() });
});

app.post('/api/mobile-location/clear', (req, res) => {
  latestMobileLocation.lat = null;
  latestMobileLocation.lon = null;
  latestMobileLocation.accuracy = null;
  latestMobileLocation.timestamp = null;
  latestMobileLocation.source = 'none';
  latestMobileLocation.deviceName = '';
  return res.json({ ok: true });
});

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
  if (!OPENWEATHER_API_KEY) {
    res.status(500).json({ error: 'OPENWEATHER_API_KEY not configured' });
    return false;
  }
  return true;
}

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

app.post('/api/ai/incident-summary', async (req, res) => {
  const incident = req.body?.incident || {};
  const message = String(incident.message || incident.type || 'Traffic incident').trim();
  const area = String(incident.area || 'Unknown area').trim();
  const createdAt = String(incident.createdAt || nowIso()).trim();
  const cameraName = String(incident.cameraName || 'None').trim();
  const lowerMessage = message.toLowerCase();
  let fallbackReason = 'Traffic flow is likely reduced because vehicles are slowing and merging carefully around the affected section.';
  if (lowerMessage.includes('accident') || lowerMessage.includes('collision') || lowerMessage.includes('crash')) {
    fallbackReason = 'This is likely caused by a vehicle collision or lane blockage, so traffic is slowing while drivers merge around it.';
  } else if (lowerMessage.includes('breakdown') || lowerMessage.includes('vehicle') || lowerMessage.includes('stalled')) {
    fallbackReason = 'This is likely caused by a broken-down vehicle occupying part of the road and reducing available lane space.';
  } else if (lowerMessage.includes('road work') || lowerMessage.includes('roadwork') || lowerMessage.includes('maintenance')) {
    fallbackReason = 'This is likely caused by road maintenance or lane closure work, which is narrowing traffic flow through the area.';
  } else if (lowerMessage.includes('congestion') || lowerMessage.includes('jam') || lowerMessage.includes('slow traffic')) {
    fallbackReason = 'This is likely caused by heavy traffic build-up, with vehicles braking frequently and moving in short gaps.';
  } else if (lowerMessage.includes('obstacle') || lowerMessage.includes('debris')) {
    fallbackReason = 'This is likely caused by an obstacle on the road, so vehicles are slowing down to pass it safely.';
  }
  const prompt = `You are a Singapore traffic assistant writing for everyday drivers. Return strict JSON only with keys: location,time,reason,duration.
Incident text: ${message}
Area: ${area}
Reported at: ${createdAt}
Camera: ${cameraName}
Rules:
- reason must be plain, human, easy to understand, no jargon, no code-like words.
- reason should sound like a real person explaining likely cause in one short sentence.
- reason must be inferred from the incident type or message, and must not simply repeat the location or area.
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
      } catch (_) {}
    }
    if (!parsed) {
      parsed = {
        location: area,
        time: createdAt,
        reason: fallbackReason,
        duration: '30-90 minutes (estimated)'
      };
    }
    const humanReason = String(parsed.reason || '').trim() || fallbackReason;
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

async function fetchRoadNetworkByBbox(s, w, n, e) {
  /**
   * 拉取指定 bbox 的道路网络（供 /api/route-plan 使用）
   *
   * 容错策略：
   * - 优先使用本地新加坡路网快照，并按 bbox 截取子集
   * - 相近 bbox 共享缓存，减少重复请求
   * - endpoint 列表依次重试（官方 + 镜像）
   * - 任一端返回可用 elements 即立即返回
   * - 全部失败时优先回退到旧缓存，仍无缓存才抛错误
   */
  const cacheKey = makeRoadNetworkCacheKey(s, w, n, e);
  const now = Date.now();
  const cached = sourceCache.get(cacheKey);
  if (cached && now - cached.time < ROAD_NETWORK_CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const localRoads = await loadLocalRoadNetworkSnapshot();
    const localSubset = subsetRoadNetworkByBbox(localRoads, s, w, n, e);
    if (Array.isArray(localSubset?.elements) && localSubset.elements.length) {
      sourceCache.set(cacheKey, { time: now, value: localSubset });
      return localSubset;
    }
  } catch (localErr) {
    console.warn(`Local road network snapshot unavailable, falling back to Overpass: ${localErr.message}`);
  }
  const overpassQuery = `
[out:json][timeout:25];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link)$"](${s},${w},${n},${e});
);
out body geom;
  `.trim();
  const endpoints = [
    OVERPASS_API,
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter'
  ];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const resp = await fetchJsonWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
      }, OVERPASS_FETCH_TIMEOUT_MS);
      if (!resp.ok) throw new Error(`Overpass API error: ${resp.status} (${endpoint})`);
      const data = await resp.json();
      if (!Array.isArray(data?.elements) || !data.elements.length) {
        throw new Error(`Overpass returned empty road network (${endpoint})`);
      }
      sourceCache.set(cacheKey, { time: now, value: data });
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') {
        lastErr = new Error(`Road network service timed out (${endpoint})`);
      } else {
        lastErr = err;
      }
      continue;
    }
  }
  if (cached && now - cached.time < ROAD_NETWORK_STALE_TTL_MS) {
    console.warn(`Using stale cached road network for ${cacheKey} after Overpass failure: ${lastErr?.message || 'unknown error'}`);
    return cached.value;
  }
  throw lastErr || new Error('Failed to fetch Overpass road network');
}

// Python 后端路线规划（A*），返回 3 条路线：时间优先/少红绿灯/均衡
app.post('/api/route-plan', async (req, res) => {
  try {
    /**
     * Python 路线规划总入口
     *
     * 流程：
     * 1) 校验前端传入起终点坐标
     * 2) 拉取 bbox 路网 + 信号点
     * 3) 调用 Python plan_routes 产出 3 条候选路线
     * 4) 返回 routes + 元信息（引擎、信号点数、生成时间）
     *
     * 注意：
     * - 这里只负责“基础路线生成”，事件评估在 /api/route-events/* 完成
     */
    const start = req.body?.start || {};
    const end = req.body?.end || {};
    const startLat = toNumber(start.lat);
    const startLon = toNumber(start.lon);
    const endLat = toNumber(end.lat);
    const endLon = toNumber(end.lon);
    if (!Number.isFinite(startLat) || !Number.isFinite(startLon) || !Number.isFinite(endLat) || !Number.isFinite(endLon)) {
      return res.status(400).json({ error: 'Invalid start/end coordinates, expected {start:{lat,lon}, end:{lat,lon}}' });
    }

    const padding = Math.max(0.01, Math.min(0.08, toNumber(req.body?.paddingDeg) || 0.02));
    const s = Math.min(startLat, endLat) - padding;
    const n = Math.max(startLat, endLat) + padding;
    const w = Math.min(startLon, endLon) - padding;
    const e = Math.max(startLon, endLon) + padding;

    const [roads, ltaSignals] = await Promise.all([
      fetchRoadNetworkByBbox(s, w, n, e),
      loadLtaSignalGeoJsonCameras()
    ]);
    const signalPoints = (ltaSignals || [])
      .map((x) => ({ lat: toNumber(x.Latitude), lon: toNumber(x.Longitude) }))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    const payload = {
      roads,
      start: { lat: startLat, lon: startLon },
      end: { lat: endLat, lon: endLon },
      signalPoints
    };
    let pyResult;
    let engine = 'fastapi';
    try {
      pyResult = await callFastApiJson('/compute/plan-routes', payload, 15000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route planning fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('plan_routes', payload, 15000);
      engine = 'python-fallback';
    }

    if (!Array.isArray(pyResult?.routes) || !pyResult.routes.length) {
      return res.status(404).json({ error: 'No available route found' });
    }
    res.json({
      routes: pyResult.routes,
      meta: {
        engine,
        signalCount: signalPoints.length,
        generatedAt: nowIso()
      }
    });
  } catch (e) {
    console.error('Python route planning failure details:', e.message);
    const friendly = buildRoutePlanFriendlyError(e);
    res.status(friendly.status).json({
      error: friendly.error,
      details: friendly.details,
      retryable: friendly.retryable
    });
  }
});

// 路线事件相关性筛选（Python）
app.post('/api/route-events/analyze', async (req, res) => {
  try {
    /**
     * 路线事件筛选（Python）
     *
     * 输入：routeCoords + events + userLoc
     * 输出：与当前路线阶段相关的事件（用于后续评分）
     */
    const routeCoords = Array.isArray(req.body?.routeCoords) ? req.body.routeCoords : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const userLoc = req.body?.userLoc || null;
    const payload = {
      routeCoords,
      events,
      userLoc
    };
    let pyResult;
    try {
      pyResult = await callFastApiJson('/compute/analyze-events-for-route', payload, 10000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route-event analyze fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('analyze_events_for_route', payload, 10000);
    }
    res.json({
      value: Array.isArray(pyResult?.value) ? pyResult.value : []
    });
  } catch (e) {
    res.status(500).json({ error: 'Python route-event analyze failed', details: e.message });
  }
});

// 路线事件评分/拥堵评估（Python）
app.post('/api/route-events/evaluate', async (req, res) => {
  try {
    /**
     * 路线事件评分（Python）
     *
     * 输入：候选路线 + 事件列表
     * 输出：
     * - recommendedRouteId（综合推荐）
     * - currentFastestId（考虑事件延误后的当前最快）
     * - evaluations（每条路线命中与评分明细）
     */
    const routes = Array.isArray(req.body?.routes) ? req.body.routes : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const payload = {
      routes,
      events
    };
    let pyResult;
    try {
      pyResult = await callFastApiJson('/compute/evaluate-route-events', payload, 10000);
    } catch (fastApiErr) {
      console.warn(`FastAPI route-event evaluate fell back to python script: ${fastApiErr.message}`);
      pyResult = await runPythonCompute('evaluate_route_events', payload, 10000);
    }
    res.json({
      recommendedRouteId: pyResult?.recommendedRouteId || null,
      currentFastestId: pyResult?.currentFastestId || null,
      evaluations: Array.isArray(pyResult?.evaluations) ? pyResult.evaluations : []
    });
  } catch (e) {
    res.status(500).json({ error: 'Python route-event evaluate failed', details: e.message });
  }
});

// 获取新加坡道路网络（Overpass 接口）
app.get('/api/roads', async (req, res) => {
  const { minLat, minLon, maxLat, maxLon } = req.query;
  const bbox = [minLat, minLon, maxLat, maxLon].map(parseFloat);
  if (bbox.some(isNaN)) {
    return res.status(400).json({ error: 'Invalid bounding box' });
  }
  const [s, w, n, e] = bbox;
  try {
    const data = await fetchRoadNetworkByBbox(s, w, n, e);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load road data', details: e.message });
  }
});

async function startServer() {
  try {
    await pool.query('SELECT 1');
    await initAuthDatabase();
    app.listen(config.PORT, '0.0.0.0', () => {
      console.log(`Using data.gov.sg Traffic Images API`);
      console.log(`Singapore Traffic Monitoring System started: http://localhost:${config.PORT}/ui2/`);
    });
  } catch (error) {
    console.error('❌ Startup failed, unable to connect PostgreSQL:', error.message);
    process.exit(1);
  }
}

startServer();
