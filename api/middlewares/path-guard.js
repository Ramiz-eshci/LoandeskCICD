'use strict';
/**
 * Reject URL path segments that name Object.prototype members (constructor,
 * __proto__, toString, ...). No real id, key or section is ever one of these,
 * and letting them through reaches map lookups as inherited properties
 * (pen-test 24-10-2026). Answers 404 like any unknown resource.
 */
const RESERVED = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

function isReserved(seg) {
  let s = seg;
  try { s = decodeURIComponent(seg); } catch (_) { return false; }
  return RESERVED.has(s);
}

module.exports = function pathGuard() {
  return function pathGuardMw(req, res, next) {
    const path = String(req.path || '');
    if (path.split('/').some(isReserved)) {
      return res.status(404).json({ status: false, message: 'Not found' });
    }
    return next();
  };
};
module.exports.RESERVED = RESERVED;
