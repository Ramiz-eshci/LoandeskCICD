'use strict';

/**
 * Pen-test review (24-10-2026) - status of every finding. Code fixes are covered by the
 * tests named below; the remaining items are server / .env actions (no code).
 *
 * DONE (code + tests):
 *  - OTP master code refused in production ......... integration/auth.flow, unit/config/otp-config
 *  - /uploads + API source not served by IIS/Express  security/static-files
 *  - Anthropic API key no longer logged ............. unit/services/emailExtractor.service
 *  - E-mail HTML sanitised (allow-list) ............. unit/services/emailHub.service, front safe-html.spec
 *  - Inbound e-mail attachments content-checked ..... unit/services/emailReply.attachments, emailIngestion
 *  - npm audit: 0 vulnerabilities (api + front prod)
 *  - Forgot-password: one answer for every e-mail ... integration/auth.flow
 *  - Swagger + /api/example dev-only ................ security/production-exposure
 *  - iisnode log pages / debugging off .............. security/static-files
 *  - SPA security headers + strict CSP .............. security/spa-headers
 *  - CSV formula injection .......................... unit/services/reports.csv
 *  - Anonymous body limit 2mb, 4xx not 500 .......... security/body-limits, unit/middlewares/error-handler
 *  - Outlook webhook clientState / id checks ........ unit/controllers/outlook.webhook
 *  - Logout is POST ................................. integration/auth.flow, front auth.service.spec
 *  - OTP resend keeps the attempt counter ........... integration/auth.flow
 *  - environment.production = true .................. front environment.spec
 *  - Git: .env / customer PDFs ignored (.gitignore)
 *
 * NOT APPLICABLE:
 *  - Subresource Integrity: all bundles are same-origin and covered by CSP script-src 'self';
 *    Angular's SRI import map is an inline script that a strict CSP would block.
 */

describe('pen-test backlog (server / .env actions - no code)', () => {
  it.todo('SERVER: .env.live OTP_DEFAULT_ENABLED=false + IS_LOGIN_OTP_SENT_EMAIL=true, remove OTP_DEFAULT_CODE');
  it.todo('SERVER: .env / .env.live ALLOWED_EXTENSIONS=pdf,doc,docx,xls,xlsx,png,jpg,jpeg,gif,webp,bmp (Excel allowed)');
  it.todo('SERVER: rotate ANTHROPIC_API_KEY and the secrets in website/.env');
  it.todo('SERVER: deploy new api + root web.config, npm ci, TLS 1.2+ / HTTPS redirect / HSTS');
  it.todo('GIT: git rm --cached website/.env and api/uploads/enquiry_offers');
});
