'use strict';

/**
 * Inbound request decryption (transport encryption).
 * Runs AFTER the JSON body parser, BEFORE route handlers.
 *
 * If ENCRYPTION_ENABLED and the parsed body is a crypto envelope
 * ({ encrypted:true, data, meta:{iv,tag} }), decrypt it with the session's
 * AES key (X-Session-Id header) and replace req.body with the plaintext.
 *
 * Skips: the crypto handshake routes (they carry the key itself), and
 * multipart/file uploads (handled separately, never enveloped).
 */

const cryptoService = require('../services/crypto.service');
const { config } = require('../config/env');
const R = require('../services/response.service');

function isEnvelope(b) {
  return b && b.encrypted === true && typeof b.data === 'string' && b.meta && b.meta.iv && b.meta.tag;
}

module.exports = function decryptRequest() {
  return async function (req, res, next) {
    if (!config.crypto.enabled) return next();

    // handshake endpoints must stay plain
    if (req.path.startsWith('/api/crypto')) return next();

    // multipart uploads are never enveloped
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/')) return next();

    if (!isEnvelope(req.body)) return next();

    const sessionId = req.headers['x-session-id'];
    try {
      req.body = await cryptoService.decryptForSession(sessionId, {
        data: req.body.data,
        iv: req.body.meta.iv,
        tag: req.body.meta.tag,
      });
      return next();
    } catch (err) {
      // typed crypto error -> 400 with code so the frontend can re-handshake
      return res.status(400).json(
        R.build(false, err.message || 'Decryption failed', [], { code: err.code || cryptoService.CODES.INVALID })
      );
    }
  };
};
