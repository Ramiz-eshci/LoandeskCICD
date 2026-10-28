'use strict';

/**
 * Masters > Email Settings and Email History (client 17-10-2026).
 * See config/emailEvents.config.js for the list of e-mails and services/emailHub.service.js
 * for how the settings are applied when an e-mail is sent.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const audit = require('./audit.service');
const hub = require('./emailHub.service');
const { EVENTS, MODULES, DYNAMIC, varsFor, htmlVarsFor } = require('../config/emailEvents.config');
const { TEMPLATES } = require('../config/emailTemplates');
const { own } = require('../utils/own');

const MODULE_KEY = 'MASTERS.EMAIL_SETTINGS';
const MAX_FILE = 20 * 1024 * 1024;   // one extra attachment (20 MB, client 22-10-2026)
const MAX_TOTAL = 40 * 1024 * 1024;  // all extra attachments of one e-mail
const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.png', '.jpg', '.jpeg'];
const MIME = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};
const uid = (req) => (req && req.userData ? req.userData.userId : null);
const configurable = (key) => !!(own(EVENTS, key) && !EVENTS[key].system);

/** Sample values for Preview (plain values + the ready-made HTML blocks). */
const SAMPLE = {
  Ref: 'ENQ-000123', EnquiryRef: 'ENQ-000123', LoanNumber: 'LN-000045', Borrower: 'Sample Developments Ltd',
  SecurityAddress: '12 High Street, Edinburgh, EH1 1AA', RecipientName: 'Jane Smith', RecipientFirstName: 'Jane',
  RequestedItems: 'Bank statements, Proof of ID', DueDate: '2026-10-31', Notes: 'Sample note typed by the sender.',
  Link: 'https://loandesk.example/applications/1', NewMaturity: '31 January 2027', ExtensionMonths: '3',
  RedemptionAmount: '£250,000.00', RedemptionDate: '30 November 2026', GrossLoan: '£500,000.00', FileOwner: 'Sample BDM',
  BDMName: 'Sample BDM', UnderwriterName: 'Sample Underwriter', SenderName: 'Sample Sender', Today: '17/10/2026',
  ForBorrower: ' for Sample Developments Ltd', SecurityInBrackets: ' (12 High Street, Edinburgh, EH1 1AA)',
  SecurityLabel: 'Security', SecurityLines: '12 High Street, Edinburgh, EH1 1AA',
  FiguresTable: '<table style="border-collapse:collapse;border:1px solid #c8d8e8;font-family:Arial,sans-serif;font-size:13px;min-width:420px">'
    + '<tr><td colspan="2" style="padding:10px 12px;background:#0f2244;color:#ffffff;font-weight:700;font-size:14px">Applicant: Sample Developments Ltd</td></tr>'
    + '<tr><td colspan="2" style="padding:10px 12px;background:#0f2244;color:#ffffff;font-weight:700;font-size:14px;line-height:1.4">Security Address: 12 High Street, Edinburgh, EH1 1AA</td></tr>'
    + '<tr><td style="padding:6px 12px;color:#0f2244">Gross Loan</td><td style="padding:6px 12px;text-align:right;color:#0f2244">£500,000.00</td></tr>'
    + '<tr><td style="padding:6px 12px;font-weight:700;color:#b00020">Total Net</td><td style="padding:6px 12px;text-align:right;font-weight:700;color:#b00020">£460,000.00</td></tr></table>',
  SecurityBlock: '<p><strong>Security address:</strong> 12 High Street, Edinburgh, EH1 1AA</p>',
  RequestedItemsList: '<ul><li>Bank statements</li><li>Proof of ID</li></ul>',
  DueDateBlock: '<p><strong>Please respond by:</strong> 2026-10-31</p>',
  NotesBlock: '<p><strong>Notes:</strong><br>Sample note typed by the sender.</p>',
  RequirementsDetails: '<p><b>Valuation</b><br>Sample valuation requirement.</p>',
  AlsoAttachedList: '<p>Also attached:</p><ul><li>Sample file.pdf</li></ul>',
};

/** Compare a submitted template with the default, ignoring editor formatting noise. */
const normTpl = (h) => String(h || '').replace(/<br\s*\/?>/gi, '<br>').replace(/&nbsp;/g, ' ')
  .replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
const hasText = (h) => !!String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/* ------------------------------------------------------------------ settings */

async function list() {
  const settings = await db.query('SELECT event_key, include_default_cc, subject_template, body_template, updated_at FROM email_event_settings');
  const rules = await db.query(
    `SELECT r.event_key, r.rule_type, r.dynamic_key, u.full_name, ro.role_name
       FROM email_event_cc_rules r
       LEFT JOIN users u ON u.user_id = r.user_id
       LEFT JOIN roles ro ON ro.role_id = r.role_id`);
  const files = await db.query(
    'SELECT event_key, COUNT(*) AS n FROM email_event_attachments WHERE flag_deleted = 0 GROUP BY event_key');
  const sMap = new Map(settings.map((s) => [s.event_key, s]));
  const fMap = new Map(files.map((f) => [f.event_key, f.n]));
  return Object.entries(EVENTS).filter(([, e]) => !e.system).map(([key, e]) => {
    const s = sMap.get(key);
    const mine = rules.filter((r) => r.event_key === key);
    const extraCc = mine.map((r) => (r.rule_type === 'USER' ? r.full_name
      : r.rule_type === 'ROLE' ? `Role: ${r.role_name}` : DYNAMIC[r.dynamic_key])).filter(Boolean);
    return {
      event_key: key, module: e.module, module_name: MODULES[e.module], name: e.name, description: e.desc,
      to: e.to, default_cc: e.defaultCc, cc_from_user: !!e.ccFromUser,
      keep_default_cc: s ? !!s.include_default_cc : true,
      extra_cc: extraCc,
      custom_subject: !!(s && s.subject_template), custom_body: !!(s && s.body_template),
      extra_files: Number(fMap.get(key) || 0),
      updated_at: s ? s.updated_at : null,
    };
  });
}

async function options() {
  const users = await db.query(
    `SELECT user_id, full_name, email FROM users WHERE is_active = 1 AND flag_deleted = 0 ORDER BY full_name`);
  const roles = await db.query(
    `SELECT role_id, role_name FROM roles WHERE flag_deleted = 0 AND ISNULL(is_active, 1) = 1 ORDER BY role_name`);
  return {
    users, roles,
    dynamic: Object.entries(DYNAMIC).map(([key, label]) => ({ key, label })),
    modules: Object.entries(MODULES).map(([key, label]) => ({ key, label })),
    events: Object.entries(EVENTS).map(([key, e]) => ({ key, name: e.name, module: e.module })),
  };
}

async function get(key) {
  if (!configurable(key)) return null;
  const e = EVENTS[key];
  const [s] = await db.query('SELECT include_default_cc, subject_template, body_template, updated_at, updated_by FROM email_event_settings WHERE event_key = @p0', [key]);
  const rules = await db.query('SELECT rule_type, user_id, role_id, dynamic_key FROM email_event_cc_rules WHERE event_key = @p0 ORDER BY rule_id', [key]);
  const files = await db.query(
    `SELECT attachment_id, file_name, content_type, size_bytes, created_at FROM email_event_attachments
      WHERE event_key = @p0 AND flag_deleted = 0 ORDER BY attachment_id`, [key]);
  return {
    event_key: key, module: e.module, module_name: MODULES[e.module], name: e.name, description: e.desc,
    to: e.to, default_cc: e.defaultCc, cc_from_user: !!e.ccFromUser,
    placeholders: varsFor(key), html_placeholders: htmlVarsFor(key),
    keep_default_cc: s ? !!s.include_default_cc : true,
    // custom text ('' = the default below is used); the screen opens with custom || default
    subject_template: s ? s.subject_template || '' : '',
    body_template: s ? s.body_template || '' : '',
    default_subject: TEMPLATES[key] ? TEMPLATES[key].subject : '',
    default_body: TEMPLATES[key] ? TEMPLATES[key].body : '',
    user_ids: rules.filter((r) => r.rule_type === 'USER').map((r) => r.user_id),
    role_ids: rules.filter((r) => r.rule_type === 'ROLE').map((r) => r.role_id),
    dynamic_keys: rules.filter((r) => r.rule_type === 'DYNAMIC').map((r) => r.dynamic_key),
    attachments: files,
    updated_at: s ? s.updated_at : null,
  };
}

const intList = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

async function save(key, body = {}, req) {
  if (!configurable(key)) return { notFound: true };
  const errors = {};
  const def = TEMPLATES[key] || { subject: '', body: '' };
  let subject = String(body.subject_template || '').trim();
  let html = hub.sanitizeHtml(body.body_template || '');
  // Same as the default (or blank) = not customised: stored as NULL so the default applies.
  if (normTpl(subject) === normTpl(def.subject)) subject = '';
  if (!hasText(html) || normTpl(html) === normTpl(def.body)) html = '';
  const bodyText = html;
  if (subject.length > 500) errors.subject_template = 'Subject must be 500 characters or less';
  if (html.length > 200000) errors.body_template = 'Email text is too long';
  const badS = hub.unknownPlaceholders(key, subject);
  const badB = hub.unknownPlaceholders(key, html);
  if (badS.length) errors.subject_template = `Unknown placeholder(s): ${badS.map((n) => '{{' + n + '}}').join(', ')}`;
  if (badB.length) errors.body_template = `Unknown placeholder(s): ${badB.map((n) => '{{' + n + '}}').join(', ')}`;

  const userIds = intList(body.user_ids);
  const roleIds = intList(body.role_ids);
  const dyn = [...new Set((Array.isArray(body.dynamic_keys) ? body.dynamic_keys : []).map(String))];
  const badDyn = dyn.filter((d) => !DYNAMIC[d]);
  if (badDyn.length) errors.dynamic_keys = 'Unknown option: ' + badDyn.join(', ');
  if (userIds.length) {
    const ph = userIds.map((_, i) => '@p' + i).join(',');
    const found = await db.query(`SELECT user_id FROM users WHERE user_id IN (${ph}) AND flag_deleted = 0`, userIds);
    if (found.length !== userIds.length) errors.user_ids = 'One or more users no longer exist';
  }
  if (roleIds.length) {
    const ph = roleIds.map((_, i) => '@p' + i).join(',');
    const found = await db.query(`SELECT role_id FROM roles WHERE role_id IN (${ph}) AND flag_deleted = 0`, roleIds);
    if (found.length !== roleIds.length) errors.role_ids = 'One or more roles no longer exist';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const keep = body.keep_default_cc === false || body.keep_default_cc === 'false' || body.keep_default_cc === 0 ? 0 : 1;
  const prev = await get(key);
  await db.query(
    `MERGE email_event_settings AS t
     USING (SELECT @p0 AS event_key) AS s ON t.event_key = s.event_key
     WHEN MATCHED THEN UPDATE SET include_default_cc = @p1, subject_template = @p2, body_template = @p3, updated_by = @p4, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (event_key, include_default_cc, subject_template, body_template, updated_by)
          VALUES (@p0, @p1, @p2, @p3, @p4);`,
    [key, keep, subject || null, bodyText ? html : null, uid(req)]);
  await db.query('DELETE FROM email_event_cc_rules WHERE event_key = @p0', [key]);
  const rows = [
    ...userIds.map((id) => ['USER', id, null, null]),
    ...roleIds.map((id) => ['ROLE', null, id, null]),
    ...dyn.map((d) => ['DYNAMIC', null, null, d]),
  ];
  for (const [type, userId, roleId, dk] of rows) {
    // eslint-disable-next-line no-await-in-loop
    await db.query(
      'INSERT INTO email_event_cc_rules (event_key, rule_type, user_id, role_id, dynamic_key, created_by) VALUES (@p0, @p1, @p2, @p3, @p4, @p5)',
      [key, type, userId, roleId, dk, uid(req)]);
  }
  hub.invalidate(key);
  await audit.write(audit.fromReq(req, {
    action: 'EMAIL_SETTINGS_UPDATED', moduleKey: MODULE_KEY, entityName: 'email_event_settings', entityId: key,
    details: {
      keep_default_cc: !!keep, users: userIds, roles: roleIds, dynamic: dyn,
      subject_changed: (prev && prev.subject_template) !== (subject || ''), body_changed: (prev && prev.body_template) !== (bodyText ? html : ''),
    },
  }));
  return { ok: true, data: await get(key) };
}

function preview(key, body = {}) {
  if (!configurable(key)) return null;
  const def = TEMPLATES[key];
  const subject = String(body.subject_template || '').trim() || def.subject;
  const html = hasText(body.body_template) ? hub.sanitizeHtml(body.body_template) : def.body;
  return {
    subject: hub.renderText(subject, SAMPLE),
    html: hub.renderHtml(html, SAMPLE, htmlVarsFor(key)),
    unknown: hub.unknownPlaceholders(key, subject, html),
  };
}

/* ------------------------------------------------------------------ extra attachments */

async function addAttachment(key, body = {}, req) {
  if (!configurable(key)) return { notFound: true };
  const name = path.basename(String(body.file_name || '')).trim().slice(0, 200);
  const ext = path.extname(name).toLowerCase();
  if (!name) return { ok: false, errors: { file: 'Choose a file' } };
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, errors: { file: `File type not allowed. Allowed: ${ALLOWED_EXT.join(', ')}` } };
  const b64 = String(body.content_base64 || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { ok: false, errors: { file: 'The file is empty' } };
  if (buf.length > MAX_FILE) return { ok: false, errors: { file: 'File must be 20 MB or smaller' } };
  const [{ total }] = await db.query(
    'SELECT ISNULL(SUM(size_bytes), 0) AS total FROM email_event_attachments WHERE event_key = @p0 AND flag_deleted = 0', [key]);
  if (Number(total) + buf.length > MAX_TOTAL) return { ok: false, errors: { file: 'Extra files for one e-mail must be 40 MB or less in total' } };

  const dirAbs = path.join(hub.baseDir(), hub.ATTACH_DIR);
  if (!fs.existsSync(dirAbs)) fs.mkdirSync(dirAbs, { recursive: true });
  const safe = `${key}_${Date.now()}_${name.replace(/[^\w.\-]+/g, '_')}`;
  fs.writeFileSync(path.join(dirAbs, safe), buf);
  const rel = path.join(hub.ATTACH_DIR, safe).replace(/\\/g, '/');
  const [row] = await db.query(
    `INSERT INTO email_event_attachments (event_key, file_name, file_path, content_type, size_bytes, created_by)
     OUTPUT INSERTED.attachment_id AS id VALUES (@p0, @p1, @p2, @p3, @p4, @p5)`,
    [key, name, rel, MIME[ext] || 'application/octet-stream', buf.length, uid(req)]);
  hub.invalidate(key);
  await audit.write(audit.fromReq(req, {
    action: 'EMAIL_ATTACHMENT_ADDED', moduleKey: MODULE_KEY, entityName: 'email_event_attachments', entityId: String(row.id),
    details: { event_key: key, file_name: name, size: buf.length },
  }));
  return { ok: true, id: row.id };
}

async function removeAttachment(key, id, req) {
  const rows = await db.query(
    'UPDATE email_event_attachments SET flag_deleted = 1 OUTPUT INSERTED.file_name WHERE attachment_id = @p0 AND event_key = @p1 AND flag_deleted = 0',
    [id, key]);
  if (!rows.length) return { notFound: true };
  hub.invalidate(key);
  await audit.write(audit.fromReq(req, {
    action: 'EMAIL_ATTACHMENT_REMOVED', moduleKey: MODULE_KEY, entityName: 'email_event_attachments', entityId: String(id),
    details: { event_key: key, file_name: rows[0].file_name },
  }));
  return { ok: true };
}

async function getAttachment(key, id) {
  const [r] = await db.query(
    'SELECT file_name, file_path FROM email_event_attachments WHERE attachment_id = @p0 AND event_key = @p1 AND flag_deleted = 0', [id, key]);
  return r || null;
}

/* ------------------------------------------------------------------ history */

/** WHERE clause + params for the history filters. */
function historyWhere(q = {}) {
  const where = ['1 = 1'];
  const p = [];
  const add = (sql, v) => { where.push(sql.replace(/\?/g, () => '@p' + p.length)); p.push(v); };
  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to) : null;
  if (from && !Number.isNaN(from.getTime())) add('l.sent_at >= ?', from);
  if (to && !Number.isNaN(to.getTime())) add('l.sent_at < ?', to);
  if (q.module && own(MODULES, q.module)) add('l.module = ?', q.module);
  if (q.event && own(EVENTS, q.event)) add('l.event_key = ?', q.event);
  if (q.status === 'Sent' || q.status === 'Failed') add('l.status = ?', q.status);
  if (q.record_id && Number(q.record_id) > 0) add('l.record_id = ?', Number(q.record_id));
  const s = String(q.search || '').trim().slice(0, 100);
  if (s) {
    const n = p.length;
    where.push(`(l.record_ref LIKE @p${n} OR l.to_list LIKE @p${n} OR l.cc_list LIKE @p${n} OR l.subject LIKE @p${n})`);
    p.push('%' + s.replace(/[%_[]/g, '[$&]') + '%');
  }
  return { where: where.join(' AND '), params: p };
}

async function history(q = {}) {
  const page = Math.max(1, Number(q.page) || 1);
  const per = Math.min(100, Math.max(1, Number(q.per_page) || 20));
  const { where, params } = historyWhere(q);
  const rows = await db.query(
    `SELECT l.email_log_id, l.event_key, l.module, l.record_id, l.record_ref, l.to_list, l.cc_list, l.subject,
            l.attachments, l.status, l.error, l.sent_at, u.full_name AS sent_by_name
       FROM email_log l LEFT JOIN users u ON u.user_id = l.sent_by
      WHERE ${where}
      ORDER BY l.sent_at DESC, l.email_log_id DESC
      OFFSET ${(page - 1) * per} ROWS FETCH NEXT ${per} ROWS ONLY`, params);
  const [sum] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN l.status = 'Sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN l.status = 'Failed' THEN 1 ELSE 0 END) AS failed,
            COUNT(DISTINCT l.record_ref) AS records
       FROM email_log l WHERE ${where}`, params);
  const byModule = await db.query(
    `SELECT ISNULL(l.module, 'OTHER') AS module, COUNT(*) AS n FROM email_log l WHERE ${where} GROUP BY l.module ORDER BY n DESC`, params);
  const total = Number(sum && sum.total) || 0;
  return {
    rows: rows.map((r) => ({
      ...r, module_name: MODULES[r.module] || r.module || '-', event_name: EVENTS[r.event_key] ? EVENTS[r.event_key].name : (r.event_key || '-'),
    })),
    meta: { page, per_page: per, total, total_pages: Math.max(1, Math.ceil(total / per)) },
    summary: {
      total, sent: Number(sum && sum.sent) || 0, failed: Number(sum && sum.failed) || 0, records: Number(sum && sum.records) || 0,
      by_module: byModule.map((m) => ({ module: m.module, module_name: MODULES[m.module] || m.module, count: m.n })),
    },
  };
}

async function historyItem(id) {
  const [r] = await db.query(
    `SELECT l.*, u.full_name AS sent_by_name FROM email_log l LEFT JOIN users u ON u.user_id = l.sent_by
      WHERE l.email_log_id = @p0`, [id]);
  if (!r) return null;
  return { ...r, module_name: MODULES[r.module] || r.module || '-', event_name: EVENTS[r.event_key] ? EVENTS[r.event_key].name : (r.event_key || '-') };
}

module.exports = {
  list, options, get, save, preview, addAttachment, removeAttachment, getAttachment, history, historyItem, historyWhere,
  MODULE_KEY,
};
