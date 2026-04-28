const rateLimitStore = new Map();

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

module.exports = {
  getClientIp,
  createRateLimiter
};
