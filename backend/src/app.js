const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { createRateLimiter, getClientIp } = require('./middleware/rateLimit');

function setFrontendCacheHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();
  if (name === 'sw.js' || ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json') {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use(express.static(config.FRONTEND_DIR, { setHeaders: setFrontendCacheHeaders }));
  // Keep the old /ui2 URL working for stale bookmarks and service-worker caches.
  app.use('/ui2', express.static(config.FRONTEND_DIR, { setHeaders: setFrontendCacheHeaders }));

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

  app.use('/api', createRateLimiter({ windowMs: config.RATE_LIMIT_WINDOW_MS, maxRequests: config.RATE_LIMIT_MAX, keySuffix: 'api' }));
  app.use('/api/auth', createRateLimiter({ windowMs: config.RATE_LIMIT_WINDOW_MS, maxRequests: config.AUTH_RATE_LIMIT_MAX, keySuffix: 'auth' }));

  return app;
}

module.exports = {
  createApp,
  setFrontendCacheHeaders
};
