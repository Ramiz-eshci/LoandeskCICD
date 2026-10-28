'use strict';

/**
 * Rate limiting (A07 Auth Failures / brute-force protection).
 * - global limiter: config.rateLimit.max per window per IP
 * - auth limiter: stricter, for login / OTP / password routes
 */

const rateLimit = require('express-rate-limit');
const { config } = require('../config/env');

const jsonHandler = (message) => (req, res) =>
  res.status(429).json({ status: false, message, data: [], errors: null, meta: null });

const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many requests, please try again later'),
});

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many attempts, please slow down'),
});

const demoRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many demo requests, please try again later'),
});

module.exports = { globalLimiter, authLimiter, demoRequestLimiter };
