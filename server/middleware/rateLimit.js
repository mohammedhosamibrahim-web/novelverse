'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
};

/** General per-IP limit for all /api traffic (skip the image proxy, which
 *  has its own higher allowance). */
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: config.rateLimit.apiPerMin,
  skip: (req) => req.originalUrl.includes('/api/proxy/image'),
});

/** Stricter limit on authentication endpoints (brute-force protection). */
const authLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: config.rateLimit.authPerMin,
});

/** Image proxy limit. */
const imageLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: config.rateLimit.imagePerMin,
});

module.exports = { apiLimiter, authLimiter, imageLimiter };
