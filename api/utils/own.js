'use strict';
/**
 * Own-property lookup for maps indexed by request input (pen-test 24-10-2026).
 * `MAP['constructor']` / `MAP['__proto__']` would otherwise return inherited
 * Object.prototype members and crash the handler with a 500.
 */
const own = (obj, key) =>
  obj != null && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

module.exports = { own };
