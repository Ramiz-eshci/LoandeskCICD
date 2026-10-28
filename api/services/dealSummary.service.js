'use strict';

/**
 * Credit Deal Summary e-mail (client 29-09-2026).
 *
 * "When a deal enters the applications stage and is checked by the bosses before
 *  underwriting, they need a summary document in their inbox, with an option to add
 *  narrative notes first." -> on Convert to Application the summary PDF is built,
 * saved on the application (Documents) and e-mailed to every active user whose role
 * holds APPLICATIONS.HEAD_OF_APPLICATION.view ("Head of Application").
 * Best-effort: a failure here never blocks the conversion.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const notifications = require('./notification.service');
const audit = require('./audit.service');
const { config } = require('../config/env');
const { buildDealSummaryPdf, summaryFigures } = require('./pdf/deal-summary-pdf.service');
const { securityMapLinks } = require('./mapLinks.service');

const HEAD_MODULE = 'APPLICATIONS.HEAD_OF_APPLICATION';
const HEAD_UW_MODULE = 'UNDERWRITING.HEAD_OF_UNDERWRITING';

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = (v) => (v == null || !Number.isFinite(Number(v)) ? '-' : '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Active users (id, name, email) whose role holds Head of Application. */
async function headOfApplicationUsers() {
  // A user counts when ANY of their roles holds the permission - the primary role on
  // users.role_id OR any extra role in user_roles (multi-role users).
  const rows = await db.query(
    `SELECT DISTINCT u.user_id, u.full_name, u.email
       FROM users u
      WHERE u.flag_deleted = 0 AND u.is_active = 1
        AND EXISTS (
          SELECT 1
            FROM role_permissions rp
            JOIN permissions p ON p.permission_id = rp.permission_id
            JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
           WHERE p.module_key = @p0 AND p.permission_key = 'view'
             AND (rp.role_id = u.role_id
                  OR rp.role_id IN (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.user_id)))`,
    [HEAD_MODULE]);
  // one entry per e-mail address (two users sharing an inbox get one copy)
  const seen = new Set();
  return rows.filter((r) => {
    const em = String(r.email || '').trim().toLowerCase();
    if (!em.includes('@') || seen.has(em)) return false;
    seen.add(em);
    return true;
  });
}

/**
 * Active users (id, name, email) whose role holds Head of Underwriting
 * (UNDERWRITING.HEAD_OF_UNDERWRITING.view). Recipients of the final credit paper
 * sent from the Final Credit Committee step. Same rule as headOfApplicationUsers.
 */
async function headOfUnderwritingUsers() {
  const rows = await db.query(
    `SELECT DISTINCT u.user_id, u.full_name, u.email
       FROM users u
      WHERE u.flag_deleted = 0 AND u.is_active = 1
        AND EXISTS (
          SELECT 1
            FROM role_permissions rp
            JOIN permissions p ON p.permission_id = rp.permission_id
            JOIN roles r ON r.role_id = rp.role_id AND r.flag_deleted = 0 AND r.is_active = 1
           WHERE p.module_key = @p0 AND p.permission_key = 'view'
             AND (rp.role_id = u.role_id
                  OR rp.role_id IN (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.user_id)))`,
    [HEAD_UW_MODULE]);
  const seen = new Set();
  return rows.filter((r) => {
    const em = String(r.email || '').trim().toLowerCase();
    if (!em.includes('@') || seen.has(em)) return false;
    seen.add(em);
    return true;
  });
}

async function saveOnApplication(applicationId, fileName, buf, uid) {

  const DOC_DIR = path.join('uploads', 'application_documents');
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = Date.now() + '_' + fileName.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buf);
  const t = await db.query(`SELECT TOP 1 document_type_id AS id FROM document_types WHERE code = 'DEAL_SUMMARY'`);
  await db.query(
    `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
     VALUES (@p0, @p1, @p2, @p3, 'Uploaded', 'v1', @p4, @p4)`,
    [applicationId, t.length ? t[0].id : null, fileName, path.join(DOC_DIR, safe), uid]);
}

/**
 * Build + save + e-mail the summary.
 * @returns {Promise<{ok:boolean, sentTo:number, error?:string}>}
 */
async function sendDealSummary({ applicationId, applicationRef, enquiry, terms, narrative, req }) {
  const e = enquiry || {};
  const uid = req && req.userData ? req.userData.userId : null;
  let broker = null;
  if (e.broker_id) {
    try { broker = (await db.query('SELECT * FROM brokers WHERE broker_id = @p0', [e.broker_id]))[0] || null; } catch (_) { broker = null; }
  }
  let preparedBy = null;
  if (uid) {
    try { preparedBy = ((await db.query('SELECT full_name FROM users WHERE user_id = @p0', [uid]))[0] || {}).full_name || null; } catch (_) { /* ignore */ }
  }
  // A clickable Google Maps link for the main security and every other security.
  const secList = [
    { label: 'Security 1', link: e.map_link, address: e.property_address, postcode: e.postcode },
    ...(Array.isArray(e.additional_securities) ? e.additional_securities : []).map((x, i) => ({
      label: `Security ${i + 2}`, link: x && x.map_link, address: x && (x.address || x.property_address || x.description), postcode: x && x.postcode,
    })),
  ].filter((x) => x.link || x.address || x.postcode);
  if (secList.length === 1) secList[0].label = 'Security';
  const maps = securityMapLinks(secList);
  const buf = await buildDealSummaryPdf(e, terms || {}, { applicationRef, narrative, broker, preparedBy, maps });
  const borrower = e.company_name || e.applicant_name || 'Borrower';
  const fileName = `Credit Deal Summary - ${applicationRef} - ${borrower}.pdf`.replace(/[\\/:*?"<>|]+/g, ' ');

  try { await saveOnApplication(applicationId, fileName, buf, uid); } catch (err) {
    console.error(`[deal-summary] not saved on application ${applicationId}: ${err.message}`);
  }

  const heads = await headOfApplicationUsers();
  if (!heads.length) {
    console.warn('[deal-summary] no active user holds Head of Application - summary saved, not e-mailed');
    return { ok: false, sentTo: 0, error: 'No user has the Head of Application permission' };
  }

  const f = summaryFigures(e, terms || {});
  // Client 15-10-2026: every security (main + other securities) on its own line.
  const secAddrs = secList.map((x) => [x.address, x.postcode].map((v) => String(v || '').trim()).filter(Boolean)
    .filter((v, i, arr) => i === 0 || !arr[0].toUpperCase().replace(/\s/g, '').includes(v.toUpperCase().replace(/\s/g, '')))
    .join(', ')).filter(Boolean);
  const link = String(config.frontUrl || '').replace(/\/?$/, '/') + 'applications/' + applicationId;
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  const notesText = narrative && String(narrative).trim() ? String(narrative).trim() : '';
  const varsFor = (h) => ({
    Ref: applicationRef, EnquiryRef: e.enquiry_ref, Borrower: borrower, SecurityAddress: secAddrs.join('; '),
    RecipientName: h.full_name || '', RecipientFirstName: String(h.full_name || '').split(' ')[0] || 'there',
    SecurityLabel: secAddrs.length > 1 ? 'Securities' : 'Security',
    SecurityLines: secAddrs.length > 1 ? secAddrs.map((a, i) => `${i + 1}. ${esc(a)}`).join('<br>') : esc(secAddrs[0] || '-'),
    GrossLoan: gbp(f.gross), FileOwner: e.assigned_to_name || '-', Notes: notesText, Link: link,
    NotesBlock: notesText ? `<p style="margin-top:14px"><b>Notes:</b><br>${esc(notesText).replace(/\n/g, '<br>')}</p>` : '',
  });
  // Client 29-09-2026: one SEPARATE e-mail per Head of Application user (not one e-mail
  // with everyone in To), so each gets their own copy and one bad address cannot stop the rest.
  const results = [];
  for (const [i, h] of heads.entries()) {
    const mailVars = varsFor(h);
    const { subject, html } = emailHub.render('APPLICATION_DEAL_SUMMARY', mailVars);
    // eslint-disable-next-line no-await-in-loop
    const r = await mail.sendMail({
      to: h.email,
      subject,
      html,
      attachments: [{ filename: fileName, buffer: buf, contentType: 'application/pdf' }],
      // Email Settings master + Email History (client 17-10-2026). Extra CC on the first copy only.
      event: 'APPLICATION_DEAL_SUMMARY', ref: { module: 'APPLICATION', id: applicationId, number: applicationRef }, req, applyRules: i === 0,
      vars: mailVars,
    });
    results.push({ email: h.email, ok: !!r.ok, error: r.ok ? undefined : r.error });
    if (!r.ok) console.error(`[deal-summary] e-mail to ${h.email} failed for application ${applicationId}: ${r.error}`);
  }
  const okList = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const sent = { ok: okList.length > 0, error: bad.length ? bad.map((b) => `${b.email}: ${b.error}`).join('; ') : undefined };
  try {
    await notifications.createMany(heads.map((h) => h.user_id), {
      title: `Deal summary: ${applicationRef} – ${borrower}`,
      body: 'New application ready for review before underwriting. Summary e-mailed.',
      type: 'APPLICATION_SUMMARY', link: '/applications/' + applicationId, entityId: applicationId,
    }, uid);
  } catch (err) { console.error('[deal-summary] notification failed: ' + err.message); }
  try {
    await audit.write(audit.fromReq(req, {
      action: sent.ok ? 'APPLICATION_SUMMARY_SENT' : 'APPLICATION_SUMMARY_FAILED', moduleKey: 'APPLICATIONS',
      entityName: 'applications', entityId: String(applicationId),
      details: { sent_to: okList.map((r) => r.email), failed: bad.length ? bad : undefined, narrative: narrative || undefined },
    }));
  } catch (err) { console.error('[deal-summary] audit failed: ' + err.message); }
  return { ok: okList.length > 0, sentTo: okList.length, failed: bad.length, error: sent.error };
}

module.exports = { sendDealSummary, headOfApplicationUsers, headOfUnderwritingUsers, HEAD_MODULE, HEAD_UW_MODULE };
