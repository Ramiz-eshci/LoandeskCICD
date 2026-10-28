'use strict';

/**
 * LoanDesk API - Express app factory (no network side-effects).
 *
 * This module builds and exports the configured `app`. It does NOT call
 * app.listen() so it can be imported by tests (supertest) without opening a
 * port or a DB pool. The process entry point that actually listens is
 * server.js.
 *
 * Middleware order matters:
 *   security -> parsers -> crypto (response wrap + request decrypt) -> routes.
 */

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const requestIp = require('request-ip');

const { config, validate } = require('./config/env');

// Fail-fast on missing/placeholder secrets (exits in production).
validate();

const securityHeaders = require('./middlewares/security-headers');
const { globalLimiter } = require('./middlewares/rate-limit');
const encryptionGate = require('./middlewares/encryption-gate');
const encryptResponse = require('./middlewares/encrypt-response');
const decryptRequest = require('./middlewares/encrypt-request');
const { notFound, errorHandler } = require('./middlewares/error-handler');

const app = express();

// ---- hardening / fingerprint ----
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind IIS/reverse proxy

// ---- base middleware ----
app.use(compression());
app.use(morgan(config.isProd ? 'combined' : 'dev'));
app.use(cookieParser());

// ---- API docs (Swagger UI) — mounted early so it is exempt from the crypto
// envelope + CSP and is easy to browse in development (Doc-03 Section 25).
// Pen-test 24-10-2026: the API map is not published in production.
if (!config.isProd) {
  const swaggerUi = require('swagger-ui-express');
  const swaggerSpec = require('./config/swagger');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
  app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
}

// ---- CORS: exact-origin allowlist, credentials on (never "*") ----
const allowlist = new Set(config.cors.origins);
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin/non-browser (no Origin header) and allowlisted origins
      if (!origin || allowlist.has(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'), false);
    },
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-CSRF-TOKEN'],
    exposedHeaders: ['X-Session-Id', 'X-CSRF-TOKEN'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);

// ---- security headers (helmet base + API-specific overrides) ----
app.use(
  helmet({
    contentSecurityPolicy: false, // set precisely in securityHeaders()
    hsts: false, // gated on prod in securityHeaders()
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    frameguard: false, // securityHeaders() sets X-Frame-Options: DENY
    referrerPolicy: false, // securityHeaders() sets strict-origin-when-cross-origin
  })
);
app.use(securityHeaders());
// Reserved prototype names in the path -> 404 (pen-test 24-10-2026).
app.use(require('./middlewares/path-guard')());

// Public, write-only demo intake has its own small JSON parser and rate limit.
// It accepts caller-supplied contact details without a staff crypto session.
app.use('/api/demo-requests', require('./routes/demoRequest.routes'));

// ---- body parsers ----
// 20MB files travel as base64 (+33%), several per request -> 100mb body cap (client 21-10-2026),
// but only for requests carrying a token signed by this API; anonymous requests get 2mb
// (pen-test 24-10-2026, middlewares/body-limits.js; JSON_BODY_LIMIT / UPLOAD_BODY_LIMIT).
app.use(require('./middlewares/body-limits')());
app.use(
  fileUpload({
    limits: { fileSize: config.uploads.maxSize },
    abortOnLimit: true,
    responseOnLimit: 'File too large',
  })
);
app.use(requestIp.mw());

// ---- global rate limit ----
app.use(globalLimiter);

// ---- transport encryption pipeline ----
// gate first: when enabled, no valid session => reject before any handler (no data leak)
app.use(encryptionGate());
app.use(encryptResponse()); // wraps res.json for success bodies
app.use(decryptRequest()); // decrypts inbound envelopes -> req.body
app.use(require('./middlewares/upload-policy')()); // Word/PDF/image/Excel only, 20MB max (client 22-10-2026)

// ---- uploads are NOT served statically (pen-test 24-10-2026) ----
// Customer documents are downloaded only through the authenticated, RBAC + scope
// checked controller endpoints (they read file_path from disk). The old public
// '/uploads' static mount exposed every file to anyone with the URL.

// ---- health ----
app.get('/api/health', (req, res) =>
  res.json({ status: true, message: 'ok', data: { uptime: process.uptime() }, errors: null, meta: null })
);

// ---- routes ----
const correlation = require('./middlewares/correlation');
app.use(correlation());

app.use('/api/crypto', require('./routes/crypto.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
if (!config.isProd) app.use('/api/example', require('./routes/example.routes')); // dev sample routes only
app.use('/api/enquiries', require('./routes/enquiry.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/applications', require('./routes/application.routes'));
app.use('/api/portfolio', require('./routes/portfolio.routes'));
app.use('/api/extensions', require('./routes/extension.routes'));   // Portfolio Extensions workflow (30-09-2026)
app.use('/api/underwriting', require('./routes/underwriting.routes'));
app.use('/api/credit', require('./routes/credit.routes'));
app.use('/api/legal', require('./routes/legal.routes'));
app.use('/api/valuations', require('./routes/valuations.routes'));
app.use('/api/outlook', require('./routes/outlook.routes'));
app.use('/api/category', require('./routes/category.routes'));
app.use('/api/client', require('./routes/client.routes'));
app.use('/api/manufacturer', require('./routes/manufacturer.routes'));
app.use('/api/model', require('./routes/model.routes'));
app.use('/api/list', require('./routes/list.routes'));
app.use('/api/status', require('./routes/status.routes'));
app.use('/api/user', require('./routes/user.routes'));
app.use('/api/roles', require('./routes/role.routes'));
app.use('/api/modules', require('./routes/modules.routes'));
app.use('/api/masters', require('./routes/masters.routes'));
app.use('/api/brokers', require('./routes/broker.routes'));   // Brokers menu + performance (20-10-2026)
app.use('/api/email-settings', require('./routes/emailSettings.routes'));   // Masters > Email Settings (17-10-2026)
app.use('/api/email-history', require('./routes/emailHistory.routes'));     // Masters > Email History (17-10-2026)
app.use('/api/permissions', require('./routes/permission.routes'));
app.use('/api/dashbord', require('./routes/dashbord.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/audit', require('./routes/audit.routes'));

// ---- 404 + error handler (last) ----
app.use(notFound);
app.use(errorHandler);

module.exports = app;
