'use strict';

/**
 * File logger (A09 Logging Failures).
 *
 * - Writes date-wise files: logs/YYYY-MM-DD.log  (one file per day).
 * - Logs are ALWAYS plaintext / DECRYPTED — the crypto envelope wraps HTTP
 *   responses only, never these files. So logs stay human-readable on disk.
 * - Never throws: a logging failure must not break a request.
 * - In NODE_ENV=test the console echo is muted (file write still happens),
 *   so the Jest output stays clean.
 *
 * Do NOT pass raw passwords / tokens / full decrypted bodies here.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// mute console echo during tests (file logging still runs + is asserted)
const QUIET = process.env.NODE_ENV === 'test';

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD (local time) - the daily file name. */
function dateStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO timestamp for the line prefix. */
function stamp(d = new Date()) {
  return d.toISOString();
}

function toText(val) {
  if (val instanceof Error) return val.stack || val.message;
  if (val && typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch (_) {
      return String(val);
    }
  }
  return String(val);
}

function write(level, parts) {
  try {
    ensureDir();
    const file = path.join(LOG_DIR, `${dateStamp()}.log`);
    const line = `[${stamp()}] [${level}] ${parts.map(toText).join(' ')}\n`;
    fs.appendFileSync(file, line, 'utf8'); // plaintext (decrypted) append
  } catch (e) {
    // last resort - never propagate a logging error
    // eslint-disable-next-line no-console
    if (!QUIET) console.error('[logger-failed]', e && e.message ? e.message : e);
  }
}

/** Build a short request context: "METHOD url ip=..." (no bodies/secrets). */
function reqContext(req) {
  if (!req) return '';
  const ip = req.clientIp || (req.headers && req.headers['x-forwarded-for']) || req.ip || '-';
  return `${req.method} ${req.originalUrl || req.url} ip=${ip}`;
}

module.exports = {
  error(...args) {
    write('ERROR', args);
    // eslint-disable-next-line no-console
    if (!QUIET) console.error('[error]', ...args);
  },
  warn(...args) {
    write('WARN', args);
    // eslint-disable-next-line no-console
    if (!QUIET) console.warn('[warn]', ...args);
  },
  info(...args) {
    write('INFO', args);
    // eslint-disable-next-line no-console
    if (!QUIET) console.log('[info]', ...args);
  },
  /** Log an error with request context. Used by the error handlers. */
  logRequestError(err, req) {
    const ctx = reqContext(req);
    write('ERROR', ctx ? [ctx, err] : [err]);
    // eslint-disable-next-line no-console
    if (!QUIET) console.error('[error]', ctx, err && err.stack ? err.stack : err);
  },
  LOG_DIR,
};
