const { Pool } = require('pg');
const config = require('../config');

function shouldEnableDatabaseSsl(connectionString) {
  if (config.DATABASE_SSL === 'true' || config.DATABASE_SSL === 'require') return true;
  if (config.DATABASE_SSL === 'false' || config.DATABASE_SSL === 'disable') return false;
  return /supabase\.co/i.test(String(connectionString || ''));
}

function buildPoolConfig(connectionString) {
  const poolConfig = { connectionString };
  if (shouldEnableDatabaseSsl(connectionString)) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  return poolConfig;
}

const pool = new Pool(buildPoolConfig(config.DATABASE_URL));

module.exports = {
  pool,
  buildPoolConfig,
  shouldEnableDatabaseSsl
};
