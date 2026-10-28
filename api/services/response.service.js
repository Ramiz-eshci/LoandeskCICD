'use strict';

/**
 * Uniform API response format (A09 friendly, consistent contract).
 *
 * EVERY endpoint returns the same shape:
 * {
 *   "status":  true | false,
 *   "message": "human readable",
 *   "data":    <array | object>,     // default []
 *   "errors":  <object | null>,      // field errors, default null
 *   "meta":    <object | null>       // pagination etc, default null
 * }
 *
 * When transport encryption is ON, the encrypt-response middleware wraps
 * this body inside the crypto envelope for success (status < 400) responses.
 * Error bodies pass through unencrypted by design so the client can always
 * read err.message during rollout / debugging.
 */

function body(status, message, data = [], errors = null, meta = null) {
  // `success` mirrors `status`; `correlationId` is injected by the correlation
  // middleware. Both kept for the { success, message, data, errors, correlationId } contract.
  return { status, success: status, message, data, errors, meta };
}

module.exports = {
  ok(res, message = 'Success', data = [], meta = null) {
    return res.status(200).json(body(true, message, data, null, meta));
  },
  created(res, message = 'Created', data = []) {
    return res.status(201).json(body(true, message, data));
  },
  paginated(res, message, data, { page, per_page, total, total_pages }) {
    return res.status(200).json(body(true, message, data, null, { page, per_page, total, total_pages }));
  },
  badRequest(res, message = 'Bad Request', errors = null, data = []) {
    return res.status(400).json(body(false, message, data, errors));
  },
  unauthorized(res, message = 'Authorization failed') {
    return res.status(401).json(body(false, message, [], null));
  },
  forbidden(res, message = 'You are not authorized') {
    return res.status(403).json(body(false, message, [], null));
  },
  notFound(res, message = 'Not Found') {
    return res.status(404).json(body(false, message, [], null));
  },
  notImplemented(res, message = 'Not implemented yet') {
    return res.status(501).json(body(false, message, [], null));
  },
  serverError(res, message = 'Internal Server Error') {
    return res.status(500).json(body(false, message, [], null));
  },
  // raw builder if a controller needs a custom status
  send(res, httpStatus, status, message, data = [], errors = null, meta = null) {
    return res.status(httpStatus).json(body(status, message, data, errors, meta));
  },
  build: body,
};
