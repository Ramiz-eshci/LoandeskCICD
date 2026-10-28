'use strict';

/**
 * Replies to "Information required" e-mails -> documents on the case (client 17-10-2026).
 *
 * The system e-mails a broker / applicant from the shared mailbox (BDM in cc) asking
 * for information. When they REPLY with documents, the attachments are uploaded to
 * the enquiry / application / underwriting case the request was sent from, a note
 * is added, and the reply is NOT turned into a new enquiry by the inbox intake.
 *
 * Send side  : captureSentIds() reads the sent message back from Sent Items (only
 *              Mail.Read needed) and stores its conversationId + internetMessageId
 *              on the email_log row.
 * Inbound    : handleReply() is called by the Outlook webhook BEFORE the AI enquiry
 *              classification. Match order:
 *                1. conversationId           == email_log.conversation_id
 *                2. In-Reply-To / References  -> email_log.internet_message_id
 *                3. reference in the subject  ("Information required - APP-123")
 *              Only e-mail_log rows of the INFO_REQUEST events are considered.
 *
 * Underwriting cases have no general documents tab, so their reply attachments go
 * to the linked application's documents (same APP ref; visible in the Application
 * Documents tab and in the Final Credit Committee document picker).
 */

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const { getGraphClient } = require('../config/microsoftGraph.service');
const { config } = require('../config/env');
const logger = require('../utils/logger');
const fileGuard = require('../utils/fileGuard');

const INFO_EVENTS = ['ENQUIRY_INFO_REQUEST', 'APPLICATION_INFO_REQUEST', 'UW_INFO_REQUEST'];
const EVENTS_SQL = INFO_EVENTS.map((e) => `'${e}'`).join(',');

const ENQ_DIR = path.join('uploads', 'enquiry_documents');
const APP_DIR = path.join('uploads', 'application_documents');

const ALLOWED_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'odt', 'ods',
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'zip', 'msg', 'eml',
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB, client 22-10-2026
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic']);
const INLINE_IMG_MIN_BYTES = 50 * 1024; // smaller inline images = signature logos

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cut = (s, n) => (s === null || s === undefined ? null : String(s).slice(0, n));

/* ------------------------------------------------------------------ */
/*  SEND SIDE                                                          */
/* ------------------------------------------------------------------ */

/** Is this event one whose replies we track? */
function isTracked(event) {
  return INFO_EVENTS.includes(event);
}

/**
 * Read the just-sent message back from Sent Items and store its ids on email_log.
 * Fire-and-forget: never throws, retries a few times (Sent Items is not instant).
 */
async function captureSentIds({ logId, mailbox, subject, to, sentAfter }) {
  if (!logId || !mailbox) return;
  const since = new Date(sentAfter.getTime() - 60 * 1000).toISOString();
  const wantTo = String(to || '').toLowerCase();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await sleep(attempt * 4000);
    try {
      const res = await getGraphClient()
        .api(`/users/${mailbox}/mailFolders/sentitems/messages`)
        .filter(`sentDateTime ge ${since}`)
        .orderby('sentDateTime desc')
        .select('subject,toRecipients,conversationId,internetMessageId,sentDateTime')
        .top(25)
        .get();
      const hit = (res.value || []).find((m) => String(m.subject || '') === String(subject || '')
        && (!wantTo || (m.toRecipients || []).some((r) => String(r.emailAddress?.address || '').toLowerCase() === wantTo)));
      if (hit) {
        await db.query(
          'UPDATE email_log SET internet_message_id = @p0, conversation_id = @p1 WHERE email_log_id = @p2',
          [cut(hit.internetMessageId, 512), cut(hit.conversationId, 512), logId]);
        return;
      }
    } catch (e) {
      logger.warn(`[email-reply] sent-items lookup failed (log ${logId}, try ${attempt}): ${e.message}`);
    }
  }
  logger.warn(`[email-reply] sent message not found in Sent Items (log ${logId}); replies will match on subject ref`);
}

/* ------------------------------------------------------------------ */
/*  INBOUND SIDE                                                       */
/* ------------------------------------------------------------------ */

function headerValue(message, name) {
  const h = (message.internetMessageHeaders || []).find((x) => String(x.name).toLowerCase() === name.toLowerCase());
  return h ? String(h.value || '') : '';
}

/** Find the INFO_REQUEST email_log row this message replies to. */
async function findOriginal(message) {
  // 1. Same Outlook conversation.
  if (message.conversationId) {
    const rows = await db.query(
      `SELECT TOP 1 email_log_id, module, record_id, record_ref FROM email_log
        WHERE conversation_id = @p0 AND event_key IN (${EVENTS_SQL}) AND status = 'Sent'
        ORDER BY sent_at DESC`, [message.conversationId]);
    if (rows.length) return { ...rows[0], method: 'conversation' };
  }

  // 2. In-Reply-To / References headers.
  const ids = `${headerValue(message, 'In-Reply-To')} ${headerValue(message, 'References')}`.match(/<[^<>\s]+>/g) || [];
  for (const mid of [...new Set(ids)].reverse()) { // newest reference last in References
    const rows = await db.query(
      `SELECT TOP 1 email_log_id, module, record_id, record_ref FROM email_log
        WHERE internet_message_id = @p0 AND event_key IN (${EVENTS_SQL}) AND status = 'Sent'`, [mid]);
    if (rows.length) return { ...rows[0], method: 'header' };
  }

  // 3. Reference in the subject (whole-token match, longest ref first).
  const subject = String(message.subject || '');
  if (subject) {
    const rows = await db.query(
      `SELECT email_log_id, module, record_id, record_ref FROM email_log
        WHERE record_ref IS NOT NULL AND LEN(record_ref) >= 3
          AND CHARINDEX(record_ref, @p0) > 0
          AND event_key IN (${EVENTS_SQL}) AND status = 'Sent'
        ORDER BY LEN(record_ref) DESC, sent_at DESC`, [subject.slice(0, 500)]);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = rows.find((r) => new RegExp(`(^|[^A-Za-z0-9])${esc(r.record_ref)}($|[^A-Za-z0-9])`, 'i').test(subject));
    if (hit) return { ...hit, method: 'subject' };
  }
  return null;
}

/** Usable file attachments only (no small inline signature images, no item / link attachments). */
function usableAttachments(attachments) {
  const out = [];
  const skipped = [];
  for (const att of attachments || []) {
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment' || !att.contentBytes) continue;
    const name = String(att.name || 'attachment');
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    const buf = Buffer.from(att.contentBytes, 'base64');
    // Inline: a PDF / document dragged into the body is a real document -> keep it.
    // Small inline images are signature logos / icons -> skip. Larger inline images
    // (a pasted photo of a passport, a screenshot of a statement) are kept.
    const isImage = /^image\//i.test(att.contentType || '') || IMAGE_EXT.has(ext);
    if (att.isInline && isImage && buf.length < INLINE_IMG_MIN_BYTES) continue;
    if (!ALLOWED_EXT.has(ext)) { skipped.push(`${name} (file type not allowed)`); continue; }
    if (!buf.length || buf.length > MAX_BYTES) { skipped.push(`${name} (empty or over 20 MB)`); continue; }
    // Pen-test 24-10-2026: check the real content (no renamed executables / mismatched types).
    const chk = fileGuard.checkInbound(name, buf, { allowed: [...ALLOWED_EXT], maxBytes: MAX_BYTES });
    if (!chk.ok) { skipped.push(`${name} (${chk.error})`); continue; }
    out.push({ name: chk.name, buf });
  }
  return { files: out, skipped };
}

function writeFile(dir, name, buf) {
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), dir);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${name.replace(/[^\w.\-]+/g, '_')}`;
  fs.writeFileSync(path.join(absDir, safe), buf);
  return path.join(dir, safe).replace(/\\/g, '/');
}

/** Resolve where documents + note go for the matched record. null when the record is gone. */
async function resolveTarget(orig) {
  const mod = String(orig.module || '').toUpperCase();
  const id = Number(orig.record_id);
  if (!id) return null;
  if (mod === 'ENQUIRY') {
    const r = await db.query('SELECT enquiry_id FROM enquiries WHERE enquiry_id = @p0 AND flag_deleted = 0', [id]);
    return r.length ? { kind: 'ENQUIRY', id } : null;
  }
  if (mod === 'APPLICATION') {
    const r = await db.query('SELECT application_id FROM applications WHERE application_id = @p0 AND flag_deleted = 0', [id]);
    return r.length ? { kind: 'APPLICATION', id } : null;
  }
  if (mod === 'UNDERWRITING') {
    const r = await db.query(
      `SELECT a.application_id FROM underwriting_cases c
         JOIN applications a ON a.application_id = c.application_id AND a.flag_deleted = 0
        WHERE c.underwriting_case_id = @p0 AND c.flag_deleted = 0`, [id]);
    return r.length ? { kind: 'APPLICATION', id: r[0].application_id, fromUw: true } : null;
  }
  return null;
}

async function saveDocs(target, files) {
  let n = 0;
  for (const f of files) {
    if (target.kind === 'ENQUIRY') {
      const rel = writeFile(ENQ_DIR, f.name, f.buf);
      await db.query(
        `INSERT INTO enquiry_documents (enquiry_id, document_type_id, type_other, file_name, file_path, uploaded_by, created_by)
         VALUES (@p0, NULL, 'Email reply', @p1, @p2, NULL, NULL)`,
        [target.id, cut(f.name, 255), cut(rel, 500)]);
    } else {
      const rel = writeFile(APP_DIR, f.name, f.buf);
      await db.query(
        `INSERT INTO application_documents (application_id, document_type_id, file_name, file_path, status, version, uploaded_by, created_by)
         VALUES (@p0, NULL, @p1, @p2, 'Uploaded', 'v1', NULL, NULL)`,
        [target.id, cut(f.name, 255), cut(rel, 500)]);
    }
    n += 1;
  }
  return n;
}

async function addNote(target, text) {
  if (target.kind === 'ENQUIRY') {
    await db.query('INSERT INTO enquiry_notes (enquiry_id, note, created_by) VALUES (@p0, @p1, NULL)', [target.id, cut(text, 4000)]);
  } else {
    await db.query('INSERT INTO application_notes (application_id, note, created_by) VALUES (@p0, @p1, NULL)', [target.id, cut(text, 4000)]);
  }
}

async function alreadyProcessed(messageId) {
  const r = await db.query('SELECT TOP 1 1 AS x FROM outlook_processed_emails WHERE message_id = @p0', [messageId]);
  return r.length > 0;
}

async function archive(message, orig, target, status, error) {
  try {
    await db.query(
      `INSERT INTO outlook_processed_emails
         (message_id, internet_message_id, sender, subject, body_content, body_content_type,
          received_at, has_attachments, enquiry_id, status, error_message, module, record_id, match_method)
       VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13)`,
      [
        message.id, message.internetMessageId || null, message.from?.emailAddress?.address || null,
        cut(message.subject, 500), message.body?.content || null, message.body?.contentType || null,
        message.receivedDateTime ? new Date(message.receivedDateTime) : null, message.hasAttachments ? 1 : 0,
        target && target.kind === 'ENQUIRY' ? target.id : null, status, cut(error, 1000),
        cut(orig && orig.module, 30), orig ? Number(orig.record_id) || null : null, cut(orig && orig.method, 30),
      ]);
  } catch (err) {
    if (err.number === 2627 || err.originalError?.number === 2627) return; // already archived
    throw err;
  }
}

/**
 * Inbound hook. Returns { handled:true, ... } when the message is a reply to an
 * Information Required e-mail (the caller must then NOT create an enquiry).
 * @param {object} message   Graph message incl. conversationId + internetMessageHeaders
 * @param {Function} loadAttachments  async () => Graph attachments[]
 */
async function handleReply(message, loadAttachments) {
  if (!message || !message.id) return { handled: false };
  if (await alreadyProcessed(message.id)) return { handled: true, skipped: true };

  const orig = await findOriginal(message);
  if (!orig) return { handled: false };

  const target = await resolveTarget(orig);
  if (!target) {
    await archive(message, orig, null, 'reply_record_missing', `Record ${orig.module} #${orig.record_id} not found`);
    return { handled: true, saved: 0, reason: 'record missing' };
  }

  // Always fetch: Graph's hasAttachments can be false for some mails that do carry files.
  let saved = 0;
  let skipped = [];
  let all = [];
  try { all = (await loadAttachments()) || []; } catch (e) { logger.warn(`[email-reply] attachments fetch failed: ${e.message}`); }
  logger.info(`[email-reply] hasAttachments=${!!message.hasAttachments}, attachments: ${all.length ? all.map((a) => `${a.name} [${String(a['@odata.type'] || '').split('.').pop()}${a.isInline ? ', inline' : ''}, ${a.size || 0}b]`).join('; ') : 'none'}`);
  const { files, skipped: sk } = usableAttachments(all);
  skipped = sk;
  // OneDrive / SharePoint "share link" attachments carry no file content - list them for the user.
  for (const a of all) {
    if (a['@odata.type'] === '#microsoft.graph.referenceAttachment') skipped.push(`${a.name} (cloud link - please attach the file itself)`);
  }
  saved = await saveDocs(target, files);
  if (!all.length) {
    const links = (String(message.body?.content || '').match(/href="https?:\/\/[^"]*(sharepoint\.com|onedrive|1drv\.ms)[^"]*"/gi) || []).length;
    if (links) skipped.push(`${links} OneDrive / SharePoint link(s) in the e-mail body (not attached files)`);
  }

  const sender = message.from?.emailAddress?.address || 'unknown sender';
  const parts = [`${target.fromUw ? '[Underwriting] ' : ''}Reply received from ${sender} to the information request (${orig.record_ref || ''})`];
  parts.push(saved ? `${saved} document(s) uploaded from the e-mail` : 'no documents attached');
  if (skipped.length) parts.push('Not uploaded: ' + skipped.join(', '));
  await addNote(target, parts.join('. ') + '.').catch((e) => logger.warn(`[email-reply] note failed: ${e.message}`));

  await archive(message, orig, target, 'reply_matched', skipped.length ? 'Skipped: ' + skipped.join(', ') : null);
  logger.info(`[email-reply] ${message.id} -> ${orig.module} #${orig.record_id} (${orig.method}), ${saved} doc(s)`);
  return { handled: true, saved, module: orig.module, recordId: orig.record_id, method: orig.method };
}

module.exports = { isTracked, captureSentIds, handleReply, findOriginal, usableAttachments };
