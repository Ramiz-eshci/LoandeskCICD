'use strict';

/**
 * Outbound email. Two transports, chosen automatically:
 *
 *  1. Microsoft Graph (app-only) — used when OUTLOOK_MAILBOX + MS_* are set.
 *     Sends as the configured mailbox (config.graph.mailbox). Requires the
 *     Azure app registration to hold Mail.Send (admin-consented).
 *  2. SMTP (nodemailer) — fallback when Graph mailbox is not configured but
 *     EMAIL_HOST/EMAIL_USER/EMAIL_PASS are set (e.g. Gmail app password).
 *
 * Same signature for both. NOT best-effort: the caller surfaces failures.
 */

const nodemailer = require('nodemailer');
const { getGraphClient } = require('../config/microsoftGraph.service');
const { config } = require('../config/env');
const hub = require('./emailHub.service');
const emailReply = require('./emailReply.service');

const asRecipients = (list) => (list || [])
  .filter(Boolean)
  .map((a) => ({ emailAddress: { address: String(a).trim() } }));

let _smtp = null;
function smtpTransport() {
  if (_smtp) return _smtp;
  _smtp = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: Number(config.email.port) === 465, // 465 = implicit TLS
    auth: { user: config.email.user, pass: config.email.pass },
  });
  return _smtp;
}

async function sendViaGraph({ mailbox, toList, ccList, subject, html, attachments }) {
  const message = {
    subject: String(subject || '').slice(0, 255),
    body: { contentType: 'HTML', content: html || '' },
    toRecipients: asRecipients(toList),
    ccRecipients: asRecipients(ccList),
    attachments: (attachments || []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/pdf',
      contentBytes: Buffer.isBuffer(a.buffer) ? a.buffer.toString('base64') : String(a.buffer || ''),
    })),
  };
  const graph = getGraphClient();
  await graph.api(`/users/${mailbox}/sendMail`).post({ message, saveToSentItems: true });
  return { ok: true, messageId: null };
}

async function sendViaSmtp({ toList, ccList, subject, html, attachments }) {
  const from = config.email.user;
  const info = await smtpTransport().sendMail({
    from: `LoanDesk <${from}>`,
    to: toList.filter(Boolean).join(', '),
    cc: ccList.filter(Boolean).join(', ') || undefined,
    subject: String(subject || ''),
    html: html || '',
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: a.buffer,
      contentType: a.contentType || 'application/pdf',
    })),
  });
  return { ok: true, messageId: info && info.messageId ? info.messageId : null };
}

/**
 * @param {object} p
 * @param {string|string[]} p.to
 * @param {string|string[]} [p.cc]
 * @param {string} p.subject
 * @param {string} p.html
 * @param {Array<{filename:string, buffer:Buffer, contentType?:string}>} [p.attachments]
 * @param {string} [p.event]   key from config/emailEvents.config.js - applies the Email Settings
 *                             master (extra CC, custom text, extra files). Client 17-10-2026.
 * @param {{module:string, id:number, number?:string}} [p.ref]  record the e-mail is about
 *                             (Email History + "BDM / Underwriter on the case" CC)
 * @param {object} [p.vars]    values for the custom-text placeholders
 * @param {boolean} [p.applyRules=true]  false = skip the extra CC (2nd+ copy of a one-per-person e-mail)
 * @param {object} [p.req]     request (sender for the log / "User who sends" CC)
 * @returns {Promise<{ ok:boolean, messageId?:string, error?:string }>}
 */
async function sendMail({ to, cc, subject, html, attachments = [], event, ref, vars, applyRules = true, req }) {
  let toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  let ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : [];

  // Email Settings master (client 17-10-2026). Never blocks the send - see emailHub.prepare.
  if (event) {
    const p = await hub.prepare({ event, ref, to: toList, cc: ccList, subject, html, attachments, vars, applyRules, req });
    ({ subject, html, attachments } = p);
    toList = p.to; ccList = p.cc;
  }

  const mailbox = config.graph && config.graph.mailbox;
  const graphReady = !!(mailbox && config.graph.clientId && config.graph.clientSecret && config.graph.tenantId);
  const smtpReady = !!(config.email.host && config.email.user && config.email.pass);
  const transport = graphReady ? 'graph' : (smtpReady ? 'smtp' : null);

  let result;
  const sentAfter = new Date();
  if (!toList.length) result = { ok: false, error: 'No recipient address' };
  else {
    try {
      if (graphReady) result = await sendViaGraph({ mailbox, toList, ccList, subject, html, attachments });
      else if (smtpReady) result = await sendViaSmtp({ toList, ccList, subject, html, attachments });
      else result = { ok: false, error: 'No email transport configured (set OUTLOOK_MAILBOX+MS_* or EMAIL_HOST/USER/PASS)' };
    } catch (e) {
      result = { ok: false, error: (e && (e.message || e.body)) ? String(e.message || e.body).slice(0, 500) : 'sendMail failed' };
    }
  }

  // Email History (client 17-10-2026): every e-mail, sent or failed. Never throws.
  const logId = await hub.log({ event, ref, to: toList, cc: ccList, subject, html, attachments, result, transport, req });

  // Replies to "Information required" e-mails are matched back to the case (client 17-10-2026):
  // remember the sent message's conversation / message ids. Background, never blocks the send.
  if (logId && result && result.ok && transport === 'graph' && emailReply.isTracked(event)) {
    emailReply.captureSentIds({ logId, mailbox, subject, to: toList[0], sentAfter }).catch(() => {});
  }
  return result;
}

module.exports = { sendMail };
