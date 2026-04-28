const config = require('../../config');
const { withCache } = require('./cache.service');

async function fetchTextCached(url, ttlMs = config.ONEMOTORING_SOURCE_TTL_MS) {
  return withCache(`text:${url}`, ttlMs, async () => {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FAST/1.0 (OneMotoring integration)' }
    });
    if (!resp.ok) throw new Error(`Failed to fetch source: ${resp.status}`);
    return resp.text();
  });
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

module.exports = {
  fetchTextCached,
  fetchJsonWithTimeout
};
