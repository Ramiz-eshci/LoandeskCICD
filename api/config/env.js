'use strict';

/**
 * Centralised environment loader + validator.
 *
 * - Loads .env once.
 * - Normalises values into a typed `config` object.
 * - Fail-fast boot guards: in production the process EXITS when a
 *   required secret is missing or still holds a placeholder value
 *   (A02: Cryptographic Failures - never boot on dev/placeholder keys).
 */

require('dotenv').config({ quiet: true });

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const PLACEHOLDERS = [
  'CHANGE_ME',
  'CHANGE_ME_unique_random_secret',
  'CHANGE_ME_another_random_secret',
  'CHANGE_ME_session_secret',
  'CHANGE_ME_32_byte_base64_or_64_hex',
];

function bool(val, def = false) {
  if (val === undefined || val === null || val === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
}

function int(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

function list(val) {
  return String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  isProd,
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || 'localhost',
  // iisnode PORT ko named pipe string deta hai (numeric nahi) - us case me
  // raw string hi rakho, warna parseInt NaN dega aur galti se 3400 pe listen hoga.
  port: /^\\\\\.\\pipe\\/.test(String(process.env.PORT || '')) ? process.env.PORT : int(process.env.PORT, 3400),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    encrypt: bool(process.env.DB_ENCRYPT, true),
    trustServerCertificate: bool(process.env.DB_TRUST_SERVER_CERT, true),
    poolMax: int(process.env.DB_POOL_MAX, 10),
    poolMin: int(process.env.DB_POOL_MIN, 0),
    poolIdleMs: int(process.env.DB_POOL_IDLE_MS, 30000),
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'ld_refresh',
    refreshCookiePath: process.env.REFRESH_COOKIE_PATH || '/api/auth',
    csrfCookieName: process.env.CSRF_COOKIE_NAME || 'ld_csrf',
  },

  // Forgot-password reset links: single-use, expire after N minutes.
  passwordReset: {
    ttlMinutes: int(process.env.PASSWORD_RESET_TTL_MINUTES, 60),
  },

  otp: {
    // Master switch: when true a FIXED default code is used (no SMS sent).
    // Pen-test 24-10-2026: secure defaults - when unset, production uses real codes and
    // has NO fallback code; development keeps the fixed 123456 for convenience.
    defaultEnabled: bool(process.env.OTP_DEFAULT_ENABLED, !isProd),
    defaultCode: process.env.OTP_DEFAULT_CODE || (isProd ? '' : '123456'),
    length: int(process.env.OTP_LENGTH, 6),
    ttlSeconds: int(process.env.OTP_TTL_SECONDS, 300),
    maxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5),
    // Delivery channels — only used when defaultEnabled=false (real codes).
    // mobile => SMS (currently skipped/logged); email => branded email.
    sentMobile: bool(process.env.IS_LOGIN_OTP_SENT_MOBILE, false),
    sentEmail: bool(process.env.IS_LOGIN_OTP_SENT_EMAIL, false),
  },

  sessionSecret: process.env.SECRET_KEY,

  crypto: {
    enabled: bool(process.env.ENCRYPTION_ENABLED, false),
    masterKey: process.env.CRYPTO_SESSION_MASTER_KEY,
    sessionTtlSeconds: int(process.env.CRYPTO_SESSION_TTL_SECONDS, 1800),
  },

  cors: {
    origins: list(process.env.CORS_ORIGINS),
  },

  rateLimit: {
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, 10),
  },

  // Request body limits (pen-test 24-10-2026): signed-in staff requests may carry base64
  // uploads; anonymous requests are kept small. See middlewares/body-limits.js.
  body: {
    jsonLimit: process.env.JSON_BODY_LIMIT || '2mb',
    uploadLimit: process.env.UPLOAD_BODY_LIMIT || '100mb',
  },

  uploads: {
    maxSize: int(process.env.MAX_UPLOAD_SIZE, 20971520), // 20 MB everywhere (client 22-10-2026)
    allowedExtensions: list(process.env.ALLOWED_EXTENSIONS),
  },

  email: {
    host: process.env.EMAIL_HOST,
    port: int(process.env.EMAIL_PORT, 465),
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },

  // Microsoft Graph (Outlook -> Enquiry intake). App-only client credentials.
  graph: {
    tenantId: process.env.MS_TENANT_ID,
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    mailbox: process.env.OUTLOOK_MAILBOX,
    webhookUrl: process.env.GRAPH_WEBHOOK_URL,
    lifecycleUrl: process.env.GRAPH_LIFECYCLE_URL,
    clientState: process.env.GRAPH_CLIENT_STATE,
    subscriptionMinutes: int(process.env.GRAPH_SUBSCRIPTION_MINUTES, 1440),
    autoRenew: bool(process.env.GRAPH_AUTO_RENEW, true),
  },

  // AI extraction for free-form enquiry emails (optional; falls back to regex).
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
  },

  frontUrl: process.env.FRONT_URL || 'http://localhost:4200/',
};

/** A value is "bad" if empty or still a known placeholder. */
function isBad(val) {
  if (!val) return true;
  return PLACEHOLDERS.some((p) => String(val).includes(p));
}

/**
 * Validate config. Throws in production, warns in development.
 * Call once at boot (app.js) before wiring routes.
 */
function validate() {
  const problems = [];

  // Secrets that must always be strong
  if (isBad(config.jwt.secret)) problems.push('JWT_SECRET missing/placeholder');
  if (isBad(config.jwt.refreshSecret)) problems.push('JWT_REFRESH_SECRET missing/placeholder');
  if (isBad(config.sessionSecret)) problems.push('SECRET_KEY missing/placeholder');

  // DB
  if (!config.db.database) problems.push('DB_NAME missing');

  // Crypto master key required only when transport encryption is ON
  if (config.crypto.enabled && isBad(config.crypto.masterKey)) {
    problems.push('CRYPTO_SESSION_MASTER_KEY missing/placeholder (required when ENCRYPTION_ENABLED=true)');
  }

  // CORS must be an explicit allowlist in production, never "*"
  if (isProd) {
    if (config.cors.origins.length === 0) problems.push('CORS_ORIGINS must be set in production');
    if (config.cors.origins.includes('*')) problems.push('CORS_ORIGINS must not contain "*"');
  }

  // Pen-test 24-10-2026: risky-but-allowed production settings -> loud warning (no abort,
  // so a server whose .env is not updated yet keeps working).
  const warnings = [];
  if (isProd && config.otp.defaultEnabled) {
    warnings.push('OTP_DEFAULT_ENABLED=true: every login uses the same fixed OTP (2-step login is effectively OFF)');
  }
  if (isProd && !config.otp.defaultEnabled && !config.otp.sentEmail && !config.otp.sentMobile) {
    warnings.push('OTP_DEFAULT_ENABLED=false but IS_LOGIN_OTP_SENT_EMAIL / _MOBILE are both off: nobody can receive a login code');
  }
  if (config.graph.webhookUrl && String(config.graph.clientState || '').length < 16) {
    warnings.push('GRAPH_CLIENT_STATE missing or shorter than 16 characters: Outlook notifications will be ignored');
  }
  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('\x1b[33m[SECURITY WARNING]\x1b[0m\n  - ' + warnings.join('\n  - '));
  }

  if (problems.length) {
    const msg = 'Environment validation failed:\n  - ' + problems.join('\n  - ');
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error('\x1b[31m[BOOT ABORT]\x1b[0m ' + msg);
      process.exit(1);
    } else {
      // eslint-disable-next-line no-console
      console.warn('\x1b[33m[WARN]\x1b[0m ' + msg + '\n(development: continuing with weak/dev values)');
    }
  }
}

module.exports = { config, validate };