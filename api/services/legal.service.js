'use strict';

/**
 * Legal & Completion module. Runs on the applications table:
 * cases enter at status LEGAL (from a credit approval) and progress through the
 * legal stage pipeline to Completion, then Complete -> COMPLETED (portfolio).
 * Client Figma: /legal. Underwriting module is untouched.
 */

const db = require('../config/database');
const audit = require('./audit.service');
const CFG = require('../config/underwriting.config');
const uw = require('./underwriting.service');

const MODULE_KEY = 'LEGAL';
const STAGES = ['Offer Issued', 'Enquiries', 'Replies to Enquiries', 'Mortgage Deed', 'Completion'];

function actorId(req) { return req && req.userData ? req.userData.userId : null; }

async function statusId(code) {
  const r = await db.query('SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code=@p0 AND flag_deleted=0', [String(code).toUpperCase()]);
  return r.length ? r[0].id : null;
}

const SELECT_APP = `
  a.application_id, a.application_ref, a.amount_requested, a.legal_stage,
  a.offer_date, a.target_completion_date, a.completed_at, a.application_status_id,
  st.code AS status_code, st.name AS status_name,
  bs.name AS borrower_solicitor, ls.name AS lender_solicitor,
  a.borrower_solicitor_id, a.lender_solicitor_id,
  sec.property_address,
  COALESCE(ap.company_name, CONCAT(ap.first_name,' ',ap.last_name), e.company_name, e.applicant_name) AS applicant_name`;

const JOINS = `
  FROM applications a
  LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
  LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
  LEFT JOIN solicitors bs ON bs.solicitor_id = a.borrower_solicitor_id
  LEFT JOIN solicitors ls ON ls.solicitor_id = a.lender_solicitor_id
  OUTER APPLY (SELECT TOP 1 x.* FROM application_applicants aa2 JOIN applicants x ON x.applicant_id=aa2.applicant_id
    WHERE aa2.application_id=a.application_id ORDER BY CASE WHEN aa2.applicant_role='Primary' THEN 0 ELSE 1 END, x.applicant_id) ap
  OUTER APPLY (SELECT TOP 1 s.* FROM application_security s WHERE s.application_id=a.application_id AND s.flag_deleted=0 ORDER BY s.security_id) sec`;

async function conditionCounts(appIds) {
  if (!appIds.length) return {};
  const rows = await db.query(
    `SELECT application_id,
            SUM(CASE WHEN status='Satisfied' THEN 1 ELSE 0 END) AS met,
            COUNT(*) AS total
       FROM legal_conditions WHERE flag_deleted=0 AND application_id IN (${appIds.map((_, i) => '@p' + i).join(',')})
      GROUP BY application_id`, appIds);
  const map = {};
  for (const r of rows) map[r.application_id] = { met: r.met, total: r.total };
  return map;
}

function shape(a, cond) {
  const c = cond[a.application_id] || { met: 0, total: 0 };
  return {
    application_id: a.application_id,
    application_ref: a.application_ref,
    applicant_name: a.applicant_name,
    amount_requested: a.amount_requested,
    property_address: a.property_address,
    borrower_solicitor: a.borrower_solicitor,
    lender_solicitor: a.lender_solicitor,
    borrower_solicitor_id: a.borrower_solicitor_id,
    lender_solicitor_id: a.lender_solicitor_id,
    offer_date: a.offer_date,
    target_completion_date: a.target_completion_date,
    completed_at: a.completed_at,
    legal_stage: a.legal_stage || 'Offer Issued',
    conditions_met: c.met,
    conditions_total: c.total,
    conditions_all_met: c.total > 0 && c.met === c.total,
    status_code: a.status_code,
    status_name: a.status_name,
  };
}


/** Server-side paging helpers (same contract as enquiries / applications: page, per_page -> meta). */
function pageArgs(q, defPer = 10) {
  const n = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : d; };
  const page = Math.max(1, n(q && q.page, 1));
  const per = Math.min(100, Math.max(1, n(q && q.per_page, defPer)));
  return { page, per, off: (page - 1) * per };
}
function pageSlice(list, pa) {
  const total = list.length;
  return { rows: list.slice(pa.off, pa.off + pa.per), meta: { page: pa.page, per_page: pa.per, total, total_pages: Math.ceil(total / pa.per) || 1 } };
}

async function list(q = {}) {
  const pa = pageArgs(q);
  const tab = String(q.tab || '') === 'completed' ? 'completed' : 'active';
  const active = await db.query(`SELECT ${SELECT_APP} ${JOINS} WHERE a.flag_deleted=0 AND st.code='LEGAL' ORDER BY a.target_completion_date`);
  const completed = await db.query(`SELECT ${SELECT_APP} ${JOINS} WHERE a.flag_deleted=0 AND st.code='COMPLETED' ORDER BY a.completed_at DESC`);
  const cond = await conditionCounts([...active, ...completed].map((r) => r.application_id));
  const activeCases = active.map((a) => shape(a, cond));
  const completedCases = completed.map((a) => shape(a, cond));

  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86400000);
  const completingThisWeek = activeCases.filter((c) => c.target_completion_date && new Date(c.target_completion_date) <= weekEnd).length;
  const readyToComplete = activeCases.filter((c) => c.legal_stage === 'Completion' && c.conditions_all_met).length;

  const stageCounts = {};
  STAGES.forEach((s) => { stageCounts[s] = activeCases.filter((c) => c.legal_stage === s).length; });

  // KPIs / stage counts use every case; only the requested tab's page is returned.
  const paged = pageSlice(tab === 'completed' ? completedCases : activeCases, pa);
  return {
    active: tab === 'active' ? paged.rows : [],
    completed: tab === 'completed' ? paged.rows : [],
    totals: { active: activeCases.length, completed: completedCases.length },
    meta: paged.meta,
    stages: STAGES,
    stage_counts: stageCounts,
    kpis: {
      in_legal: activeCases.length,
      ready_to_complete: readyToComplete,
      completing_this_week: completingThisWeek,
      completed: completedCases.length,
    },
  };
}

async function getCase(id) {
  const rows = await db.query(`SELECT ${SELECT_APP} ${JOINS} WHERE a.application_id=@p0 AND a.flag_deleted=0`, [id]);
  if (!rows.length) return null;
  const cond = await conditionCounts([id]);
  const c = shape(rows[0], cond);
  c.conditions = await listConditions(id);
  return c;
}

async function listConditions(id) {
  return db.query(
    `SELECT legal_condition_id, name, status, sort_order FROM legal_conditions
      WHERE application_id=@p0 AND flag_deleted=0 ORDER BY sort_order, legal_condition_id`, [id]);
}

async function setStage(id, stage, req) {
  if (!STAGES.includes(stage)) return { ok: false, error: 'Invalid legal stage' };
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id=@p0 AND flag_deleted=0', [id]);
  if (!exists.length) return { ok: false, notFound: true };
  await db.query('UPDATE applications SET legal_stage=@p1, updated_by=@p2, updated_at=SYSUTCDATETIME() WHERE application_id=@p0', [id, stage, actorId(req)]);
  await audit.write(audit.fromReq(req, { action: 'LEGAL_STAGE_CHANGE', moduleKey: MODULE_KEY, entityName: 'applications', entityId: id, details: { stage } }));
  return { ok: true, stage };
}

async function updateCase(id, body, req) {
  const exists = await db.query('SELECT 1 FROM applications WHERE application_id=@p0 AND flag_deleted=0', [id]);
  if (!exists.length) return { ok: false, notFound: true };
  const allow = ['borrower_solicitor_id', 'lender_solicitor_id', 'offer_date', 'target_completion_date', 'legal_stage'];
  const sets = []; const params = [];
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      if (k === 'legal_stage' && body[k] && !STAGES.includes(body[k])) continue;
      sets.push(`${k}=@p${params.length}`); params.push(body[k] === '' ? null : body[k]);
    }
  }
  if (!sets.length) return { ok: true, id };
  params.push(actorId(req)); params.push(id);
  await db.query(`UPDATE applications SET ${sets.join(', ')}, updated_by=@p${params.length - 2}, updated_at=SYSUTCDATETIME() WHERE application_id=@p${params.length - 1}`, params);
  await audit.write(audit.fromReq(req, { action: 'LEGAL_CASE_UPDATE', moduleKey: MODULE_KEY, entityName: 'applications', entityId: id, details: { fields: sets } }));
  return { ok: true, id };
}

/* ---- conditions ---- */
async function addCondition(id, name, req) {
  const text = String(name || '').trim();
  if (!text) return { ok: false, error: 'Condition name is required' };
  const ord = await db.query('SELECT ISNULL(MAX(sort_order),-1)+1 AS n FROM legal_conditions WHERE application_id=@p0 AND flag_deleted=0', [id]);
  const out = await db.query(
    `INSERT INTO legal_conditions (application_id, name, status, sort_order, created_by)
     OUTPUT INSERTED.legal_condition_id AS id VALUES (@p0,@p1,'Pending',@p2,@p3)`, [id, text.slice(0, 200), ord[0].n, actorId(req)]);
  return { ok: true, id: out[0].id };
}
async function toggleCondition(id, condId, req) {
  const row = await db.query('SELECT status FROM legal_conditions WHERE legal_condition_id=@p0 AND application_id=@p1 AND flag_deleted=0', [condId, id]);
  if (!row.length) return { ok: false, notFound: true };
  const next = row[0].status === 'Satisfied' ? 'Pending' : 'Satisfied';
  await db.query('UPDATE legal_conditions SET status=@p1, updated_by=@p2, updated_at=SYSUTCDATETIME() WHERE legal_condition_id=@p0', [condId, next, actorId(req)]);
  return { ok: true, status: next };
}
async function deleteCondition(id, condId, req) {
  await db.query('UPDATE legal_conditions SET flag_deleted=1, deleted_on=SYSUTCDATETIME(), updated_by=@p2 WHERE legal_condition_id=@p0 AND application_id=@p1', [condId, id, actorId(req)]);
  return { ok: true };
}

async function complete(id, req) {
  const rows = await db.query('SELECT application_id, application_ref FROM applications WHERE application_id=@p0 AND flag_deleted=0', [id]);
  if (!rows.length) return { ok: false, notFound: true };
  const cond = await conditionCounts([id]);
  const c = cond[id] || { met: 0, total: 0 };
  if (c.total > 0 && c.met < c.total) return { ok: false, error: 'All conditions must be satisfied before completion' };
  const sid = await statusId('COMPLETED');
  await db.query(
    `UPDATE applications SET application_status_id=@p1, legal_stage='Completion',
            completed_at=SYSUTCDATETIME(), updated_by=@p2, updated_at=SYSUTCDATETIME()
      WHERE application_id=@p0`, [id, sid, actorId(req)]);
  await db.query(`UPDATE legal_cases SET status='Completed', updated_by=@p1, updated_at=SYSUTCDATETIME() WHERE application_id=@p0 AND flag_deleted=0`, [id, actorId(req)]);
  await audit.write(audit.fromReq(req, { action: 'LEGAL_COMPLETED', moduleKey: MODULE_KEY, entityName: 'applications', entityId: id, details: { ref: rows[0].application_ref } }));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  CREDIT PAPER (Credit Deal Summary)                                 */
/*  Mirrors the client's "Credit Paper - Example.docx". The single      */
/*  source of truth is underwriting step 8 (draft_legal) `data` JSON,   */
/*  so the underwriting screen and this Legal & Completion tab always   */
/*  read and write the SAME record - never a copy.                      */
/*  Filled by the Legal team from /legal.                               */
/* ------------------------------------------------------------------ */

const CP_STEP_NO = 8;

function safeJson(v) { try { return (typeof v === 'string' ? JSON.parse(v) : v) || {}; } catch (e) { return {}; } }

/** Locate the underwriting step-8 row behind an application. */
async function cpRow(appId) {
  const rows = await db.query(
    `SELECT TOP 1 c.underwriting_case_id AS case_id, s.underwriting_step_id AS step_id, s.data, s.status
       FROM underwriting_cases c
       LEFT JOIN underwriting_steps s
         ON s.underwriting_case_id = c.underwriting_case_id AND s.step_no = @p1
      WHERE c.application_id = @p0 AND c.flag_deleted = 0
      ORDER BY c.underwriting_case_id DESC`,
    [appId, CP_STEP_NO]);
  return rows.length ? rows[0] : null;
}

/**
 * Credit paper is an UPLOADED DOCUMENT, not a form. These delegate to the
 * underwriting document store for step 8, so the Legal tab and the
 * underwriting screen list and delete the very same files.
 */
async function getCreditPaper(appId) {
  const app = await db.query('SELECT application_id, application_ref FROM applications WHERE application_id=@p0 AND flag_deleted=0', [appId]);
  if (!app.length) return { notFound: true };
  const def = CFG.stepByNo(CP_STEP_NO);
  const row = await cpRow(appId);
  const documents = row ? await uw.listPhotos(row.case_id, CP_STEP_NO) : [];
  return {
    application_id: appId,
    application_ref: app[0].application_ref,
    case_id: row ? row.case_id : null,
    step_no: CP_STEP_NO,
    step_status: row ? row.status : null,
    editable: !!(row && row.step_id),
    label: def.filesLabel || 'Credit Paper Document',
    documents,
  };
}

/** Upload a credit paper document (base64 body, same shape as underwriting). */
async function uploadCreditPaper(appId, body, req) {
  const row = await cpRow(appId);
  if (!row) return { ok: false, notFound: true };
  const out = await uw.addPhoto(row.case_id, CP_STEP_NO, body || {}, req);
  if (!out || !out.ok) return out || { ok: false, error: 'Upload failed' };
  await audit.write(audit.fromReq(req, {
    action: 'CREDIT_PAPER_UPLOADED', moduleKey: MODULE_KEY, entityName: 'applications', entityId: appId,
    details: { case_id: row.case_id, step_no: CP_STEP_NO, file_name: body && body.file_name, document_id: out.id },
  }));
  return out;
}

async function getCreditPaperFile(appId, docId) {
  const row = await cpRow(appId);
  if (!row) return null;
  return uw.getPhoto(row.case_id, docId);
}

async function deleteCreditPaper(appId, docId, req) {
  const row = await cpRow(appId);
  if (!row) return { ok: false, notFound: true };
  await uw.deletePhoto(row.case_id, docId, req);
  await audit.write(audit.fromReq(req, {
    action: 'CREDIT_PAPER_DELETED', moduleKey: MODULE_KEY, entityName: 'applications', entityId: appId,
    details: { case_id: row.case_id, document_id: docId },
  }));
  return { ok: true };
}

module.exports = {
  list, getCase, setStage, updateCase, addCondition, toggleCondition, deleteCondition, complete, listConditions,
  getCreditPaper, uploadCreditPaper, getCreditPaperFile, deleteCreditPaper, CP_STEP_NO,
  STAGES, MODULE_KEY,
};
