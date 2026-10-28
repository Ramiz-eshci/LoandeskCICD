'use strict';

/**
 * Central error handler + 404 (A05 / A09).
 * Never leaks stack traces to the client in production.
 * Every unhandled/next(err) error in ANY route lands here -> logged to file.
 */

const { config } = require('../config/env');
const R = require('../services/response.service');
const logger = require('../utils/logger');

function notFound(req, res) {
  return R.notFound(res, 'Route not found');
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // date-wise plaintext log with request context
  logger.logRequestError(err, req);

  if (res.headersSent) return; // response already streaming

  // Pen-test 24-10-2026: client errors raised by the body parsers etc. (bad JSON -> 400,
  // body too large -> 413, unsupported charset -> 415) keep their 4xx status with a short
  // fixed message instead of turning into a 500.
  const status = Number(err && (err.status || err.statusCode));
  if (status >= 400 && status < 500 && err.expose !== false) {
    const CLIENT_MESSAGES = { 400: 'Invalid request body', 413: 'Request is too large', 415: 'Unsupported request encoding' };
    return res.status(status).json(R.build(false, CLIENT_MESSAGES[status] || 'Bad Request', [], null));
  }

  const message = config.isProd ? 'Internal Server Error' : err.message || 'Internal Server Error';
  return R.serverError(res, message);
}

module.exports = { notFound, errorHandler };
