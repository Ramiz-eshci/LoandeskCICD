'use strict';

/**
 * Encryption gate.
 *
 * When ENCRYPTION_ENABLED=true, NO endpoint may return business data in plain
 * text. Every request (except the crypto handshake routes) must carry a valid
 * X-Session-Id. Missing/invalid/expired session -> rejected here BEFORE the
 * handler runs, so no data is ever computed or leaked.
 *
 * When ENCRYPTION_ENABLED=false, this middleware is a no-op (plain JSON allowed).
 */

const cryptoService = require('../services/crypto.service');
const { config } = require('../config/env');
const R = require('../services/response.service');

module.exports = function encryptionGate() {
  return async function (req, res, next) {
    if (!config.crypto.enabled) return next();

    // handshake endpoints must stay reachable to establish a session;
    // /api/health is a plain liveness probe (no business data) for monitors/LBs
    if (req.path.startsWith('/api/crypto') || req.path === '/api/health') return next();

    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
      return res
        .status(401)
        .json(R.build(false, 'Encrypted session required', [], { code: cryptoService.CODES.NO_SESSION }));
    }

    const result = await cryptoService.validateSession(sessionId);
    if (!result.valid) {
      return res
        .status(401)
        .json(R.build(false, 'Invalid or expired session', [], { code: result.code }));
    }

    return next();
  };
};
