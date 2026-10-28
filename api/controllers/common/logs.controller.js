'use strict';

/**
 * Controller-level error responder + structured logging (A09).
 * Writes date-wise plaintext (decrypted) log files via utils/logger.
 * Never log raw passwords, tokens or full decrypted payloads.
 */

const { config } = require('../../config/env');
const R = require('../../services/response.service');
const logger = require('../../utils/logger');

module.exports = {
  /**
   * Use inside a controller catch block.
   * Logs server-side (file + console), replies with the uniform 500 body.
   * Pass `req` when available so the log line carries method/url/ip.
   */
  ErrorHandler(ex, res, req) {
    logger.logRequestError(ex, req);
    const message = config.isProd ? 'Internal Server Error' : (ex && ex.message) || 'Internal Server Error';
    return R.serverError(res, message);
  },

  info(...args) {
    logger.info(...args);
  },

  warn(...args) {
    logger.warn(...args);
  },

  error(...args) {
    logger.error(...args);
  },
};
