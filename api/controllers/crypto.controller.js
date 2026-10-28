'use strict';

/**
 * Transport-encryption handshake endpoints.
 *   GET  /api/crypto/public-key       -> RSA public key (PEM/SPKI)
 *   POST /api/crypto/session          -> { encryptedKey } => { sessionId, expiresAt }
 *   GET  /api/crypto/session/validate -> checks X-Session-Id header
 *
 * These endpoints are always PLAIN (never enveloped) and are exempt from the
 * request-decrypt / response-encrypt middleware.
 */

const cryptoService = require('../services/crypto.service');
const { config } = require('../config/env');
const R = require('../services/response.service');
const Logs = require('./common/logs.controller');

module.exports = {
  publicKey(req, res) {
    try {
      return R.ok(res, 'Public key', { publicKey: cryptoService.getPublicKeyPem(), enabled: config.crypto.enabled });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },

  async createSession(req, res) {
    try {
      const encryptedKey = req.body && req.body.encryptedKey;
      if (!encryptedKey) return R.badRequest(res, 'encryptedKey is required', { encryptedKey: 'required' });
      const session = await cryptoService.createSession(encryptedKey);
      return R.ok(res, 'Session established', session);
    } catch (ex) {
      if (ex instanceof cryptoService.CryptoError) {
        return R.badRequest(res, ex.message, null, { code: ex.code });
      }
      Logs.ErrorHandler(ex, res);
    }
  },

  async validateSession(req, res) {
    try {
      const sessionId = req.headers['x-session-id'];
      const result = await cryptoService.validateSession(sessionId);
      if (result.valid) return R.ok(res, 'Session valid', { valid: true });
      return R.send(res, 400, false, 'Session invalid', [], { code: result.code });
    } catch (ex) {
      Logs.ErrorHandler(ex, res);
    }
  },
};
