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
app.use(express.static(path.join(__dirname, 'public')));
app.use('/ui2', express.static(path.join(__dirname, '..', 'UI 2')));

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNUP_CODE_TTL_MIN = 10;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fyp_demo';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@fast.local';
const MAIL_DEV_MODE = String(process.env.MAIL_DEV_MODE || 'true').toLowerCase() === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || '';
const RATE_LIMIT_WINDOW_MS = Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10) || 60000);
const RATE_LIMIT_MAX = Math.max(10, parseInt(process.env.RATE_LIMIT_MAX || '180', 10) || 180);
const AUTH_RATE_LIMIT_MAX = Math.max(3, parseInt(process.env.AUTH_RATE_LIMIT_MAX || '40', 10) || 40);
const pool = new Pool({
  connectionString: DATABASE_URL
});

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

async function initAuthDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','admin')),
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company_location TEXT NOT NULL DEFAULT '',
      home_location TEXT NOT NULL DEFAULT '',
      commute_to_work_time TEXT NOT NULL DEFAULT '',
      commute_to_home_time TEXT NOT NULL DEFAULT '',
      frequent_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);

  async function ensureUser(name, email, password, role) {
    await pool.query(
      `
      INSERT INTO users (name, email, password_hash, role, email_verified, created_at)
      VALUES ($1, $2, $3, $4, TRUE, $5)
      ON CONFLICT(email) DO UPDATE SET email_verified = TRUE
      `,
      [name, email, hashPassword(password), role, nowIso()]
    );
  }

  await ensureUser('FAST User', 'user@fast.local', 'User12345!', 'user');
  await ensureUser('FAST Admin', 'admin@fast.local', 'Admin12345!', 'admin');

  await pool.query(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2::jsonb, $3)
    ON CONFLICT(key) DO NOTHING
    `,
    ['simulation_config', JSON.stringify(DEFAULT_SIMULATION_CONFIG), nowIso()]
  );
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `
    INSERT INTO sessions (token, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4)
    `,
    [token, userId, expiresAt.toISOString(), nowIso()]
  );
  return token;
}

async function resolveSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `
    SELECT s.token, s.expires_at, u.id, u.name, u.email, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1
    `,
    [token]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
    return null;
  }
  return { token: row.token, user: toPublicUser(row) };
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    const session = await resolveSession(token);
    if (!session) return res.status(401).json({ error: 'Please log in first' });
    req.session = session;
    next();
  } catch (error) {
    console.error('Authentication failed:', error.message);
    res.status(500).json({ error: 'Authentication failed' });
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


// data.gov.sg 交通摄像头接口（无需密钥，公开可用）
const TRAFFIC_IMAGES_API = 'https://api.data.gov.sg/v1/transport/traffic-images';
const TRAFFIC_INCIDENTS_API = 'https://api.data.gov.sg/v1/transport/traffic-incidents';
const LTA_TRAFFIC_INCIDENTS_API = 'https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents';
const OPENWEATHER_CURRENT_API = 'https://api.openweathermap.org/data/2.5/weather';
const OPENWEATHER_FORECAST_API = 'https://api.openweathermap.org/data/2.5/forecast';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
const LTA_SIGNAL_GEOJSON_PATH = path.join(__dirname, 'data', 'LTATrafficSignalAspectGEOJSON.geojson');
const INCIDENT_MOCK_PATH = path.join(__dirname, 'data', 'incident_api_mock.json');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const PY_ENGINE_PATH = path.join(__dirname, 'py', 'compute_engine.py');
const SPF_RED_LIGHT_API = 'https://api-open.data.gov.sg/v1/public/api/datasets/d_271f8db0ab03ca15ef0f0f9f88bc4d6e/poll-download';
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const SG_BBOX = '1.16,103.60,1.48,104.10';
const NEWS_ACCIDENT_RSS = 'https://news.google.com/rss/search?q=Singapore+traffic+accident+when:7d&hl=en-SG&gl=SG&ceid=SG:en';
const NEWS_RULE_RSS = 'https://news.google.com/rss/search?q=Singapore+LTA+traffic+rule+update&hl=en-SG&gl=SG&ceid=SG:en';
const STATIC_SOURCE_TTL_MS = 60 * 60 * 1000;
const INCIDENT_SOURCE_TTL_MS = 2 * 60 * 1000;
const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || '';
const MAX_LTA_SIGNAL_POINTS = 2500;
const MAX_OSM_POINTS = 1200;
const MAX_SPF_POINTS = 600;
const sourceCache = new Map();
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

  const exists = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (exists.rows[0]) return { status: 409, body: { error: 'Email is already registered' } };

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
    const existingUser = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existingUser.rows[0]) return res.status(409).json({ error: 'Email already registered, delete the account before reusing this email for testing' });

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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const role = 'user';
      const inserted = await client.query(
        `
        INSERT INTO users (name, email, password_hash, role, email_verified, created_at)
        VALUES ($1, $2, $3, $4, TRUE, $5)
        RETURNING id, name, email, role
        `,
        [ver.name, email, ver.password_hash, role, nowIso()]
      );
      await client.query(`DELETE FROM signup_verifications WHERE email = $1`, [email]);
      await client.query('COMMIT');
      const user = inserted.rows[0];
      const token = await createSession(user.id);
      res.json({ token, user: toPublicUser(user) });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
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
    const result = await pool.query(`SELECT id, password_hash FROM users WHERE id = $1`, [req.session.user.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Account does not exist' });
    if (!verifyPassword(password, row.password_hash)) return res.status(401).json({ error: 'Incorrect password, unable to delete account' });
    await pool.query(
      `DELETE FROM users WHERE id = $1`,
      [req.session.user.id]
    );
    res.json({ ok: true, message: 'Account deleted, you can re-register using the same email for testing' });
  } catch (error) {
    console.error('Failed to delete account:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.get('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const userQ = await pool.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [req.session.user.id]);
    const user = userQ.rows[0];
    if (!user) return res.status(404).json({ error: 'User does not exist' });
    const settingsQ = await pool.query(
      `
      SELECT company_location, home_location, commute_to_work_time, commute_to_home_time, frequent_routes
      FROM user_settings
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

app.put('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const settings = normalizeUserSettings(req.body || {});
    await pool.query(
      `
      INSERT INTO user_settings (
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
      UPDATE users
      SET name = $1
      WHERE id = $2
      RETURNING id, name, email, role
      `,
      [name, req.session.user.id]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
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
    const result = await pool.query(`SELECT id, password_hash FROM users WHERE id = $1`, [req.session.user.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'User does not exist' });
    if (!verifyPassword(currentPassword, row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashPassword(newPassword), req.session.user.id]);
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
    const result = await pool.query(
      `
      SELECT id, name, email, role, password_hash
      FROM users
      WHERE email = $1
      `,
      [email]
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    const verified = await pool.query(`SELECT email_verified FROM users WHERE id = $1`, [row.id]);
    if (!verified.rows[0]?.email_verified) {
      return res.status(403).json({ error: 'Email not verified, please complete verification signup flow' });
    }

    const token = await createSession(row.id);
    res.json({ token, user: toPublicUser(row) });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM sessions WHERE token = $1`, [req.session.token]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Logout failed:', error.message);
    res.status(500).json({ error: 'Logout failed' });
  }
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
    const totalQ = await pool.query(`SELECT COUNT(*)::int AS total FROM users`);
    const verifiedQ = await pool.query(`SELECT COUNT(*)::int AS verified FROM users WHERE email_verified = TRUE`);
    const adminQ = await pool.query(`SELECT COUNT(*)::int AS admins FROM users WHERE role = 'admin'`);
    const userQ = await pool.query(`SELECT COUNT(*)::int AS normal_users FROM users WHERE role = 'user'`);
    const activeSessionQ = await pool.query(`SELECT COUNT(*)::int AS active_sessions FROM sessions WHERE expires_at > NOW()`);
    const new7dQ = await pool.query(`SELECT COUNT(*)::int AS new_7d FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`);

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
      SELECT id, name, email, role, email_verified, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM users`);
    res.json({ total: total.rows[0].total, limit, offset, value: rows.rows });
  } catch (error) {
    console.error('Failed to load user list:', error.message);
    res.status(500).json({ error: 'Failed to load user list' });
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
      const impact = buildIncidentImpactMeta({
        type: row.Type || row.type,
        message: row.Message || row.message,
        estimated_impact_min: row.estimated_impact_min,
        estimated_impact_max: row.estimated_impact_max
      });
      active.push({
        id,
        type: row.Type || row.type || 'Incident',
        message: row.Message || row.message || 'Mock incident',
        lat: toNumber(row.Latitude ?? row.lat),
        lon: toNumber(row.Longitude ?? row.lon),
        createdAt: now,
        riskLevel: row.risk_level || 'Medium',
        lifecycleState,
        source: 'mock',
        estimatedDurationMin: impact.estimatedDurationMin,
        estimatedDurationMax: impact.estimatedDurationMax,
        spreadRadiusKm: impact.spreadRadiusKm,
        notes: row.notes || ''
      });
    } else {
      next.absentStreak = (next.absentStreak || 0) + 1;
      if (next.absentStreak >= spec.absentPolls) {
        if (!next.resolved) resolvedNow += 1;
        next.resolved = true;
        next.resolvedAt = now;
      } else if (!next.resolved) {
        clearingNow += 1;
        const impact = buildIncidentImpactMeta({
          type: row.Type || row.type,
          message: row.Message || row.message,
          estimated_impact_min: row.estimated_impact_min,
          estimated_impact_max: row.estimated_impact_max
        });
        active.push({
          id,
          type: row.Type || row.type || 'Incident',
          message: `[Clearing check] ${row.Message || row.message || 'Mock incident'}`,
          lat: toNumber(row.Latitude ?? row.lat),
          lon: toNumber(row.Longitude ?? row.lon),
          createdAt: now,
          riskLevel: row.risk_level || 'Medium',
          lifecycleState: 'Clearing',
          source: 'mock',
          estimatedDurationMin: impact.estimatedDurationMin,
          estimatedDurationMax: impact.estimatedDurationMax,
          spreadRadiusKm: impact.spreadRadiusKm,
          notes: `${row.notes || ''}; missing ${next.absentStreak}/${spec.absentPolls}`
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
  return withCache('data-gov-traffic-incidents', INCIDENT_SOURCE_TTL_MS, async () => {
    async function parseListLocal(list, prefix) {
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
            createdAt: x.CreatedAt || x.Created || x.updated_at || new Date().toISOString(),
            estimatedDurationMin: impact.estimatedDurationMin,
            estimatedDurationMax: impact.estimatedDurationMax,
            spreadRadiusKm: impact.spreadRadiusKm
          };
        })
        .filter(Boolean);
    }

    async function parseList(list, prefix) {
      try {
        const result = await runPythonCompute('normalize_incidents', {
          list: Array.isArray(list) ? list : [],
          prefix,
          defaultCreatedAt: nowIso()
        }, 10000);
        if (Array.isArray(result?.value)) return result.value;
        throw new Error('Python normalize_incidents returned invalid format');
      } catch (err) {
        console.warn(`Python incident normalization fell back to Node.js: ${err.message}`);
        return parseListLocal(list, prefix);
      }
    }

    if (LTA_ACCOUNT_KEY) {
      try {
        const ltaResp = await fetch(LTA_TRAFFIC_INCIDENTS_API, {
          headers: { AccountKey: LTA_ACCOUNT_KEY, accept: 'application/json' }
        });
        if (ltaResp.ok) {
          const ltaData = await ltaResp.json();
          const ltaIncidents = await parseList(ltaData?.value, 'lta');
          if (ltaIncidents.length > 0) return ltaIncidents;
        }
      } catch (_) {}
    }

    const response = await fetch(TRAFFIC_INCIDENTS_API);
    if (!response.ok) throw new Error(`data.gov.sg incidents API error: ${response.status}`);
    const data = await response.json();
    return parseList((data.value || data.items || data || []), 'dgov');
  });
}

async function runPythonCompute(op, payload, timeoutMs = 12000) {
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
  try {
    const payload = {
      incidents: Array.isArray(incidents) ? incidents : [],
      cameras: toPythonRealtimeCameras(cameras)
    };
    const result = await runPythonCompute('enrich_incidents_with_cameras', payload, 10000);
    if (Array.isArray(result?.value)) return result.value;
    throw new Error('Python returned invalid data format');
  } catch (err) {
    console.warn(`Python incident matching fell back to Node.js: ${err.message}`);
    return attachNearestRealtimeCameraLocal(incidents, cameras);
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

app.get('/api/weather/current', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Invalid lat/lon parameters' });
  }
  if (!OPENWEATHER_API_KEY) {
    return res.status(500).json({ error: 'OPENWEATHER_API_KEY not configured' });
  }
  try {
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
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Invalid lat/lon parameters' });
  }
  if (!OPENWEATHER_API_KEY) {
    return res.status(500).json({ error: 'OPENWEATHER_API_KEY not configured' });
  }
  try {
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
  const prompt = `You are a Singapore traffic assistant writing for everyday drivers. Return strict JSON only with keys: location,time,reason,duration.
Incident text: ${message}
Area: ${area}
Reported at: ${createdAt}
Camera: ${cameraName}
Rules:
- reason must be plain, human, easy to understand, no jargon, no code-like words.
- reason should sound like a real person explaining likely cause in one short sentence.
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
        reason: `Likely due to a road incident in ${area}, traffic may be moving slowly in this section.`,
        duration: '30-90 minutes (estimated)'
      };
    }
    const humanReason = String(parsed.reason || '').trim() || `Likely due to a road incident in ${area}, traffic may be moving slowly in this section.`;
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

async function fetchRoadNetworkByBbox(s, w, n, e) {
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
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(overpassQuery)
      });
      if (!resp.ok) throw new Error(`Overpass API error: ${resp.status} (${endpoint})`);
      const data = await resp.json();
      if (!Array.isArray(data?.elements) || !data.elements.length) {
        throw new Error(`Overpass returned empty road network (${endpoint})`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  throw lastErr || new Error('Failed to fetch Overpass road network');
}

// Python 后端路线规划（A*），返回 3 条路线：时间优先/少红绿灯/均衡
app.post('/api/route-plan', async (req, res) => {
  try {
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

    const pyResult = await runPythonCompute('plan_routes', {
      roads,
      start: { lat: startLat, lon: startLon },
      end: { lat: endLat, lon: endLon },
      signalPoints
    }, 15000);

    if (!Array.isArray(pyResult?.routes) || !pyResult.routes.length) {
      return res.status(404).json({ error: 'No available route found' });
    }
    res.json({
      routes: pyResult.routes,
      meta: {
        engine: 'python',
        signalCount: signalPoints.length,
        generatedAt: nowIso()
      }
    });
  } catch (e) {
    console.error('Python route planning failure details:', e.message);
    res.status(500).json({ error: 'Python route planning failed', details: e.message });
  }
});

// 路线事件相关性筛选（Python）
app.post('/api/route-events/analyze', async (req, res) => {
  try {
    const routeCoords = Array.isArray(req.body?.routeCoords) ? req.body.routeCoords : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const userLoc = req.body?.userLoc || null;
    const pyResult = await runPythonCompute('analyze_events_for_route', {
      routeCoords,
      events,
      userLoc
    }, 10000);
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
    const routes = Array.isArray(req.body?.routes) ? req.body.routes : [];
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const pyResult = await runPythonCompute('evaluate_route_events', {
      routes,
      events
    }, 10000);
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
    app.listen(config.PORT, () => {
      console.log(`Using data.gov.sg Traffic Images API`);
      console.log(`Singapore Traffic Monitoring System started: http://localhost:${config.PORT}/ui2/`);
      console.log(`PostgreSQL connected`);
    });
  } catch (error) {
    console.error('❌ Startup failed, unable to connect PostgreSQL:', error.message);
    process.exit(1);
  }
}

startServer();
