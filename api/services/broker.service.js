'use strict';

/**
 * Brokers (introducers) performance listing - client 20-10-2026.
 *
 * Its own sidebar menu below Customers (moved out of Masters) so the lender can see
 * which brokers bring the most enquiries, applications and completions, the portfolio
 * value they introduced and the average rate (margin) on those loans.
 *
 * Broker of a deal = applications.broker_id, falling back to the enquiry's broker_id.
 *   enquiries        enquiries introduced (not deleted)
 *   enquiry_value    Σ amount requested on those enquiries
 *   applications     enquiries converted to an application
 *   underwriting     open underwriting cases (not yet in Portfolio / rejected / closed / returned)
 *   completions      loans in the portfolio (any status - live, redeemed, …)
 *   portfolio_total  Σ loan principal (gross) of those loans
 *   live_balance     Σ outstanding balance of the ACTIVE loans
 *   avg_rate_pct     average monthly rate on those loans
 *   conversion_pct   completions ÷ enquiries
 * Add / edit still uses the Broker master form (same table, same validation).
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const fileGuard = require('../utils/fileGuard');
const audit = require('./audit.service');
const { LATEST_GROSS_APPLY, LOAN_AMOUNT_SQL, latestGrossApply, appNetSql } = require('../utils/loanAmount');

const BROKER_KEY = 'COALESCE(a.broker_id, e.broker_id)';

async function stats(q = {}) {
  const search = String(q.search || '').trim();
  const params = {};
  let where = 'b.flag_deleted = 0';
  if (search) {
    where += ` AND (b.name LIKE @s OR b.company LIKE @s OR b.code LIKE @s OR b.email LIKE @s)`;
    params.s = `%${search}%`;
  }
  if (String(q.active || '') === '1') where += ' AND b.is_active = 1';

  const rows = await db.queryNamed(`
    SELECT b.broker_id, b.code, b.name, b.company, b.email, b.phone, b.fca_number, b.commission_pct, b.is_active,
           ISNULL(eq.enquiries, 0)       AS enquiries,
           ISNULL(eq.enquiry_value, 0)   AS enquiry_value,
           CONVERT(varchar(10), eq.last_enquiry_at, 23) AS last_enquiry_at,
           ISNULL(ap.applications, 0)    AS applications,
           ISNULL(uw.underwriting, 0)    AS underwriting,
           ISNULL(ln.completions, 0)     AS completions,
           ISNULL(ln.portfolio_total, 0) AS portfolio_total,
           ISNULL(ln.live_balance, 0)    AS live_balance,
           ln.avg_rate_pct
      FROM brokers b
      LEFT JOIN (
        SELECT e.broker_id, COUNT(*) AS enquiries,
               SUM(COALESCE(TRY_CONVERT(DECIMAL(18,2), e.amount_requested), 0)) AS enquiry_value,
               MAX(e.created_at) AS last_enquiry_at
          FROM enquiries e
         WHERE e.flag_deleted = 0 AND e.broker_id IS NOT NULL
         GROUP BY e.broker_id
      ) eq ON eq.broker_id = b.broker_id
      LEFT JOIN (
        SELECT ${BROKER_KEY} AS broker_id, COUNT(DISTINCT a.application_id) AS applications
          FROM applications a
          LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
         WHERE a.flag_deleted = 0 AND ${BROKER_KEY} IS NOT NULL
         GROUP BY ${BROKER_KEY}
      ) ap ON ap.broker_id = b.broker_id
      LEFT JOIN (
        SELECT ${BROKER_KEY} AS broker_id, COUNT(DISTINCT uc.underwriting_case_id) AS underwriting
          FROM underwriting_cases uc
          JOIN applications a ON a.application_id = uc.application_id AND a.flag_deleted = 0
          LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
         WHERE uc.flag_deleted = 0 AND ${BROKER_KEY} IS NOT NULL
           AND uc.status NOT IN ('In Portfolio', 'Rejected', 'Closed', 'Returned to BDM')
         GROUP BY ${BROKER_KEY}
      ) uw ON uw.broker_id = b.broker_id
      LEFT JOIN (
        SELECT ${BROKER_KEY} AS broker_id,
               COUNT(DISTINCT l.loan_id) AS completions,
               SUM(COALESCE(l.principal, 0)) AS portfolio_total,
               SUM(CASE WHEN l.status = 'Active' THEN COALESCE(l.outstanding_balance, 0) ELSE 0 END) AS live_balance,
               AVG(CAST(l.rate_pct AS DECIMAL(9,4))) AS avg_rate_pct
          FROM loans l
          JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
          LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
         WHERE l.flag_deleted = 0 AND ${BROKER_KEY} IS NOT NULL
         GROUP BY ${BROKER_KEY}
      ) ln ON ln.broker_id = b.broker_id
     WHERE ${where}
     ORDER BY ISNULL(eq.enquiries, 0) DESC, ISNULL(ln.portfolio_total, 0) DESC, b.name`, params);

  const n = (v) => { const k = Number(v); return Number.isFinite(k) ? k : 0; };
  const out = rows.map((r) => ({
    ...r,
    enquiries: n(r.enquiries), applications: n(r.applications), underwriting: n(r.underwriting), completions: n(r.completions),
    enquiry_value: n(r.enquiry_value), portfolio_total: n(r.portfolio_total), live_balance: n(r.live_balance),
    avg_rate_pct: r.avg_rate_pct == null ? null : Math.round(n(r.avg_rate_pct) * 100) / 100,
    conversion_pct: n(r.enquiries) ? Math.round((n(r.completions) / n(r.enquiries)) * 10000) / 100 : null,
  }));
  const totals = out.reduce((t, r) => ({
    brokers: t.brokers + 1,
    enquiries: t.enquiries + r.enquiries,
    applications: t.applications + r.applications,
    completions: t.completions + r.completions,
    portfolio_total: t.portfolio_total + r.portfolio_total,
    live_balance: t.live_balance + r.live_balance,
  }), { brokers: 0, enquiries: 0, applications: 0, completions: 0, portfolio_total: 0, live_balance: 0 });
  return { rows: out, totals };
}

/* ================================================================== */
/*  Broker dashboard (client 22-10-2026) - same layout as Customer 360  */
/* ================================================================== */
const DOC_DIR = path.join('uploads', 'broker_documents');
/** Document types offered on the broker upload (free text is stored, so the list can grow). */
const BROKER_DOC_TYPES = [
  'Signed Broker Agreement', 'Terms of Business', 'FCA Registration', 'Professional Indemnity Insurance',
  'Company Registration', 'ID / KYC', 'Bank Details', 'Correspondence', 'Other',
];
const CUSTOMER = (a) =>
  `COALESCE(NULLIF(${a}.company_name, ''), NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(${a}.first_name,''),' ',COALESCE(${a}.last_name,'')))), ''), ${a}.email)`;
const num = (v) => { const k = Number(v); return Number.isFinite(k) ? k : 0; };

async function brokerRow(id) {
  const rows = await db.queryNamed(
    `SELECT b.broker_id, b.code, b.name, b.company, b.email, b.phone, b.fca_number, b.address,
            b.commission_pct, b.is_active, b.created_at
       FROM brokers b WHERE b.broker_id = @id AND b.flag_deleted = 0`, { id: Number(id) || 0 });
  return rows[0] || null;
}

async function detail(id) {
  const profile = await brokerRow(id);
  if (!profile) return null;
  const p = { id: profile.broker_id };
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { console.error(`[broker] ${label}:`, e && e.message); return []; } }; // eslint-disable-line no-console

  const [enquiries, applications, facilities, documents] = await Promise.all([
    safe('enquiries', () => db.queryNamed(
      `SELECT e.enquiry_id, e.enquiry_ref, COALESCE(NULLIF(e.company_name,''), e.applicant_name) AS customer,
              ISNULL(s.name,'—') AS status, s.code AS status_code, ISNULL(${LOAN_AMOUNT_SQL},0) AS amount,
              ISNULL(u.full_name,'—') AS bdm, e.created_at,
              app.application_id, app.status_code AS app_status_code, ln.status AS loan_status, ln.principal AS loan_principal
         FROM enquiries e
         LEFT JOIN enquiry_statuses s ON s.enquiry_status_id = e.enquiry_status_id
         LEFT JOIN users u ON u.user_id = e.assigned_to
         ${LATEST_GROSS_APPLY}
         OUTER APPLY (SELECT TOP 1 a.application_id, ast.code AS status_code FROM applications a
                       LEFT JOIN application_statuses ast ON ast.application_status_id = a.application_status_id
                       WHERE a.enquiry_id = e.enquiry_id AND a.flag_deleted = 0 ORDER BY a.application_id DESC) app
         OUTER APPLY (SELECT TOP 1 l.status, l.principal FROM loans l
                       WHERE l.application_id = app.application_id AND l.flag_deleted = 0 ORDER BY l.loan_id DESC) ln
        WHERE e.flag_deleted = 0 AND e.broker_id = @id
        ORDER BY e.created_at DESC`, p)),
    safe('applications', () => db.queryNamed(
      `SELECT a.application_id, a.application_ref, ISNULL(${CUSTOMER('ap')}, COALESCE(NULLIF(e.company_name,''), e.applicant_name)) AS customer,
              ISNULL(pr.name,'—') AS product, a.amount_requested, ISNULL(st.name,'Pending') AS status,
              uc.status AS uw_status, uc.underwriting_case_id, ISNULL(u.full_name,'—') AS bdm, a.created_at,
              TRY_CONVERT(DECIMAL(18,2), CASE WHEN ISJSON(a.agreed_terms) = 1 THEN JSON_VALUE(a.agreed_terms, '$.broker_fee') END) AS broker_fee
         FROM applications a
         LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
         LEFT JOIN application_statuses st ON st.application_status_id = a.application_status_id
         LEFT JOIN products pr ON pr.product_id = a.product_id
         LEFT JOIN users u ON u.user_id = a.assigned_to
         LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
         LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
         OUTER APPLY (SELECT TOP 1 x.status, x.underwriting_case_id FROM underwriting_cases x
                       WHERE x.application_id = a.application_id AND x.flag_deleted = 0 ORDER BY x.underwriting_case_id DESC) uc
        WHERE a.flag_deleted = 0 AND COALESCE(a.broker_id, e.broker_id) = @id
        ORDER BY a.created_at DESC`, p)),
    safe('facilities', () => db.queryNamed(
      `SELECT l.loan_id, l.application_id, l.loan_number, ISNULL(${CUSTOMER('ap')}, '—') AS customer, ISNULL(pr.name,'—') AS product,
              l.principal, l.outstanding_balance, l.rate_pct, l.start_date, l.maturity_date, l.status,
              ${appNetSql('e', 'a')} AS net_amount
         FROM loans l
         JOIN applications a ON a.application_id = l.application_id AND a.flag_deleted = 0
         LEFT JOIN enquiries e ON e.enquiry_id = a.enquiry_id
         ${latestGrossApply('e')}
         LEFT JOIN products pr ON pr.product_id = a.product_id
         LEFT JOIN application_applicants aa ON aa.application_id = a.application_id AND aa.applicant_role = 'Primary'
         LEFT JOIN applicants ap ON ap.applicant_id = aa.applicant_id
        WHERE l.flag_deleted = 0 AND COALESCE(a.broker_id, e.broker_id) = @id
        ORDER BY l.start_date DESC`, p)),
    safe('documents', () => db.queryNamed(
      `SELECT d.broker_document_id AS doc_id, d.document_type, d.file_name, d.notes, d.expiry_date, d.created_at,
              ISNULL(u.full_name,'—') AS uploaded_by_name
         FROM broker_documents d LEFT JOIN users u ON u.user_id = d.uploaded_by
        WHERE d.broker_id = @id AND d.flag_deleted = 0
        ORDER BY d.created_at DESC`, p)),
  ]);

  // Summary figures.
  const sum = (rs, f) => rs.reduce((a, r) => a + num(f(r)), 0);
  const quoted = enquiries.filter((e) => ['INDICATIVE_SENT', 'QUALIFIED', 'OFFER_ACCEPTED', 'CONVERTED'].includes(e.status_code));
  const declined = enquiries.filter((e) => e.status_code === 'LOST');
  const openUw = applications.filter((a) => a.uw_status && !['In Portfolio', 'Rejected', 'Closed', 'Returned to BDM'].includes(a.uw_status));
  const live = facilities.filter((f) => f.status === 'Active');
  const completedApps = new Set(facilities.map((f) => f.application_id));
  // Client 23-10-2026: "Completed" = matured AND paid off (Redeemed), not just funded.
  const redeemed = facilities.filter((f) => f.status === 'Redeemed');
  const netOf = (f) => (f.net_amount != null ? f.net_amount : f.principal);
  // Where every enquiry of this broker stands (chart: how much is completed / still left).
  const stageOf = (e) => {
    if (e.loan_status === 'Redeemed') return 'Completed';
    if (e.loan_status === 'Active') return 'Live loans';
    if (e.loan_status) return 'Bad debt / other';
    if (['DECLINED', 'REJECTED', 'WITHDRAWN'].includes(String(e.app_status_code || '')) || (!e.application_id && ['LOST', 'CLOSED'].includes(e.status_code))) return 'Declined';
    return 'In pipeline';
  };
  const journey = ['Completed', 'Live loans', 'In pipeline', 'Declined', 'Bad debt / other'].map((label) => {
    const rs = enquiries.filter((e) => stageOf(e) === label);
    return { label, count: rs.length, value: Math.round(sum(rs, (e) => (e.loan_principal != null ? e.loan_principal : e.amount)) * 100) / 100 };
  }).filter((x) => x.count > 0);
  const summary = {
    enquiries: enquiries.length,
    enquiry_value: sum(enquiries, (e) => e.amount),
    quoted: quoted.length,
    declined: declined.length,
    applications: applications.length,
    application_value: sum(applications, (a) => a.amount_requested),
    underwriting: openUw.length,
    completions: redeemed.length,
    completed_value: sum(redeemed, (f) => f.principal),
    funded: facilities.length,
    portfolio_total: sum(facilities, (f) => f.principal),
    portfolio_gross: sum(facilities, (f) => f.principal),
    portfolio_net: sum(facilities, netOf),
    live_net: sum(live, netOf),
    live_gross: sum(live, (f) => f.principal),
    journey,
    // Client 23-10-2026: money lent (net) - how much is completed (paid back) vs still left.
    loan_progress: (() => {
      const r = (v) => Math.round(v * 100) / 100;
      const repaidDone = sum(redeemed, netOf);
      const live2 = facilities.filter((f) => !['Redeemed', 'Recovered', 'Written Off'].includes(f.status));
      const left = sum(live2, (f) => (f.outstanding_balance != null ? f.outstanding_balance : netOf(f)));
      const paidOnLive = Math.max(0, sum(live2, netOf) - left);
      return [
        { label: 'Completed (redeemed)', value: r(repaidDone) },
        { label: 'Paid so far (live loans)', value: r(paidOnLive) },
        { label: 'Left to pay', value: r(left) },
      ];
    })(),
    live_facilities: live.length,
    live_balance: sum(live, (f) => f.outstanding_balance),
    avg_loan: facilities.length ? sum(facilities, (f) => f.principal) / facilities.length : 0,
    avg_rate_pct: facilities.length ? Math.round((sum(facilities, (f) => f.rate_pct) / facilities.length) * 100) / 100 : null,
    conversion_pct: enquiries.length ? Math.round((facilities.length / enquiries.length) * 1000) / 10 : null,
    broker_fees: sum(applications.filter((a) => completedApps.has(a.application_id)), (a) => a.broker_fee),
    first_enquiry_at: enquiries.length ? enquiries[enquiries.length - 1].created_at : null,
    last_enquiry_at: enquiries.length ? enquiries[0].created_at : null,
    has_signed_agreement: documents.some((d) => /agreement/i.test(String(d.document_type || ''))),
  };
  return { profile, summary, enquiries, applications, facilities, documents, documentTypes: BROKER_DOC_TYPES };
}

async function uploadDocument(id, body, req) {
  if (!(await brokerRow(id))) return { notFound: true };
  const name = String(body.file_name || '').trim();
  const b64 = String(body.content_base64 || '');
  if (!name || !b64) return { ok: false, errors: { file: 'Please choose a file to upload' } };
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  const chk = fileGuard.checkUpload(name, buf);
  if (!chk.ok) return { ok: false, errors: { file: chk.error } };
  const type = String(body.document_type || '').trim().slice(0, 100);
  if (!type) return { ok: false, errors: { document_type: 'Document type is required' } };
  const exp = body.expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiry_date)) ? String(body.expiry_date) : null;
  const absDir = path.join(global.basePath || path.join(__dirname, '..'), DOC_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const disk = fileGuard.diskName(chk.name);
  fs.writeFileSync(path.join(absDir, disk), buf);
  const uid = req && req.userData ? req.userData.userId : null;
  const out = await db.queryNamed(
    `INSERT INTO broker_documents (broker_id, document_type, file_name, file_path, notes, expiry_date, uploaded_by, created_by)
     OUTPUT INSERTED.broker_document_id AS id
     VALUES (@id, @type, @name, @path, @notes, @exp, @uid, @uid)`,
    { id: Number(id), type, name: chk.name, path: path.join(DOC_DIR, disk), notes: body.notes ? String(body.notes).slice(0, 500) : null, exp, uid });
  await audit.write(audit.fromReq(req, {
    action: 'BROKER_DOC_UPLOAD', moduleKey: 'BROKERS.DOCUMENT', entityName: 'brokers', entityId: String(id),
    details: { broker_document_id: out[0].id, document_type: type, file_name: chk.name },
  }));
  return { ok: true, id: out[0].id };
}

async function documentFile(id, docId) {
  const rows = await db.queryNamed(
    `SELECT file_name, file_path FROM broker_documents
      WHERE broker_document_id = @doc AND broker_id = @id AND flag_deleted = 0`, { id: Number(id) || 0, doc: Number(docId) || 0 });
  return rows[0] || null;
}

async function deleteDocument(id, docId, req) {
  const doc = await documentFile(id, docId);
  if (!doc) return { notFound: true };
  const uid = req && req.userData ? req.userData.userId : null;
  await db.queryNamed(
    `UPDATE broker_documents SET flag_deleted = 1, deleted_by = @uid, deleted_on = SYSUTCDATETIME()
      WHERE broker_document_id = @doc AND broker_id = @id`, { id: Number(id), doc: Number(docId), uid });
  await audit.write(audit.fromReq(req, {
    action: 'BROKER_DOC_DELETE', moduleKey: 'BROKERS.DOCUMENT', entityName: 'brokers', entityId: String(id),
    details: { broker_document_id: Number(docId), file_name: doc.file_name },
  }));
  return { ok: true };
}

module.exports = { stats, detail, uploadDocument, documentFile, deleteDocument, BROKER_DOC_TYPES };
