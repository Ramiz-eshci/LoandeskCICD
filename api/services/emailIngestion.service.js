'use strict';

/**
 * Email -> Enquiry ingestion (Module-4 add-on).
 *
 * Turns an inbound Outlook message into a LoanDesk enquiry by reusing the
 * SAME creation path as manual/website enquiries (services/enquiry.service),
 * so an emailed enquiry gets the normal ENQ reference, NEW status, workflow,
 * audit trail and shows up in the enquiry listing (tagged source = Email).
 *
 * Responsibilities:
 *   - idempotency (outlook_processed_emails.message_id UNIQUE + pre-check)
 *   - field extraction (services/emailExtractor) + normalisation to the
 *     enquiry field types, and sanitisation to the charset enquiry validation
 *     allows (so a messy real email can never fail the insert)
 *   - persist attachments into uploads/ + enquiry_documents
 *   - archive the raw message in outlook_processed_emails, linked to the enquiry
 */

const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const enquiryService = require('./enquiry.service');
const fileGuard = require('../utils/fileGuard');
const { extractFormFields, htmlToText } = require('./emailExtractor.service');

const PROCESSED_TBL = 'outlook_processed_emails';
const ATTACH_SUBDIR = path.join('uploads', 'enquiry_documents');

let _emailSourceId; // cached application_sources.application_source_id for EMAIL

/** Resolve (and cache) the 'EMAIL' application source id. Null if absent. */
async function emailSourceId() {
  if (_emailSourceId !== undefined) return _emailSourceId;
  const rows = await db.query(
    "SELECT TOP 1 application_source_id AS id FROM application_sources WHERE code = 'EMAIL' AND flag_deleted = 0",
  );
  _emailSourceId = rows.length ? rows[0].id : null;
  return _emailSourceId;
}

/** Keep only characters the enquiry text validator allows; collapse blanks. */
function sanitizeText(v, max = 4000) {
  if (v === undefined || v === null) return null;
  const cleaned = String(v)
    .replace(/[^A-Za-z0-9 .,&/'()\-#:\n\r]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** "£250,000.50" / "250000" -> 250000.5 ; null when no number present. */
function parseAmount(v) {
  if (!v) return null;
  const digits = String(v).replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "12 months" / "2 years" -> months (int); null when unknown. */
function parseTermMonths(v) {
  if (!v) return null;
  const m = String(v).match(/(\d+)\s*(month|months|mo|year|years|yr|yrs)?/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return /year|yr/i.test(m[2] || '') ? n * 12 : n;
}

const RX_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Human-ish name from an email address local part ("john.doe" -> "John Doe"). */
function nameFromEmail(addr) {
  if (!addr) return null;
  const local = String(addr).split('@')[0] || '';
  const name = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
  if (!name) return null;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Has this Graph message already been ingested? */
async function alreadyProcessed(messageId) {
  const rows = await db.query(
    `SELECT TOP 1 outlook_email_id, enquiry_id FROM ${PROCESSED_TBL} WHERE message_id = @p0`,
    [messageId],
  );
  return rows.length ? rows[0] : null;
}

/** Persist file attachments to disk + enquiry_documents rows. */
async function saveAttachments(enquiryId, attachments) {
  if (!attachments || !attachments.length) return 0;

  const absDir = path.join(global.basePath || path.join(__dirname, '..'), ATTACH_SUBDIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

  let saved = 0;
  for (const att of attachments) {
    if (att['@odata.type'] !== '#microsoft.graph.fileAttachment' || !att.contentBytes) continue;
    // Pen-test 24-10-2026: same type / size / content rules as e-mail replies.
    const buf = Buffer.from(att.contentBytes, 'base64');
    const chk = fileGuard.checkInbound(String(att.name || 'attachment'), buf);
    if (!chk.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[emailIngestion] attachment skipped (${chk.error}): ${String(att.name || '').slice(0, 120)}`);
      continue;
    }
    const safeName = `${Date.now()}_${chk.name.replace(/[^\w.\-]+/g, '_')}`;
    const abs = path.join(absDir, safeName);
    fs.writeFileSync(abs, buf);
    const servedPath = '/' + path.posix.join(ATTACH_SUBDIR.split(path.sep).join('/'), safeName);
    await db.query(
      `INSERT INTO enquiry_documents (enquiry_id, document_type_id, file_name, file_path, uploaded_by)
       VALUES (@p0, NULL, @p1, @p2, NULL)`,
      [enquiryId, chk.name.slice(0, 255), servedPath.slice(0, 500)],
    );
    saved += 1;
  }
  return saved;
}

/**
 * Ingest one Graph message (already fetched) + its attachments.
 * @returns {Promise<{skipped?:boolean, ok?:boolean, enquiryId?:number, ref?:string, reason?:string}>}
 */
async function ingestMessage(message, attachments = []) {
  const messageId = message.id;
  if (!messageId) return { ok: false, reason: 'missing message id' };

  const seen = await alreadyProcessed(messageId);
  if (seen) return { skipped: true, enquiryId: seen.enquiry_id, reason: 'already processed' };

  // 1. Extract free-form fields (AI + deterministic fallback).
  const fields = await extractFormFields(message.body?.content, message.body?.contentType);

  // 2. Normalise + sanitise into enquiry columns.
  const senderAddr = message.from?.emailAddress?.address || null;
  const senderName = message.from?.emailAddress?.name || null;
  const applicantName =
    sanitizeText(fields.loanApply, 200) ||
    sanitizeText(senderName, 200) ||
    sanitizeText(nameFromEmail(senderAddr), 200);

  const bodyText = htmlToText(message.body?.content, message.body?.contentType);
  const summary = sanitizeText(
    [
      `Email enquiry from ${senderAddr || 'unknown sender'}.`,
      message.subject ? `Subject: ${message.subject}` : '',
      '',
      bodyText,
    ].filter(Boolean).join('\n'),
    4000,
  );

  const body = {
    applicant_name: applicantName,
    property_address: sanitizeText(fields.property, 255),
    amount_requested: parseAmount(fields.val),
    term_months: parseTermMonths(fields.wantsUpTo),
    lead_source: 'Email',
    summary,
  };
  if (senderAddr && RX_EMAIL.test(senderAddr)) body.email = senderAddr;
  const srcId = await emailSourceId();
  if (srcId) body.application_source_id = srcId;

  // Drop null/empty so enquiry validation treats them as absent (all optional at create).
  for (const k of Object.keys(body)) {
    if (body[k] === null || body[k] === '') delete body[k];
  }

  // 3. Create the enquiry through the shared service (source = email).
  let created;
  try {
    created = await enquiryService.create(body, null, { source: 'email' });
  } catch (err) {
    await recordEmail(message, fields, null, 'error', err.message);
    throw err;
  }
  if (!created.ok) {
    await recordEmail(message, fields, null, 'validation_failed', JSON.stringify(created.errors));
    return { ok: false, reason: 'validation_failed', errors: created.errors };
  }

  // 4. Attachments -> enquiry_documents.
  try {
    await saveAttachments(created.id, attachments);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[emailIngestion] attachment save failed:', err.message);
  }

  // 5. Archive the raw email, linked to the enquiry.
  await recordEmail(message, fields, created.id, 'processed', null);

  return { ok: true, enquiryId: created.id, ref: created.ref };
}

/** Insert the outlook_processed_emails archive row (idempotent on UNIQUE). */
async function recordEmail(message, fields, enquiryId, status, errorMessage) {
  try {
    await db.query(
      `INSERT INTO ${PROCESSED_TBL}
         (message_id, internet_message_id, sender, subject, body_content, body_content_type,
          received_at, has_attachments, raw_amount, raw_term, property, signer_name,
          enquiry_id, status, error_message)
       VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14)`,
      [
        message.id,
        message.internetMessageId || null,
        message.from?.emailAddress?.address || null,
        message.subject ? String(message.subject).slice(0, 500) : null,
        message.body?.content || null,
        message.body?.contentType || null,
        message.receivedDateTime ? new Date(message.receivedDateTime) : null,
        message.hasAttachments ? 1 : 0,
        (fields.val || '').slice(0, 100) || null,
        (fields.wantsUpTo || '').slice(0, 100) || null,
        (fields.property || '').slice(0, 500) || null,
        (fields.loanApply || '').slice(0, 200) || null,
        enquiryId,
        status,
        errorMessage ? String(errorMessage).slice(0, 1000) : null,
      ],
    );
  } catch (err) {
    // 2627 = unique violation: a concurrent notification already archived it.
    if (err.number === 2627 || err.originalError?.number === 2627) return;
    throw err;
  }
}

module.exports = { ingestMessage, emailSourceId, parseAmount, parseTermMonths, sanitizeText };
