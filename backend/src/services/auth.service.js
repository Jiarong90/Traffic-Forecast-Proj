const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('../../config');
const { pool } = require('../db');
const { nowIso, trimText } = require('../utils/common');

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

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function sendVerificationEmail(email, code, name) {
  const subject = 'FAST Email Verification Code';
  const text = `Hi ${name || 'User'}, your FAST verification code is ${code}. It will expire in ${config.SIGNUP_CODE_TTL_MIN} minutes.`;

  if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
    });
    await transporter.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject,
      text
    });
    return { delivered: true };
  }

  if (config.MAIL_DEV_MODE) {
    console.log(`[DEV MAIL] ${email} verification code: ${code}`);
    return { delivered: false, devCode: code };
  }

  throw new Error('SMTP not configured');
}

function getEffectiveMembership(row) {
  const requestedTier = String(row?.member_tier || '').trim().toLowerCase();
  const expiresAt = row?.member_expires_at ? new Date(row.member_expires_at).toISOString() : '';
  const expiresTs = expiresAt ? Date.parse(expiresAt) : NaN;
  const isAdvanced = requestedTier === 'advanced' && Number.isFinite(expiresTs) && expiresTs > Date.now();
  return {
    tier: isAdvanced ? 'advanced' : 'free',
    expiresAt: isAdvanced ? expiresAt : ''
  };
}

function toPublicUser(row) {
  const membership = getEffectiveMembership(row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    memberTier: membership.tier,
    memberExpiresAt: membership.expiresAt
  };
}

function requireSupabaseConfig() {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase Auth is not fully configured');
  }
}

async function supabaseAuthRequest(pathname, { method = 'GET', body, accessToken = '', serviceRole = false } = {}) {
  requireSupabaseConfig();
  const url = `${config.SUPABASE_URL}/auth/v1${pathname}`;
  const apiKey = serviceRole ? config.SUPABASE_SERVICE_ROLE_KEY : config.SUPABASE_ANON_KEY;
  const headers = { apikey: apiKey };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else if (serviceRole) headers.Authorization = `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`;

  const resp = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try {
    data = await resp.json();
  } catch (_) { }
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

async function supabaseSendSignupOtp(email, name) {
  return supabaseAuthRequest('/otp', {
    method: 'POST',
    body: {
      email,
      create_user: true,
      data: {
        name,
        role: 'user'
      }
    }
  });
}

async function supabaseVerifyEmailOtp(email, code) {
  return supabaseAuthRequest('/verify', {
    method: 'POST',
    body: {
      email,
      token: code,
      type: 'email'
    }
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
    RETURNING user_id AS id, email, name, role, member_tier, member_expires_at
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
      member_tier,
      member_expires_at,
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
      member_tier TEXT NOT NULL DEFAULT 'free' CHECK(member_tier IN ('free','advanced')),
      member_expires_at TIMESTAMPTZ,
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
      frequent_places JSONB NOT NULL DEFAULT '[]'::jsonb,
      commute_to_work_time TEXT NOT NULL DEFAULT '',
      commute_to_home_time TEXT NOT NULL DEFAULT '',
      frequent_routes JSONB NOT NULL DEFAULT '[]'::jsonb,
      vehicles JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS member_tier TEXT NOT NULL DEFAULT 'free';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS member_expires_at TIMESTAMPTZ;
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS birthday DATE;
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS profession TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_profiles ADD COLUMN IF NOT EXISTS school TEXT NOT NULL DEFAULT '';
    ALTER TABLE app_user_settings ADD COLUMN IF NOT EXISTS frequent_places JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE app_user_settings ADD COLUMN IF NOT EXISTS vehicles JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

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

module.exports = {
  hashPassword,
  verifyPassword,
  isUsableEmail,
  isStrongPassword,
  generateVerificationCode,
  hashVerificationCode,
  sendVerificationEmail,
  getEffectiveMembership,
  toPublicUser,
  supabasePasswordSignIn,
  supabaseGetUser,
  supabaseAdminCreateUser,
  supabaseAdminDeleteUser,
  supabaseUserUpdate,
  supabaseSendSignupOtp,
  supabaseVerifyEmailOtp,
  ensureUserProfile,
  getUserProfileById,
  getSupabaseAuthUserByEmail,
  pickProfileName,
  initAuthDatabase,
  getBearerToken,
  requireAuth,
  requireAdmin,
  trimText
};
