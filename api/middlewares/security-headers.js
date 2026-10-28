'use strict';

/**
 * HTTP security headers for the API (A05 Security Misconfiguration).
 * Mirrors INED-AI api/security_headers.py.
 *
 * The API serves JSON/PDF only (never executable HTML), so CSP is locked to
 * default-src 'none'. Headers use "set only if absent" semantics (like Flask's
 * setdefault) so a handler that chose its own Cache-Control (e.g. a stream)
 * keeps it.
 */

const { config } = require('../config/env');

// Sensitive path prefixes -> no-store (matched with or without the /api mount)
const SENSITIVE_PREFIXES = [
  '/auth',
  '/client',
  '/user',
  '/dashbord',
  '/reports',
  '/audit',
  '/category',
  '/manufacturer',
  '/model',
  '/status',
];

function setDefault(res, name, value) {
  if (!res.getHeader(name)) res.setHeader(name, value);
}

function isSensitive(path) {
  const p = path.replace(/^\/api/, '');
  return SENSITIVE_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix + '/'));
}

module.exports = function securityHeaders() {
  return function (req, res, next) {
    // strip framework fingerprint
    res.removeHeader('X-Powered-By');

    // static headers on every response
    setDefault(res, 'X-Content-Type-Options', 'nosniff');
    setDefault(res, 'Referrer-Policy', 'strict-origin-when-cross-origin');
    setDefault(res, 'X-Frame-Options', 'DENY');
    setDefault(
      res,
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()'
    );
    setDefault(res, 'Cross-Origin-Opener-Policy', 'same-origin');
    // same-SITE, not same-origin: the Angular app is a different origin but same
    // site and must read API responses + download PDFs.
    setDefault(res, 'Cross-Origin-Resource-Policy', 'same-site');
    setDefault(res, 'X-Permitted-Cross-Domain-Policies', 'none');
    setDefault(res, 'X-Download-Options', 'noopen');

    // CSP: API returns JSON/PDF only, never executable HTML
    setDefault(
      res,
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
    );

    // HSTS: production only (never pin a dev browser to https)
    if (config.isProd) {
      setDefault(res, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // no-store on sensitive paths + any PDF response
    res.on('pipe', () => {}); // noop; keeps parity with stream-aware handlers
    if (isSensitive(req.path)) {
      setDefault(res, 'Cache-Control', 'no-store, no-cache, must-revalidate, private');
      setDefault(res, 'Pragma', 'no-cache');
      setDefault(res, 'Expires', '0');
    }

    next();
  };
};
