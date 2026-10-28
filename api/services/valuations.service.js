'use strict';

/**
 * Valuations module — the Valuation-team view of underwriting Step 2 (Valuation
 * Instruction). A row appears here once "Send to Valuation Team" is clicked in
 * underwriting (data.fields.valuation_sent = true). Accept/Reject here writes the
 * result straight back onto the same underwriting step, so both views stay in sync.
 */
const db = require('../config/database');

function parse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
const money = (v) => (v === null || v === undefined || v === '' ? null : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }));
const dOnly = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };

function statusOf(f) {
  const r = String(f.valuation_result || '');
  if (r === 'accepted') return { key: 'accepted', label: 'Accepted', tone: 'success', completed: true };
  if (r === 'rejected') return { key: 'rejected', label: 'Rejected', tone: 'danger', completed: true };
  if (f.market_value || f.report_received) return { key: 'report-received', label: 'Report Received', tone: 'info', completed: false };
  return { key: 'instructed', label: 'Instructed', tone: 'warning', completed: false };
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
  const rows = await db.query(`
    SELECT s.underwriting_step_id AS id, c.underwriting_case_id AS case_id, c.application_id,
           a.application_ref, a.amount_requested, a.ltv_pct, s.data, s.updated_at,
           sec.property_address
      FROM underwriting_steps s
      JOIN underwriting_cases c ON c.underwriting_case_id = s.underwriting_case_id AND c.flag_deleted = 0
      JOIN applications a       ON a.application_id = c.application_id
      OUTER APPLY (SELECT TOP 1 property_address FROM application_security asec
                     WHERE asec.application_id = a.application_id AND asec.flag_deleted = 0
                     ORDER BY asec.security_id) sec
     WHERE s.step_no = 2 AND ISJSON(s.data) = 1
       AND JSON_VALUE(s.data, '$.fields.valuation_sent') = 'true'
     ORDER BY s.updated_at DESC`);

  const all = rows.map((row) => {
    const f = (parse(row.data).fields) || {};
    const st = statusOf(f);
    return {
      id: row.id,
      ref: 'VAL-' + String(row.id).padStart(3, '0'),
      applicationId: row.application_ref || ('APP-' + row.application_id),
      application_id: row.application_id,
      address: row.property_address || '—',
      valuer: f.valuer_firm || '—',
      type: f.valuation_type || '—',
      instructionDate: dOnly(f.instruction_date) || dOnly(row.updated_at) || '—',
      reportDate: f.market_value ? (dOnly(row.updated_at) || null) : null,
      marketValue: money(f.market_value),
      gdv: money(f.gdv_value),
      ltv: row.ltv_pct != null ? row.ltv_pct + '%' : '—',
      // report popup fields (raw, for editing)
      market_value: f.market_value ?? null,
      gdv_value: f.gdv_value ?? null,
      condition_rating: f.condition_rating ?? null,
      special_assumptions: f.special_assumptions ?? null,
      recommendation: f.valuation_recommendation ?? null,
      valuation_result: f.valuation_result || null,
      statusKey: st.key, status: st.label, statusTone: st.tone, completed: st.completed,
    };
  });
  // KPI / tab counts use every valuation; only the requested tab's page is returned.
  const counts = { active: 0, completed: 0, instructed: 0, 'report-received': 0, accepted: 0, rejected: 0 };
  all.forEach((v) => { counts[v.completed ? 'completed' : 'active'] += 1; counts[v.statusKey] = (counts[v.statusKey] || 0) + 1; });
  const paged = pageSlice(all.filter((v) => (tab === 'completed' ? v.completed : !v.completed)), pa);
  return { rows: paged.rows, meta: paged.meta, counts };
}

/** Accept/Reject (and optionally record report figures) from the Valuations tab. Writes back onto UW step 2. */
async function decide(stepId, body, req) {
  const rows = await db.query(
    'SELECT underwriting_case_id, step_no, data FROM underwriting_steps WHERE underwriting_step_id = @p0', [stepId]);
  if (!rows.length || Number(rows[0].step_no) !== 2) return { ok: false, notFound: true };
  const data = parse(rows[0].data);
  data.fields = data.fields || {};
  const f = data.fields;
  const result = String(body.result || '');
  if (result === 'received') {
    f.report_received = true;
    await db.query('UPDATE underwriting_steps SET data = @p1, updated_at = SYSUTCDATETIME() WHERE underwriting_step_id = @p0', [stepId, JSON.stringify(data)]);
    return { ok: true, id: stepId, result };
  }
  if (result !== 'accepted' && result !== 'rejected') return { ok: false, errors: { result: 'accepted, rejected or received required' } };
  // capture report figures entered in the popup
  if (body.market_value !== undefined) f.market_value = body.market_value;
  if (body.gdv_value !== undefined) f.gdv_value = body.gdv_value;
  if (body.condition_rating !== undefined) f.condition_rating = body.condition_rating;
  if (body.special_assumptions !== undefined) f.special_assumptions = body.special_assumptions;
  if (body.recommendation !== undefined) f.valuation_recommendation = body.recommendation;
  f.valuation_result = result;
  await db.query(
    'UPDATE underwriting_steps SET data = @p1, updated_at = SYSUTCDATETIME() WHERE underwriting_step_id = @p0',
    [stepId, JSON.stringify(data)]);
  return { ok: true, id: stepId, result };
}

module.exports = { list, decide };
