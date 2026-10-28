'use strict';

/**
 * Outbound response encryption.
 * Wraps res.json so success bodies (status < 400) are returned as the crypto
 * envelope.
 *
 * With ENCRYPTION_ENABLED=true the encryption-gate has already guaranteed a
 * valid X-Session-Id for every non-crypto route, so here we ALWAYS encrypt and
 * NEVER fall back to plain data. If encryption fails for any reason, a generic
 * error is returned (no business data leaks).
 *
 * Error bodies (>= 400) pass through unencrypted — they carry only a message /
 * error code, never API data, so the client can always re-handshake.
 */

const cryptoService = require('../services/crypto.service');
const { config } = require('../config/env');
const R = require('../services/response.service');

module.exports = function encryptResponse() {
  return function (req, res, next) {
    if (!config.crypto.enabled) return next();

    // handshake responses + health probe are plain by design
    if (req.path.startsWith('/api/crypto') || req.path === '/api/health') return next();

    const sessionId = req.headers['x-session-id'];
    const originalJson = res.json.bind(res);

    res.json = function (payload) {
      // error bodies: plain (message/code only, no data)
      if (res.statusCode >= 400) return originalJson(payload);

      // success bodies: MUST encrypt. No session -> refuse, don't leak.
      if (!sessionId) {
        res.status(401);
        return originalJson(R.build(false, 'Encrypted session required', [], { code: cryptoService.CODES.NO_SESSION }));
      }

      cryptoService
        .encryptForSession(sessionId, payload)
        .then((env) => {
          originalJson({
            encrypted: true,
            success: true,
            data: env.data,
            meta: { iv: env.iv, tag: env.tag, timestamp: new Date().toISOString() },
          });
        })
        .catch((err) => {
          // never send the plain payload; send an error instead
          res.status(401);
          originalJson(R.build(false, 'Session invalid for encryption', [], { code: err.code || cryptoService.CODES.INVALID }));
        });
      return res;
    };

    next();
  };
};
