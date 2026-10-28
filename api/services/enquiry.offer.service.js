'use strict';

/**
 * Module-4: Indicatives + Offer flow (versioned, audited, offer emailed as 2 PDFs).
 *
 *  - Indicative: capture inputs, run the calc engine, save versions, send (PDF + status).
 *  - Offer: capture letter fields, save versions, send = generate offer PDF + attach the
 *    application-form template + EMAIL both PDFs to the applicant, then advance status.
 *  - Every save/send/accept writes an audit-log entry with a field-level diff so the
 *    back-and-forth is fully traceable.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const audit = require('./audit.service');
const workflow = require('./workflow.service');
const calc = require('./enquiry.calc.service');
const pdf = require('./pdf/enquiry-pdf.service');
const mail = require('./mail.service');
const emailHub = require('./emailHub.service');
const enquirySvc = require('./enquiry.service');
const logger = require('../utils/logger');
const { OFFER_DEFAULTS } = require('../config/enquiry.config');
const { classifyApplicantType } = require('../utils/applicant-type');

const MODULE_KEY = 'ENQUIRIES.ENQUIRY_LIST';
const OFFER_DOC_DIR = path.join('uploads', 'enquiry_offers');
const APP_FORM_TEMPLATE = path.join('uploads', 'templates', 'application-form.pdf');
/** "AML Acceptable ID & Address Proof" — fixed document attached to every offer email. */
const AML_DOC = path.join(__dirname, '..', 'assets', 'offer', 'AML_Acceptable_ID_Address_Proof.pdf');

const uid = (req) => (req && req.userData ? req.userData.userId : null);
const parse = (j) => { try { return j ? JSON.parse(j) : {}; } catch { return {}; } };

async function getEnquiry(id) { return enquirySvc.getById(id); }

/**
 * Who receives the indicative / offer email (client 25-09-2026):
 *  - enquiry came through a broker (broker picked from the Brokers master and
 *    that broker has an email) -> the BROKER gets it; the BDM stays on CC.
 *  - otherwise -> the borrower (applicant) email, as before.
 * A broker typed only as free text has no email on file, so it falls back to
 * the borrower.
 */
function recipientOf(e) {
  if (e.broker_id && e.broker_email) {
    return { email: e.broker_email, name: e.broker_name || 'Broker', isBroker: true };
  }
  // Fall back to the primary applicant / director's email when the enquiry itself has
  // none — e.g. a company enquiry whose contact email sits on the director, not the
  // enquiry-level email (client 02-10-2026).
  const list = Array.isArray(e.applicants) ? e.applicants : [];
  const primary = list.find((a) => a && (a.is_primary === 1 || a.is_primary === true)) || list[0];
  const email = e.email || (primary && primary.email) || null;
  return { email, name: e.applicant_name || e.company_name || 'Applicant', isBroker: false };
}

/** Diff two flat objects -> { key: {from, to} } for the audit trail. */
function diff(prev = {}, next = {}) {
  const out = {};
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    const a = prev ? prev[k] : undefined;
    const b = next ? next[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

/** Persist a generated PDF buffer as an enquiry_documents row. */
async function storePdf(enquiryId, filename, buffer, req) {
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), OFFER_DOC_DIR, String(enquiryId));
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const safe = Date.now() + '_' + filename.replace(/[^\w.\-]+/g, '_');
  fs.writeFileSync(path.join(absDir, safe), buffer);
  const rel = path.join(OFFER_DOC_DIR, String(enquiryId), safe).replace(/\\/g, '/');
  const ins = await db.query(
    `INSERT INTO enquiry_documents (enquiry_id, document_type_id, file_name, file_path, uploaded_by, created_by)
     OUTPUT INSERTED.enquiry_document_id AS id VALUES (@p0, NULL, @p1, @p2, @p3, @p3)`,
    [enquiryId, filename, rel, uid(req)]);
  return ins[0] ? ins[0].id : null;
}

async function nextVersion(table, enquiryId) {
  const r = await db.query(`SELECT ISNULL(MAX(version_no),0) AS v FROM ${table} WHERE enquiry_id = @p0 AND flag_deleted = 0`, [enquiryId]);
  return (r[0] ? r[0].v : 0) + 1;
}

/* ------------------------------------------------------------------ */
/*  INDICATIVES                                                        */
/* ------------------------------------------------------------------ */

/** Live recompute (no persistence) for the popup. */
function previewIndicative(body) {
  // No defaults argument: the engine takes no house figures, so a blank box
  // stays blank rather than being silently filled from config.
  return { ok: true, data: calc.computeIndicative(body && body.inputs ? body.inputs : body) };
}

async function saveIndicative(id, body, req) {
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  const inputs = body && body.inputs ? body.inputs : body || {};
  const result = calc.computeIndicative(inputs);
  const version = await nextVersion('enquiry_indicatives', id);
  const ins = await db.query(
    `INSERT INTO enquiry_indicatives (enquiry_id, version_no, inputs_json, calc_json, status, created_by)
     OUTPUT INSERTED.enquiry_indicative_id AS id
     VALUES (@p0, @p1, @p2, @p3, 'Draft', @p4)`,
    [id, version, JSON.stringify(result.inputs), JSON.stringify(result.calc), uid(req)]);
  const vid = ins[0] ? ins[0].id : null;
  await audit.write(audit.fromReq(req, {
    action: 'INDICATIVE_SAVED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { indicative_id: vid, version, warnings: result.warnings },
  }));
  return { ok: true, id: vid, version, data: result };
}

async function listIndicatives(id) {
  const rows = await db.query(
    `SELECT enquiry_indicative_id, version_no, status, document_id, email_status, email_to, email_error, sent_at, sent_by, created_at, inputs_json, calc_json, notes
       FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [id]);
  return rows.map((r) => ({ ...r, inputs: parse(r.inputs_json), calc: parse(r.calc_json), inputs_json: undefined, calc_json: undefined }));
}

async function sendIndicative(id, vid, req) {
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  const rows = await db.query(
    `SELECT * FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [vid, id]);
  if (!rows.length) return { notFound: true };
  const rec = rows[0];
  const calcObj = parse(rec.calc_json);
  // Client 20-10-2026: free-text notes typed on Send Indicatives go in the e-mail below the
  // terms (e.g. "Subject to due diligence on source of funds"). Stored on the version.
  const notesRaw = req && req.body && typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
  const notes = notesRaw ? notesRaw.slice(0, 4000) : null;

  const to = recipientOf(e);
  if (!to.email) return { ok: false, error: 'No email to send the indicative to — add the borrower email, or pick a broker that has an email' };

  const buffer = await pdf.buildIndicativePdf(calcObj, e);
  const docId = await storePdf(id, `Indicative_${e.enquiry_ref || id}_v${rec.version_no}.pdf`, buffer, req);

  // Email the indicative PDF to the applicant.
  const cc = e.assigned_to_email ? [e.assigned_to_email] : [];
  // Security address in the subject + at the top of the table, so a broker with many
  // deals can tell at a glance which one these terms are for (client point #3).
  const secAddr = pdf.securityAddress(e);
  // The email table is built from the SAME row set as the attached PDF
  // (pdf.indicativeRows), so whatever the BDM saw in the Send Indicatives popup
  // is what the applicant receives — including the drawdown lines and
  // "Total Net incl. Drawdowns", which the old hard-coded list left out.
  const esc = (t) => String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows2 = pdf.indicativeRows(calcObj || {});
  const tableRows = rows2.map((r) => {
    const weight = r.bold || r.net ? 'font-weight:700;' : '';
    const colour = r.net ? 'color:#b00020;' : 'color:#0f2244;';
    const border = r.rule ? 'border-bottom:1px solid #e4ebf3;' : '';
    return `<tr><td style="padding:6px 12px;${border}${weight}${colour}">${esc(r.label)}</td>`
      + `<td style="padding:6px 12px;text-align:right;${border}${weight}${colour}">${esc(r.value)}</td></tr>`;
  }).join('');
  const applicant = e.applicant_name || e.company_name || '';
  // All securities for the deal: the main property plus any "other security" typed on
  // the enquiry (Step 5) and/or ticked on the indicative popup, comma-separated and
  // de-duplicated (client 02-10-2026). Same helper the attached PDF uses, so they match.
  // Client 09-10-2026: list multiple securities on separate numbered lines so each is
  // clearly distinct; a single security stays inline.
  const secList = pdf.securityAddressList(e, calcObj);
  // Client 14-10-2026: with several securities the label sits on its own line and each
  // address gets its own block line (previously "1." ran on from the label).
  const secHtml = secList.length <= 1
    ? `Security Address: ${esc(secList[0] || '-')}`
    : 'Security Addresses:'
      + secList.map((s, i) => `<div style="padding:4px 0 0 14px;font-weight:600">${i + 1}. ${esc(s)}</div>`).join('');
  const addrRow = (applicant ? `<tr><td colspan="2" style="padding:10px 12px;background:#0f2244;color:#ffffff;font-weight:700;font-size:14px">Applicant: ${esc(applicant)}</td></tr>` : '')
    + `<tr><td colspan="2" style="padding:10px 12px;background:#0f2244;color:#ffffff;font-weight:700;font-size:14px;line-height:1.4">${secHtml}</td></tr>`;
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  // Notes block sits right under the figures table. It is part of {{FiguresTable}} so a
  // body edited on the Email Settings screen still carries it; {{IndicativeNotes}} is the
  // plain-text notes for templates that want to place them elsewhere.
  const notesHtml = notes
    ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid #c8d8e8;background:#f7f9fc;font-family:Arial,sans-serif;font-size:13px;color:#0f2244;min-width:396px"><div style="font-weight:700;margin-bottom:4px">Notes</div>${esc(notes).replace(/\r?\n/g, '<br>')}</div>`
    : '';
  const mailVars = {
    Ref: e.enquiry_ref, Borrower: applicant, SecurityAddress: secAddr, RecipientName: to.name,
    ForBorrower: applicant ? ` for ${applicant}` : '',
    FiguresTable: `<table style="border-collapse:collapse;border:1px solid #c8d8e8;font-family:Arial,sans-serif;font-size:13px;min-width:420px">${addrRow}${tableRows}</table>${notesHtml}`,
    IndicativeNotes: notes || '',
  };
  const { subject, html } = emailHub.render('ENQUIRY_INDICATIVE', mailVars);
  logger.info(`[offer] sending indicative email enquiry=${id} vid=${vid} to=${to.email} cc=${cc.join(',')||'-'}`);
  const sent = await mail.sendMail({
    to: to.email, cc, subject, html, attachments: [{ filename: 'Indicative_Terms.pdf', buffer }],
    // Email Settings master + Email History (client 17-10-2026)
    event: 'ENQUIRY_INDICATIVE', ref: { module: 'ENQUIRY', id, number: e.enquiry_ref }, req, vars: mailVars,
  });
  if (sent.ok) logger.info(`[offer] indicative email SENT enquiry=${id} vid=${vid}`);
  else logger.warn(`[offer] indicative email FAILED enquiry=${id} vid=${vid}: ${sent.error}`);

  await db.query(
    `UPDATE enquiry_indicatives SET status = 'Superseded', updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0 AND status = 'Sent' AND flag_deleted = 0`, [id]);
  await db.query(
    `UPDATE enquiry_indicatives SET status = 'Sent', document_id = @p2, sent_at = SYSUTCDATETIME(), sent_by = @p3,
            email_status = @p4, email_to = @p5, email_cc = @p6, email_subject = @p7, email_error = @p8, notes = @p9, updated_at = SYSUTCDATETIME()
      WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1`,
    [vid, id, docId, uid(req), sent.ok ? 'Sent' : 'Failed', to.email, cc.join(', ') || null, subject, sent.ok ? null : (sent.error || 'send failed'), notes]);
  // Client 26-10-2026: a new indicative after an offer means the terms are changing, so any
  // live (Sent / Accepted) offer is superseded and the offer stamps cleared - same as a
  // re-open from an accepted offer. A fresh offer must go out before accept / convert.
  await db.query(
    `UPDATE enquiry_offers SET status = 'Superseded', updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0 AND status IN ('Sent', 'Accepted') AND flag_deleted = 0`, [id]);
  await db.query(
    `UPDATE enquiries SET current_indicative_id = @p1, indicative_sent_at = SYSUTCDATETIME(),
            offer_sent_at = NULL, offer_accepted_at = NULL, current_offer_id = NULL,
            updated_by = @p2, updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0`, [id, vid, uid(req)]);

  // Client 06-10-2026: mail log. Every e-mail the system sends is recorded on the
  // Communications timeline, marked SENT (delivered) or GENERATED (built but not sent).
  await enquirySvc.addNote(id,
    `\u{1F4E7} Email ${sent.ok ? 'sent' : 'generated (NOT sent: ' + (sent.error || 'send failed') + ')'} \u2014 Indicative v${rec.version_no} to ${to.email}`,
    req).catch(() => {});

  await workflow.applyStatus(id, workflow.S.INDICATIVE_SENT, req, { reason: 'Indicative Sent', force: true });
  await audit.write(audit.fromReq(req, {
    action: sent.ok ? 'INDICATIVE_EMAILED' : 'INDICATIVE_EMAIL_FAILED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { indicative_id: vid, version: rec.version_no, document_id: docId, to: to.email, notes, error: sent.ok ? null : sent.error },
  }));
  return { ok: true, id: vid, document_id: docId, emailed: sent.ok, error: sent.ok ? null : sent.error };
}

/**
 * Client 16-10-2026: PDF of ANY indicative version, sent or not. A version saved but never
 * e-mailed (e.g. the one behind an underwriting "Edit loan") had no stored PDF, so the
 * history showed "Accepted offer" with nothing to download. Built once from the version's
 * own figures, stored as an enquiry document and linked (document_id); later calls reuse it.
 * The version's status is not touched.
 */
async function indicativePdf(id, vid, req) {
  const rows = await db.query(
    `SELECT * FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [vid, id]);
  if (!rows.length) return { notFound: true };
  const rec = rows[0];
  const fileName = `Indicative_v${rec.version_no}.pdf`;
  if (rec.document_id) {
    const d = await db.query('SELECT file_name, file_path FROM enquiry_documents WHERE enquiry_document_id = @p0 AND flag_deleted = 0', [rec.document_id]);
    const abs = d.length ? path.join(global.basePath || path.join(__dirname, '..'), d[0].file_path) : null;
    if (abs && fs.existsSync(abs)) return { ok: true, buffer: fs.readFileSync(abs), fileName: d[0].file_name || fileName, document_id: rec.document_id };
  }
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  const buffer = await pdf.buildIndicativePdf(parse(rec.calc_json), e);
  const docId = await storePdf(id, `Indicative_${e.enquiry_ref || id}_v${rec.version_no}.pdf`, buffer, req);
  await db.query('UPDATE enquiry_indicatives SET document_id = @p2, updated_at = SYSUTCDATETIME() WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1',
    [vid, id, docId]);
  return { ok: true, buffer, fileName, document_id: docId };
}

/* ------------------------------------------------------------------ */
/*  OFFERS                                                             */
/* ------------------------------------------------------------------ */

/**
 * Broker shown on the letter (client 07-10-2026): the Brokers master COMPANY name,
 * then the master broker name, then the free-text broker, else blank. The offer
 * letter names the broker's COMPANY as the payee of the arrangement-fee share.
 */
function brokerNameOf(e) {
  return String((e && (e.broker_company || e.broker_name || e.broker_name_text)) || '').trim();
}

/**
 * Arrangement fee paid on to the broker, in £, from the offer's %/£ choice. Client 09-10-2026:
 * % is of the indicative's ARRANGEMENT FEE (not the broker fee); either way the result never
 * exceeds that arrangement-fee amount. (The separate "Less broker fee" letter line still uses
 * broker_fee_base = the indicative broker fee, which is left unchanged.)
 */
function brokerFeeAmount(o) {
  const base = Number(o.arrangement_fee);
  const hasBase = o.arrangement_fee !== null && o.arrangement_fee !== undefined && o.arrangement_fee !== '' && Number.isFinite(base);
  const v = Number(o.broker_fee_value);
  if (o.broker_fee_value === null || o.broker_fee_value === undefined || o.broker_fee_value === '' || !Number.isFinite(v) || v < 0) {
    return hasBase ? base : null;
  }
  const isPct = !(o.broker_fee_is_pct === false || o.broker_fee_is_pct === 'false');
  let amt = isPct ? (hasBase ? base * Math.min(v, 100) / 100 : 0) : v;
  if (hasBase) amt = Math.min(amt, base);
  return Math.round(amt * 100) / 100;
}

/** Build a default offer_json from the enquiry + latest indicative calc. */
async function defaultOfferJson(e, indicativeId) {
  const ind = indicativeId
    ? await db.query(
        `SELECT TOP 1 calc_json, inputs_json FROM enquiry_indicatives WHERE enquiry_indicative_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [indicativeId, e.enquiry_id])
    : await db.query(
        `SELECT TOP 1 calc_json, inputs_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [e.enquiry_id]);
  const c = ind.length ? parse(ind[0].calc_json) : {};
  const cin = ind.length ? parse(ind[0].inputs_json) : {};
  // Client 09-10-2026: jurisdiction + borrower kind come from the enquiry's applicant
  // type and pick the offer-letter template details (default rate + company line).
  const cls = classifyApplicantType(e.applicant_type_name);
  const gross = c.total_gross_loan_incl_dds ?? e.amount_requested ?? 0;
  const term = e.term_months || OFFER_DEFAULTS.default_term_months;
  const rate = OFFER_DEFAULTS.monthly_rate_pct;
  const arrangement = c.arrangement_fee ?? Math.round(gross * (OFFER_DEFAULTS.arrangement_fee_pct / 100));
  const documentFee = c.document_fee ?? OFFER_DEFAULTS.document_fee;
  const serviced = c.retained_interest_total ?? Math.round(gross * (rate / 100) * term);
  const monthly = term ? Math.round((serviced / term) * 100) / 100 : 0;
  const netRelease = c.day1_net ?? Math.round((gross - arrangement - documentFee) * 100) / 100;
  // Interest type drives which figure headlines the breakdown and the letter wording.
  const itype = c.interest_type || e.interest_type || 'Retained';
  const rateUsed = c.retained_interest_day1_rate_pct ?? rate;
  // Client 06-10-2026: a single, equal-footing list of ALL securities, each with its
  // own charge (1st/2nd). Main charge comes from the enquiry / 2nd-charge calc; the
  // additionals carry their own charge_type. Editable again at Send Offer.
  // Client 07-10-2026: each security's charge is its OWN selection (1st / 2nd) from the
  // enquiry — never inferred from the product / calc type. Blank stays blank (no charge
  // shown on the letter). This is why a 1st-charge main no longer flips to 2nd just
  // because the deal is a 2nd-charge bridge.
  const chgSel = (ct) => (ct === '2nd' ? '2nd' : (ct === '1st' ? '1st' : ''));
  const mainChargeType = chgSel(String(e.charge_type || ''));
  const normCharge = (x) => chgSel(x && x.charge_type);
  const extraSecs = Array.isArray(c.additional_securities) ? c.additional_securities : [];
  // Each security address carries its postcode on the offer letter (client 10-10-2026) —
  // appended only when the address does not already contain it.
  const withPc = (addr, pc) => {
    const a = String(addr || '').trim(); const p = String(pc || '').trim();
    if (!a) return '';
    if (!p) return a;
    return a.toUpperCase().replace(/\s/g, '').includes(p.toUpperCase().replace(/\s/g, '')) ? a : `${a}, ${p}`;
  };
  const securities = [
    { address: withPc(e.property_address, e.postcode), value: (c.main_property_value ?? c.property_value ?? e.estimated_value ?? null), charge_type: mainChargeType, is_main: true },
    ...extraSecs.map((x) => ({ address: withPc(x.address, x.postcode), value: (x.value != null ? x.value : (x.estimated_value != null ? x.estimated_value : null)), charge_type: normCharge(x) })),
  ];
  return {
    securities,
    borrower_name: e.applicant_name || e.company_name || '',
    borrower_address: pdf.securityAddress(e) || e.property_address || '',
    offer_date: new Date().toLocaleDateString('en-GB'),
    // Main property: 2nd charge when the 2nd-charge calculator was used with a 1st charge on it.
    security_charge_type: mainChargeType === '2nd' ? '2nd legal charge' : (mainChargeType === '1st' ? '1st legal charge' : ''),
    // Other securities ticked on the indicative - listed under Security on the letter.
    additional_securities: Array.isArray(c.additional_securities) ? c.additional_securities : [],
    security_address: pdf.securityAddress(e) || e.property_address || '',
    interest_type: itype,
    assumed_asset_value: c.property_value ?? e.estimated_value ?? null,
    // Main property's own value (assumed_asset_value is the total when other securities are ticked).
    main_property_value: c.main_property_value ?? c.property_value ?? e.estimated_value ?? null,
    assumed_gdv: c.gdv ?? e.gdv ?? null,
    gross_loan_amount: gross,
    legal_fees_text: 'TBC (Chaps fee £40)',
    arrangement_fee: arrangement,
    // Broker fee (the indicative's "Broker Fee", formerly labelled Introducer Fee).
    // It is the part of the arrangement fee paid on to the broker; % is of gross.
    // The indicative's Broker Fee in £ is the CAP. At Send Offer the user enters a
    // % OF THAT AMOUNT, or a £ amount no higher than it (client 28-09-2026).
    broker_fee_base: c.broker_fee ?? null,
    broker_fee_is_pct: true,
    broker_fee_value: c.arrangement_fee != null ? 100 : null,
    broker_fee_amount: c.arrangement_fee ?? null,
    broker_payee_name: brokerNameOf(e),
    document_fee: documentFee,
    // Type-specific interest figures (letter picks the one that matches interest_type).
    serviced_interest: serviced,
    serviced_interest_note: `(${rateUsed}% pcm compounded)`,
    retained_interest: c.retained_interest_total ?? c.retained_interest_day1 ?? serviced,
    rolled_up_interest: c.rolled_up_interest ?? null,
    redemption_total: c.redemption_total ?? null,
    monthly_payment: c.monthly_payment ?? monthly,
    net_release_day1: netRelease,
    // Future drawdowns captured on the indicative, echoed on the letter.
    // Calculated rows first (they carry gross AND net); raw inputs only as a fallback.
    drawdowns: Array.isArray(c.drawdowns) && c.drawdowns.length ? c.drawdowns : (Array.isArray(cin.drawdowns) ? cin.drawdowns : []),
    drawdowns_total: c.drawdowns_total ?? null,
    drawdowns_net_total: c.drawdowns_net_total ?? null,
    net_release_incl_drawdowns: c.total_net_incl_drawdowns ?? null,
    monthly_rate_pct: rateUsed,
    // Nominal default rate set by jurisdiction: Scotland 4%, England/Wales 3%.
    default_rate_pct: cls.region === 'SCOTLAND' ? 4 : 3,
    // Carried for the letter + audit: which template this offer is built against.
    jurisdiction: cls.region,
    applicant_is_company: cls.isCompany,
    term_months: term,
    min_term_months: OFFER_DEFAULTS.min_term_months,
    not_principal_residence: 'N/A',
    validity_days: OFFER_DEFAULTS.offer_validity_days,
  };
}

async function saveOfferVersion(id, body, req) {
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  // Client 05-10-2026: an offer cannot be created unless an indicative has actually
  // been sent to the applicant first. Guards the flow even if the UI is bypassed.
  const sentInd = await db.query(
    `SELECT TOP 1 1 AS ok FROM enquiry_indicatives
      WHERE enquiry_id = @p0 AND flag_deleted = 0 AND sent_at IS NOT NULL`, [id]);
  if (!sentInd.length) {
    return { error: 'An indicative must be sent to the applicant before an offer can be created.' };
  }
  // Client point #5 — the offer is built from the CHOSEN indicative version.
  const chosenIndId = body && (body.indicative_id || (body.offer && body.offer.indicative_id));
  const base = await defaultOfferJson(e, chosenIndId ? Number(chosenIndId) : null);
  const offerJson = { ...base, ...(body && body.offer ? body.offer : body || {}) };
  // Server is the source of truth for the broker fee £ and the payee name.
  offerJson.broker_fee_base = base.broker_fee_base; // always the chosen indicative's figure
  offerJson.broker_fee_amount = brokerFeeAmount(offerJson);
  offerJson.broker_fee_is_pct = !(offerJson.broker_fee_is_pct === false || offerJson.broker_fee_is_pct === 'false');
  offerJson.broker_payee_name = brokerNameOf(e);
  delete offerJson.finspace_fee;

  const prevRows = await db.query(
    `SELECT TOP 1 offer_json FROM enquiry_offers WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [id]);
  const prev = prevRows.length ? parse(prevRows[0].offer_json) : {};

  const version = await nextVersion('enquiry_offers', id);
  const validUntil = offerJson.valid_until || null;
  const ins = await db.query(
    `INSERT INTO enquiry_offers (enquiry_id, version_no, offer_json, status, valid_until, created_by)
     OUTPUT INSERTED.enquiry_offer_id AS id VALUES (@p0, @p1, @p2, 'Draft', @p3, @p4)`,
    [id, version, JSON.stringify(offerJson), validUntil, uid(req)]);
  const vid = ins[0] ? ins[0].id : null;

  await audit.write(audit.fromReq(req, {
    action: 'OFFER_SAVED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { offer_id: vid, version, changed_fields: diff(prev, offerJson) },
  }));
  return { ok: true, id: vid, version, offer: offerJson };
}

async function listOffers(id) {
  const rows = await db.query(
    `SELECT enquiry_offer_id, version_no, status, offer_pdf_doc_id, app_form_doc_id, valid_until,
            email_status, email_to, email_cc, email_subject, email_error, sent_at, sent_by, accepted_at, created_at, offer_json
       FROM enquiry_offers WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [id]);
  return rows.map((r) => ({ ...r, offer: parse(r.offer_json), offer_json: undefined }));
}

/** Generate offer PDF + application form, EMAIL both to applicant, advance status. */
async function sendOffer(id, vid, req) {
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  const rows = await db.query(
    `SELECT * FROM enquiry_offers WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [vid, id]);
  if (!rows.length) return { notFound: true };
  const rec = rows[0];
  const offerJson = parse(rec.offer_json);

  const to = recipientOf(e);
  if (!to.email) return { ok: false, error: 'No email to send the offer to — add the borrower email, or pick a broker that has an email' };

  // 1) generate offer PDF
  const offerBuf = await pdf.buildOfferPdf(offerJson, e);
  const offerDocId = await storePdf(id, `Offer_${e.enquiry_ref || id}_v${rec.version_no}.pdf`, offerBuf, req);

  // 2) application form — pre-filled from the enquiry (falls back to static template)
  let appBuf = null; let appDocId = null;
  try {
    const indRow = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [id]);
    const calc = indRow.length ? parse(indRow[0].calc_json) : {};
    // Loan figures on the form = this offer (client 14-10-2026), not the enquiry amount.
    appBuf = await pdf.buildApplicationFormPdf(e, calc, { offer: offerJson });
  } catch (err) {
    logger.warn(`[offer] app-form generation failed enquiry=${id}: ${err.message}`);
    const appAbs = path.join(global.basePath || path.join(__dirname, '..'), APP_FORM_TEMPLATE);
    if (fs.existsSync(appAbs)) appBuf = fs.readFileSync(appAbs);
  }
  if (appBuf) appDocId = await storePdf(id, `Application_Form_${e.enquiry_ref || id}.pdf`, appBuf, req);

  // 3) email both PDFs
  const cc = e.assigned_to_email ? [e.assigned_to_email] : [];
  // Email wording agreed with the client 29-09-2026 - now the default template
  // (config/emailTemplates.js), editable on Masters > Email Settings (client 17-10-2026).
  const greetName = to.isBroker ? to.name : (offerJson.borrower_name || to.name || 'Applicant');
  const mailVars = {
    Ref: e.enquiry_ref, Borrower: offerJson.borrower_name || e.applicant_name || e.company_name || '',
    SecurityAddress: pdf.securityAddress(e), RecipientName: greetName,
  };
  const { subject, html } = emailHub.render('ENQUIRY_OFFER', mailVars);
  const attachments = [{ filename: `Loan_Offer.pdf`, buffer: offerBuf }];
  if (appBuf) attachments.push({ filename: `Application_Form.pdf`, buffer: appBuf });
  // Same AML guidance document on every deal (api/assets/offer).
  if (fs.existsSync(AML_DOC)) attachments.push({ filename: 'AML_Acceptable_ID_Address_Proof.pdf', buffer: fs.readFileSync(AML_DOC) });
  else logger.warn(`[offer] AML document missing at ${AML_DOC} — offer email sent without it`);

  logger.info(`[offer] sending offer email enquiry=${id} vid=${vid} to=${to.email} cc=${cc.join(',')||'-'} attachments=${attachments.length}`);
  const sent = await mail.sendMail({
    to: to.email, cc, subject, html, attachments,
    // Email Settings master + Email History (client 17-10-2026)
    event: 'ENQUIRY_OFFER', ref: { module: 'ENQUIRY', id, number: e.enquiry_ref }, req, vars: mailVars,
  });
  if (sent.ok) logger.info(`[offer] email SENT enquiry=${id} vid=${vid}`);
  else logger.warn(`[offer] email FAILED enquiry=${id} vid=${vid}: ${sent.error}`);

  // 4) persist offer state
  // Client 26-10-2026: a new offer after one was accepted replaces it - the earlier
  // Accepted version is superseded too and the accepted stamp cleared until re-accepted.
  await db.query(
    `UPDATE enquiry_offers SET status = 'Superseded', updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0 AND status IN ('Sent', 'Accepted') AND enquiry_offer_id <> @p1 AND flag_deleted = 0`, [id, vid]);
  await db.query(
    `UPDATE enquiry_offers SET status = 'Sent', offer_pdf_doc_id = @p2, app_form_doc_id = @p3,
            email_status = @p4, email_to = @p5, email_cc = @p6, email_subject = @p7, email_error = @p8,
            sent_at = SYSUTCDATETIME(), sent_by = @p9, updated_at = SYSUTCDATETIME()
      WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1`,
    [vid, id, offerDocId, appDocId, sent.ok ? 'Sent' : 'Failed', to.email, cc.join(', ') || null,
      subject, sent.ok ? null : (sent.error || 'send failed'), uid(req)]);
  await db.query(
    `UPDATE enquiries SET current_offer_id = @p1, offer_sent_at = COALESCE(offer_sent_at, SYSUTCDATETIME()),
            offer_accepted_at = NULL, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0`, [id, vid, uid(req)]);

  // Client 06-10-2026: mail log entry for the offer e-mail (SENT vs GENERATED).
  await enquirySvc.addNote(id,
    `\u{1F4E7} Email ${sent.ok ? 'sent' : 'generated (NOT sent: ' + (sent.error || 'send failed') + ')'} \u2014 Offer v${rec.version_no} to ${to.email}`,
    req).catch(() => {});

  await workflow.applyStatus(id, workflow.S.QUALIFIED, req, { reason: 'Offer Sent', force: true });
  await audit.write(audit.fromReq(req, {
    action: sent.ok ? 'OFFER_EMAILED' : 'OFFER_EMAIL_FAILED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { offer_id: vid, version: rec.version_no, to: to.email, cc, subject,
      attachments: attachments.map((a) => a.filename), error: sent.ok ? null : sent.error },
  }));

  if (!sent.ok) return { ok: true, emailed: false, error: sent.error, offer_id: vid, document_id: offerDocId };
  return { ok: true, emailed: true, offer_id: vid, document_id: offerDocId, app_form_doc_id: appDocId };
}

/**
 * Client 16-10-2026 (Underwriting "Edit loan"): the terms changed after the deal reached
 * underwriting. E-mail the revised offer letter + revised application form (client 19-10-2026; no indicative) to
 * the broker - or the borrower when there is no broker e-mail - asking for the new terms to be
 * signed. CC = `opts.cc` (the BDM).
 * The new version becomes the live offer (status Sent); earlier Sent / Accepted versions are
 * Superseded so every reader (agreed terms, credit paper) uses the new terms. It is marked
 * Accepted when the signed copy is uploaded in underwriting.
 */
async function sendRevisedOffer(id, vid, req, opts = {}) {
  const e = await getEnquiry(id);
  if (!e) return { notFound: true };
  const rows = await db.query(
    `SELECT * FROM enquiry_offers WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [vid, id]);
  if (!rows.length) return { notFound: true };
  const rec = rows[0];
  const offerJson = parse(rec.offer_json);
  const to = recipientOf(e);

  const offerBuf = await pdf.buildOfferPdf(offerJson, e);
  const fileName = `Offer_${e.enquiry_ref || id}_v${rec.version_no}_revised.pdf`;
  const offerDocId = await storePdf(id, fileName, offerBuf, req);

  // Client 19-10-2026: the revised application form (pre-filled with the REVISED loan figures)
  // goes with the revised offer letter, same as the original Send Offer.
  let appBuf = null;
  try {
    const indRow = await db.query(`SELECT TOP 1 calc_json FROM enquiry_indicatives WHERE enquiry_id = @p0 AND flag_deleted = 0 ORDER BY version_no DESC`, [id]);
    const calc = indRow.length ? parse(indRow[0].calc_json) : {};
    appBuf = await pdf.buildApplicationFormPdf(e, calc, { offer: offerJson });
  } catch (err) {
    logger.warn(`[offer] revised app-form generation failed enquiry=${id}: ${err.message}`);
  }
  if (appBuf) await storePdf(id, `Application_Form_${e.enquiry_ref || id}_v${rec.version_no}_revised.pdf`, appBuf, req);
  const attachments = [{ filename: 'Revised_Loan_Offer.pdf', buffer: offerBuf }];
  if (appBuf) attachments.push({ filename: 'Revised_Application_Form.pdf', buffer: appBuf });

  const ccIn = Array.isArray(opts.cc) ? opts.cc : [];
  const seen = new Set();
  const cc = ccIn.map((x) => String(x || '').trim())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))
    .filter((x) => { const k = x.toLowerCase(); if (seen.has(k) || (to.email && k === String(to.email).toLowerCase())) return false; seen.add(k); return true; });

  let sent = { ok: false, error: 'No email to send the revised offer to — add the borrower email, or pick a broker that has an email' };
  const secAddr = pdf.securityAddress(e);
  // Subject + body from the default template (config/emailTemplates.js, client 17-10-2026).
  const applicant = e.applicant_name || e.company_name || '';
  const mailVars = {
    Ref: e.enquiry_ref, Borrower: applicant, SecurityAddress: secAddr,
    RecipientName: to.isBroker ? to.name : (offerJson.borrower_name || to.name || 'Applicant'),
    ForBorrower: applicant ? ` for ${applicant}` : '', SecurityInBrackets: secAddr ? ` (${secAddr})` : '',
  };
  const { subject, html } = emailHub.render('ENQUIRY_REVISED_OFFER', mailVars);
  if (to.email) {
    logger.info(`[offer] sending REVISED offer enquiry=${id} vid=${vid} to=${to.email} cc=${cc.join(',') || '-'}`);
    sent = await mail.sendMail({
      to: to.email, cc, subject, html, attachments,
      // Email Settings master + Email History (client 17-10-2026)
      event: 'ENQUIRY_REVISED_OFFER', ref: { module: 'ENQUIRY', id, number: e.enquiry_ref }, req, vars: mailVars,
    });
    if (!sent.ok) logger.warn(`[offer] revised offer email FAILED enquiry=${id} vid=${vid}: ${sent.error}`);
  }

  await db.query(
    `UPDATE enquiry_offers SET status = 'Superseded', updated_at = SYSUTCDATETIME()
      WHERE enquiry_id = @p0 AND status IN ('Sent', 'Accepted') AND enquiry_offer_id <> @p1 AND flag_deleted = 0`, [id, vid]);
  await db.query(
    `UPDATE enquiry_offers SET status = 'Sent', offer_pdf_doc_id = @p2,
            email_status = @p3, email_to = @p4, email_cc = @p5, email_subject = @p6, email_error = @p7,
            sent_at = SYSUTCDATETIME(), sent_by = @p8, updated_at = SYSUTCDATETIME()
      WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1`,
    [vid, id, offerDocId, sent.ok ? 'Sent' : 'Failed', to.email || null, cc.join(', ') || null,
      subject, sent.ok ? null : (sent.error || 'send failed'), uid(req)]);
  await db.query(
    'UPDATE enquiries SET current_offer_id = @p1, updated_by = @p2, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0',
    [id, vid, uid(req)]);
  await enquirySvc.addNote(id,
    `\u{1F4E7} Email ${sent.ok ? 'sent' : 'generated (NOT sent: ' + (sent.error || 'send failed') + ')'} — Revised offer v${rec.version_no} to ${to.email || '-'} (sign new terms)`,
    req).catch(() => {});
  await audit.write(audit.fromReq(req, {
    action: sent.ok ? 'REVISED_OFFER_EMAILED' : 'REVISED_OFFER_EMAIL_FAILED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id,
    details: { offer_id: vid, version: rec.version_no, to: to.email || null, cc, subject, error: sent.ok ? null : sent.error },
  }));
  return { ok: true, emailed: !!sent.ok, error: sent.ok ? null : sent.error, offer_id: vid, version: rec.version_no, document_id: offerDocId, to: to.email || null, cc };
}

async function resendOffer(id, vid, req) {
  // Re-run the send for an existing (failed or prior) offer version.
  return sendOffer(id, vid, req);
}

async function acceptOffer(id, vid, req) {
  const rows = await db.query(
    `SELECT 1 FROM enquiry_offers WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1 AND flag_deleted = 0`, [vid, id]);
  if (!rows.length) return { notFound: true };
  await db.query(
    `UPDATE enquiry_offers SET status = 'Accepted', accepted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
      WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1`, [vid, id]);
  await db.query(`UPDATE enquiries SET offer_accepted_at = SYSUTCDATETIME(), updated_by = @p1, updated_at = SYSUTCDATETIME() WHERE enquiry_id = @p0`, [id, uid(req)]);
  // If this enquiry was already converted, push the accepted figures onto the
  // application so underwriting and the portfolio schedule use the terms that
  // were actually accepted, not the ones that happened to exist at conversion.
  try {
    const conv = await db.query(
      `SELECT TOP 1 converted_application_id AS app_id FROM enquiries WHERE enquiry_id = @p0`, [id]);
    const appId = conv.length ? conv[0].app_id : null;
    if (appId) {
      const off = await db.query(
        `SELECT TOP 1 offer_json FROM enquiry_offers WHERE enquiry_offer_id = @p0 AND enquiry_id = @p1`, [vid, id]);
      const o = off.length ? (parse(off[0].offer_json) || {}) : {};
      const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
      const gross = num(o.gross_loan_amount);
      const term = num(o.term_months);
      const rate = num(o.monthly_rate_pct);
      if (gross !== null || term !== null || rate !== null) {
        await db.query(
          `UPDATE applications
              SET amount_requested = COALESCE(@p1, amount_requested),
                  term_months      = COALESCE(@p2, term_months),
                  monthly_fee_pct  = COALESCE(@p3, monthly_fee_pct),
                  updated_at = SYSUTCDATETIME()
            WHERE application_id = @p0`, [appId, gross, term, rate]);
        logger.info(`[offer] accepted offer ${vid} pushed to application ${appId}: gross ${gross}, term ${term}, rate ${rate}`);
        // Client 19-10-2026: the accepted offer's LTV (its own, else its indicative's) is the
        // application's TOTAL LTV - same figure as the enquiry. The application's LTV (our
        // loan only, from the enquiry) is left as it is.
        const offLtv = num(o.ltv_pct) !== null ? num(o.ltv_pct)
          : await enquirySvc.indicativeLtv(o.indicative_id, id).catch(() => null);
        if (offLtv !== null) {
          await db.query('UPDATE applications SET total_ltv_pct = @p1 WHERE application_id = @p0',
            [appId, offLtv > 999.999 ? 999.999 : offLtv]);
        }
      }
    }
  } catch (e) {
    logger.warn('[offer] could not push accepted offer figures to the application: ' + e.message);
  }
  await workflow.applyStatus(id, workflow.S.OFFER_ACCEPTED, req, { reason: 'Offer Accepted', force: true });
  await audit.write(audit.fromReq(req, {
    action: 'OFFER_ACCEPTED', moduleKey: MODULE_KEY, entityName: 'enquiries', entityId: id, details: { offer_id: vid },
  }));
  return { ok: true };
}

module.exports = {
  previewIndicative, saveIndicative, listIndicatives, sendIndicative,
  saveOfferVersion, listOffers, sendOffer, resendOffer, acceptOffer, sendRevisedOffer, indicativePdf,
};
