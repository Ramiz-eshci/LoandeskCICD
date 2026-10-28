'use strict';

/**
 * Correlation id + response-shape shim (Module-1 point 7).
 * Adds `success` (mirror of `status`) and `correlationId` to EVERY JSON
 * response without touching each controller, and echoes X-Correlation-Id.
 * Kept backward-compatible: existing `status`/`meta` fields stay.
 */

const crypto = require('crypto');

module.exports = function correlation() {
  return function (req, res, next) {
    const id = String(req.headers['x-correlation-id'] || crypto.randomUUID());
    req.correlationId = id;
    res.setHeader('X-Correlation-Id', id);

    const originalJson = res.json.bind(res);
    res.json = function (payload) {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        if (payload.success === undefined && payload.status !== undefined) payload.success = payload.status;
        if (payload.correlationId === undefined) payload.correlationId = id;
      }
      return originalJson(payload);
    };
    next();
  };
};
