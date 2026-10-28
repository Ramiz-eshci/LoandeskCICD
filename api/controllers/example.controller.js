'use strict';

/**
 * Example controller - proves the API + middleware pipeline works.
 *   GET  /api/example/ping     public health check (no auth, no DB)
 *   POST /api/example/echo     echoes body (shows request-decrypt + response-encrypt)
 *   GET  /api/example/whoami   requires a valid JWT (auth)
 *   GET  /api/example/secure   requires permission EXAMPLE:read (auth + RBAC)
 */

const os = require('os');
const { config } = require('../config/env');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');

module.exports = {
  ping(req, res) {
    return R.ok(res, 'pong', {
      service: 'loandesk-api',
      env: config.env,
      encryption: config.crypto.enabled ? 'on' : 'off',
      time: new Date().toISOString(),
      host: os.hostname(),
    });
  },

  echo(req, res) {
    try {
      return R.ok(res, 'Echo', { received: req.body || {} });
    } catch (ex) {
      Logs.ErrorHandler(ex, res, req);
    }
  },

  whoami(req, res) {
    return R.ok(res, 'Authenticated user', req.userData);
  },

  secure(req, res) {
    return R.ok(res, 'You have EXAMPLE:read permission', { unlocked: true });
  },
};
