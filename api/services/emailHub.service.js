'use strict';

/**
 * Email hub (client 17-10-2026) - sits between the code that builds an e-mail and the
 * transport in mail.service:
 *
 *   render()   builds the default subject + body from config/emailTemplates.js (the code uses
 *              this, so the default e-mail and the text pre-filled on the settings screen match)
 *   prepare()  applies the Email Settings master for the e-mail's event key:
 *                - extra CC: users, roles (every active user in the role), dynamic people
 *                  (BDM / Underwriter on the case, the sender)
 *                - "Keep system CC" off -> the CC the code built is dropped (not for e-mails
 *                  whose CC the user types in the popup, see ccFromUser)
 *                - custom subject / body with {{Placeholders}} (same values the default template uses)
 *                - extra attachments added after the system ones
 *   log()      writes every e-mail (sent or failed) to email_log for Email History.
 *
 * Nothing here may stop an e-mail going out: a settings / lookup failure falls back to the
 * e-mail exactly as the code built it, and a log failure is only written to the app log.
 */

const xss = require('xss');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../utils/logger');
const { EVENTS, varsFor, htmlVarsFor } = require('../config/emailEvents.config');
const { TEMPLATES } = require('../config/emailTemplates');

const ATTACH_DIR = path.join('uploads', 'email_attachments');
const CACHE_MS = 30 * 1000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const baseDir = () => global.basePath || path.join(__dirname, '..');
const lc = (s) => String(s || '').trim().toLowerCase();

/* ------------------------------------------------------------------ text helpers */

const escHtml = (t) => String(t === null || t === undefined ? '' : t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PH_RE = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/** Placeholder names used in a template, in order, unique. */
function placeholdersIn(text) {
  const out = [];
  String(text || '').replace(PH_RE, (_, n) => { if (!out.includes(n)) out.push(n); return _; });
  return out;
}

/** Placeholders in the text that the event does not supply. */
function unknownPlaceholders(eventKey, ...texts) {
  const allowed = new Set(varsFor(eventKey));
  const bad = [];
  texts.forEach((t) => placeholdersIn(t).forEach((n) => { if (!allowed.has(n) && !bad.includes(n)) bad.push(n); }));
  return bad;
}

/**
 * Body: values are HTML-escaped (new lines -> <br>); names in rawKeys are ready-made HTML
 * blocks built by the code and go in as-is.
 */
function renderHtml(tpl, vars, rawKeys = []) {
  const raw = new Set(rawKeys);
  return String(tpl || '').replace(PH_RE, (_, n) => {
    const v = vars[n];
    if (raw.has(n)) return v === null || v === undefined ? '' : String(v);
    return escHtml(v).replace(/\r?\n/g, '<br>');
  });
}

/** Subject: plain text, one line; a " — " / " – " next to an empty value is dropped. */
function renderText(tpl, vars) {
  return String(tpl || '').replace(PH_RE, (_, n) => (vars[n] === null || vars[n] === undefined ? '' : String(vars[n])))
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*[\u2014\u2013]\s*(?=[\u2014\u2013]|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Default subject + body for an event (config/emailTemplates.js) filled with vars. */
function render(eventKey, vars = {}) {
  const t = TEMPLATES[eventKey];
  if (!t) throw new Error('No default e-mail template for ' + eventKey);
  return { subject: renderText(t.subject, vars), html: renderHtml(t.body, vars, t.html) };
}

/**
 * Body HTML typed on the Email Settings screen. Only formatting is kept.
 * Pen-test 24-10-2026: allow-list sanitizer (js-xss) instead of the old regexes, which
 * let through e.g. <svg/onload=...>, <img/src=x/onerror=...> and unquoted javascript:
 * links. Tags / attributes not listed are dropped; links must be http(s) / mailto / tel /
 * #anchor or a {{Placeholder}}; images https / data:image / cid.
 */
const GLOBAL_ATTRS = ['style', 'class', 'align', 'title'];
const tag = (...extra) => [...GLOBAL_ATTRS, ...extra];
const SAFE_TAGS = {
  p: tag(), br: tag(), div: tag(), span: tag(), b: tag(), strong: tag(), i: tag(), em: tag(), u: tag(), s: tag(),
  strike: tag(), sub: tag(), sup: tag(), small: tag(), font: tag('color', 'face', 'size'),
  h1: tag(), h2: tag(), h3: tag(), h4: tag(), h5: tag(), h6: tag(), blockquote: tag(), hr: tag(), pre: tag(), code: tag(),
  ul: tag(), ol: tag(), li: tag(),
  a: tag('href', 'name', 'target', 'rel'),
  img: tag('src', 'alt', 'width', 'height'),
  table: tag('border', 'cellpadding', 'cellspacing', 'width', 'bgcolor'),
  thead: tag(), tbody: tag(), tfoot: tag(), tr: tag(), caption: tag(), colgroup: tag(), col: tag('span', 'width'),
  td: tag('colspan', 'rowspan', 'valign', 'width', 'bgcolor'),
  th: tag('colspan', 'rowspan', 'valign', 'width', 'bgcolor'),
};
const PLACEHOLDER = /^\{\{\s*[A-Za-z0-9_]+\s*\}\}$/;
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#)/i;
const SAFE_SRC = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);|cid:)/i;

const HTML_FILTER = new xss.FilterXSS({
  whiteList: SAFE_TAGS,
  stripIgnoreTag: true, // drop tags that are not allowed (keep their text)
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select'],
  allowCommentTag: false,
  css: false, // keep inline styles as typed (style attributes cannot run script)
  onTagAttr(tagName, name, value) {
    if (name !== 'href' && name !== 'src') return undefined; // default handling
    const v = xss.friendlyAttrValue(String(value || '')).trim();
    const ok = PLACEHOLDER.test(v) || (name === 'href' ? SAFE_HREF.test(v) : SAFE_SRC.test(v));
    return ok ? `${name}="${xss.escapeAttrValue(v)}"` : '';
  },
});

function sanitizeHtml(html) {
  return HTML_FILTER.process(String(html || '')).replace(/\[removed\]/g, '').trim();
}

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/* ------------------------------------------------------------------ settings */

const cache = new Map(); // event_key -> { at, data }

/** Settings row + CC rules + attachments for one event (cached 30s). null when never configured. */
async function loadConfig(eventKey) {
  const hit = cache.get(eventKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const [s] = await db.query(
    'SELECT event_key, include_default_cc, subject_template, body_template FROM email_event_settings WHERE event_key = @p0', [eventKey]);
  const rules = await db.query(
    'SELECT rule_id, rule_type, user_id, role_id, dynamic_key FROM email_event_cc_rules WHERE event_key = @p0', [eventKey]);
  const files = await db.query(
    `SELECT attachment_id, file_name, file_path, content_type FROM email_event_attachments
      WHERE event_key = @p0 AND flag_deleted = 0 ORDER BY attachment_id`, [eventKey]);
  const data = (s || rules.length || files.length) ? { settings: s || null, rules, files } : null;
  cache.set(eventKey, { at: Date.now(), data });
  return data;
}

function invalidate(eventKey) {
  if (eventKey) cache.delete(eventKey); else cache.clear();
}

/* ------------------------------------------------------------------ people */

const ACTIVE = 'is_active = 1 AND flag_deleted = 0';
const userJoin = (alias, col) => `LEFT JOIN users ${alias} ON ${alias}.user_id = ${col} AND ${alias}.is_active = 1 AND ${alias}.flag_deleted = 0`;
const PEOPLE_SELECT = 'b.email AS bdm_email, b.full_name AS bdm_name, w.email AS uw_email, w.full_name AS uw_name';

/** BDM + underwriter of the record the e-mail is about. */
const PEOPLE_SQL = {
  ENQUIRY: `SELECT ${PEOPLE_SELECT} FROM enquiries e
      OUTER APPLY (SELECT TOP 1 underwriter_id FROM applications a WHERE a.enquiry_id = e.enquiry_id AND a.flag_deleted = 0 ORDER BY a.application_id DESC) a
      ${userJoin('b', 'e.assigned_to')} ${userJoin('w', 'a.underwriter_id')}
     WHERE e.enquiry_id = @p0`,
  APPLICATION: `SELECT ${PEOPLE_SELECT} FROM applications a
      ${userJoin('b', 'a.assigned_to')} ${userJoin('w', 'a.underwriter_id')}
     WHERE a.application_id = @p0`,
  UNDERWRITING: `SELECT ${PEOPLE_SELECT} FROM underwriting_cases uc
      LEFT JOIN applications a ON a.application_id = uc.application_id
      ${userJoin('b', 'a.assigned_to')} ${userJoin('w', 'COALESCE(uc.underwriter_id, a.underwriter_id)')}
     WHERE uc.underwriting_case_id = @p0`,
  EXTENSION: `SELECT ${PEOPLE_SELECT} FROM portfolio_extensions x
      LEFT JOIN loans l ON l.loan_id = x.loan_id
      LEFT JOIN applications a ON a.application_id = l.application_id
      ${userJoin('b', 'a.assigned_to')} ${userJoin('w', 'a.underwriter_id')}
     WHERE x.extension_id = @p0`,
  REDEMPTION: `SELECT ${PEOPLE_SELECT} FROM loans l
      LEFT JOIN applications a ON a.application_id = l.application_id
      ${userJoin('b', 'a.assigned_to')} ${userJoin('w', 'a.underwriter_id')}
     WHERE l.loan_id = @p0`,
};

async function resolvePeople(ref, req) {
  const out = { BDM: null, UNDERWRITER: null, SENDER: null };
  const uid = req && req.userData ? req.userData.userId : null;
  if (uid) {
    const [u] = await db.query(`SELECT email, full_name FROM users WHERE user_id = @p0 AND ${ACTIVE}`, [uid]);
    if (u) out.SENDER = { email: u.email, name: u.full_name };
  }
  const sql = ref && ref.module ? PEOPLE_SQL[ref.module] : null;
  if (sql && ref.id) {
    const [r] = await db.query(sql, [ref.id]);
    if (r) {
      if (r.bdm_email) out.BDM = { email: r.bdm_email, name: r.bdm_name };
      if (r.uw_email) out.UNDERWRITER = { email: r.uw_email, name: r.uw_name };
    }
  }
  return out;
}

/** E-mail addresses for the event's CC rules. */
async function ccFromRules(rules, people) {
  const out = [];
  const userIds = rules.filter((r) => r.rule_type === 'USER' && r.user_id).map((r) => Number(r.user_id));
  const roleIds = rules.filter((r) => r.rule_type === 'ROLE' && r.role_id).map((r) => Number(r.role_id));
  if (userIds.length) {
    const ph = userIds.map((_, i) => '@p' + i).join(',');
    (await db.query(`SELECT email FROM users WHERE user_id IN (${ph}) AND ${ACTIVE}`, userIds)).forEach((u) => out.push(u.email));
  }
  if (roleIds.length) {
    const ph = roleIds.map((_, i) => '@p' + i).join(',');
    (await db.query(
      `SELECT DISTINCT u.email FROM users u
        WHERE u.is_active = 1 AND u.flag_deleted = 0
          AND (u.role_id IN (${ph}) OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.role_id IN (${ph})))`,
      roleIds)).forEach((u) => out.push(u.email));
  }
  rules.filter((r) => r.rule_type === 'DYNAMIC').forEach((r) => {
    const p = people[r.dynamic_key];
    if (p && p.email) out.push(p.email);
  });
  return out;
}

/** Unique valid addresses, never one that is already in To. */
function dedupe(list, toList) {
  const seen = new Set(toList.map(lc));
  const out = [];
  list.forEach((a) => {
    const t = String(a || '').trim();
    const k = t.toLowerCase();
    if (!EMAIL_RE.test(t) || seen.has(k)) return;
    seen.add(k); out.push(t);
  });
  return out;
}

function readExtraFiles(files) {
  const out = [];
  (files || []).forEach((f) => {
    const abs = path.join(baseDir(), f.file_path);
    if (!fs.existsSync(abs)) { logger.warn(`[email-hub] extra attachment missing on disk: ${f.file_path}`); return; }
    out.push({ filename: f.file_name, buffer: fs.readFileSync(abs), contentType: f.content_type || undefined });
  });
  return out;
}

/* ------------------------------------------------------------------ prepare + log */

/**
 * Apply the Email Settings master to one outgoing e-mail.
 * @param {object} p  { event, ref:{module,id,number}, to[], cc[], subject, html, attachments[],
 *                      vars, applyRules (false = no extra CC, e.g. 2nd+ copy of a per-person mail), req }
 * @returns {Promise<{to:string[], cc:string[], subject:string, html:string, attachments:Array}>}
 */
async function prepare(p) {
  const out = { to: p.to, cc: p.cc, subject: p.subject, html: p.html, attachments: p.attachments || [] };
  const ev = EVENTS[p.event];
  if (!ev || ev.system) return out;
  try {
    const conf = await loadConfig(p.event);
    if (!conf) return out; // never configured: e-mail goes exactly as the code built it
    const needPeople = conf.rules.some((r) => r.rule_type === 'DYNAMIC')
      || !!(conf.settings && (conf.settings.subject_template || conf.settings.body_template));
    const people = needPeople ? await resolvePeople(p.ref, p.req) : {};

    let cc = out.cc;
    if (conf.settings && !conf.settings.include_default_cc && !ev.ccFromUser) cc = [];
    if (p.applyRules !== false && conf.rules.length) cc = cc.concat(await ccFromRules(conf.rules, people));
    out.cc = dedupe(cc, out.to);

    const s = conf.settings || {};
    if (s.subject_template || s.body_template) {
      const vars = {
        ...(p.vars || {}),
        BDMName: people.BDM ? people.BDM.name : '',
        UnderwriterName: people.UNDERWRITER ? people.UNDERWRITER.name : '',
        SenderName: people.SENDER ? people.SENDER.name : '',
        Today: today(),
      };
      if (s.subject_template) out.subject = renderText(s.subject_template, vars) || p.subject;
      if (s.body_template) out.html = renderHtml(s.body_template, vars, htmlVarsFor(p.event));
    }
    if (conf.files.length) out.attachments = out.attachments.concat(readExtraFiles(conf.files));
  } catch (e) {
    // Settings must never stop an e-mail: send it as the code built it.
    logger.warn(`[email-hub] settings not applied for ${p.event}: ${e.message}`);
    return { to: p.to, cc: p.cc, subject: p.subject, html: p.html, attachments: p.attachments || [] };
  }
  return out;
}

const cut = (s, n) => (s === null || s === undefined ? null : String(s).slice(0, n));

/** One row in email_log. Never throws. Returns the new email_log_id (null on failure). */
async function log({ event, ref, to, cc, subject, html, attachments, result, transport, req }) {
  try {
    const ev = event ? EVENTS[event] : null;
    const module = (ref && ref.module) || (ev && ev.module) || null;
    const ins = await db.query(
      `INSERT INTO email_log (event_key, module, record_id, record_ref, to_list, cc_list, subject, body, attachments,
                              status, error, transport, sent_by)
       OUTPUT INSERTED.email_log_id AS id
       VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12)`,
      [
        cut(event, 60), cut(module, 30), ref && ref.id ? Number(ref.id) || null : null, cut(ref && ref.number, 60),
        cut((to || []).filter(Boolean).join(', '), 2000) || '-', cut((cc || []).filter(Boolean).join(', '), 2000) || null,
        cut(subject, 500), ev && ev.system ? null : (html || null),
        cut((attachments || []).map((a) => a.filename).filter(Boolean).join(', '), 2000) || null,
        result && result.ok ? 'Sent' : 'Failed', cut(result && !result.ok ? result.error : null, 1000),
        cut(transport, 10), req && req.userData ? req.userData.userId : null,
      ]);
    return ins && ins[0] ? ins[0].id : null;
  } catch (e) {
    logger.warn(`[email-hub] email_log write failed (${event || '-'}): ${e.message}`);
    return null;
  }
}

module.exports = {
  render, prepare, log, invalidate, loadConfig, resolvePeople,
  placeholdersIn, unknownPlaceholders, renderHtml, renderText, sanitizeHtml, escHtml,
  ATTACH_DIR, baseDir,
};
