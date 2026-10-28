'use strict';
/**
 * Standalone Graph sendMail test — isolates the email layer from the offer flow.
 * Usage:  node scripts/test-offer-mail.js recipient@example.com
 * Prints the exact Graph result / error so you can see if Mail.Send works.
 */
require('dotenv').config();
const mail = require('../services/mail.service');
const { config } = require('../config/env');

(async () => {
  const to = process.argv[2];
  if (!to) { console.error('Usage: node scripts/test-offer-mail.js recipient@example.com'); process.exit(1); }
  console.log('Mailbox (from):', config.graph && config.graph.mailbox);
  console.log('Tenant set:', !!(config.graph && config.graph.tenantId), 'Client set:', !!(config.graph && config.graph.clientId), 'Secret set:', !!(config.graph && config.graph.clientSecret));
  const pdf = Buffer.from('%PDF-1.4\n%test\n', 'utf8');
  const res = await mail.sendMail({
    to,
    subject: 'LoanDesk test email',
    html: '<p>This is a test from LoanDesk offer mailer.</p>',
    attachments: [{ filename: 'test.pdf', buffer: pdf }],
  });
  console.log('RESULT:', JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 2);
})().catch((e) => { console.error('THREW:', e && (e.message || e)); process.exit(3); });
