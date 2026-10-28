'use strict';
/**
 * Safe Content-Disposition value (pen-test 24-10-2026).
 * A raw `filename="${name}"` breaks on quotes and throws ERR_INVALID_CHAR (HTTP 500)
 * for any character outside Latin-1 (e.g. an en-dash pasted from Word).
 * Emits an ASCII fallback plus the RFC 5987 UTF-8 form that all browsers prefer.
 */
function disposition(name, type = 'attachment') {
  const full = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'download';
  const ascii = full.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const star = encodeURIComponent(full).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const kind = type === 'inline' ? 'inline' : 'attachment';
  return ascii === full
    ? `${kind}; filename="${ascii}"`
    : `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`;
}

module.exports = { disposition };
