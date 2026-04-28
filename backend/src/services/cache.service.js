const { sourceCache } = require('../state');

async function withCache(key, ttlMs, loader) {
  const now = Date.now();
  const cached = sourceCache.get(key);
  if (cached && now - cached.time < ttlMs) return cached.value;
  const value = await loader();
  sourceCache.set(key, { time: now, value });
  return value;
}

module.exports = { withCache };
