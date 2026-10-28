'use strict';

/**
 * Demo customer: Andre Matthew Thomas — the "ideal" full-pipeline customer.
 *
 * Figures are taken from the live indicative (11 Aug 2026, Ruth Aimson):
 *   130 Derington Road, London SW17 8HY · value £550,000 · mortgage-free
 *   Gross loan £238,205 · 12 months · 12.6% pa (1.05% pm = £2,501.15/mo)
 *   Arrangement 2% (£4,764.10) · Broker 1% (£2,382.05) · Doc fee £1,000
 *   Retained interest 12 × £30,013.83 · Net advance £200,045.02
 *   Exit fee = 1 month's interest (£2,501.15)
 *
 * Pipeline: broker enquiry (CONVERTED) → application (COMPLETED) → applicant,
 * security (valuation Accepted £550k), documents, tasks, comms, notes →
 * underwriting case (In Portfolio, 8/8 steps) → credit Approved → legal
 * Completed → loan FAC-000459 (Active) → 12 schedules → Sept interest paid on
 * time → contact logs → audit trail. No arrears, no extensions: a clean book.
 *
 * Every block is guarded (IF NOT EXISTS) so re-runs are safe.
 */
module.exports = {
  async run(db) {
    const one = async (sql, params = []) => {
      const rows = await db.query(sql, params);
      return rows.length ? rows[0] : null;
    };
    const idOf = async (sql, params = []) => {
      const r = await one(sql, params);
      if (!r) return null;
      const v = Object.values(r)[0];
      return v == null ? null : Number(v);
    };

    // ---------- lookups ----------
    const br = await idOf(`SELECT branch_id FROM branches WHERE branch_name='London Branch'`);
    const pr = await idOf(`SELECT TOP 1 product_id FROM products WHERE code='BRIDGE-1ST'`);
    const lp = await idOf(`SELECT TOP 1 loan_purpose_id FROM loan_purposes WHERE code='PURCHASE'`);
    const src = await idOf(`SELECT TOP 1 application_source_id FROM application_sources WHERE name LIKE 'Broker%'`);
    const enqStat = await idOf(`SELECT TOP 1 enquiry_status_id FROM enquiry_statuses WHERE code='CONVERTED'`);
    const appStat = await idOf(`SELECT TOP 1 application_status_id FROM application_statuses WHERE code='COMPLETED'`);
    const indType = await idOf(`SELECT TOP 1 applicant_type_id FROM applicant_types WHERE code='INDIVIDUAL'`);
    const freq = await idOf(`SELECT TOP 1 repayment_frequency_id FROM repayment_frequencies WHERE code='MONTHLY'`);
    const bdm = await idOf(`SELECT user_id FROM users WHERE email='sarah.mitchell@loandesk.local'`);
    const uw = await idOf(`SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local'`);
    const cm = await idOf(`SELECT user_id FROM users WHERE email='emma.clarke@loandesk.local'`);

    // ---------- supporting masters (demo broker / solicitor / doc types) ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM brokers WHERE code='CAPRICORN')
         INSERT INTO brokers (code, name, company, email, phone, commission_pct)
         VALUES ('CAPRICORN', 'Test test', 'Capricorn International', 'test.broker@yopmail.co', '+44 7736 926 085', 1.00);`,
    );
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM solicitors WHERE code='DEMOSOL')
         INSERT INTO solicitors (code, name, firm, email, phone)
         VALUES ('DEMOSOL', 'Test Solicitor', 'Harper & Co Solicitors', 'test.solicitor@yopmail.co', '020 7946 0440');`,
    );
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM document_types WHERE code='LEGAL')
         INSERT INTO document_types (code, name, category) VALUES ('LEGAL', 'Legal Document', 'Legal');`,
    );
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM document_types WHERE code='CHARGE')
         INSERT INTO document_types (code, name, category) VALUES ('CHARGE', 'Charge Document', 'Security');`,
    );
    const bk = await idOf(`SELECT broker_id FROM brokers WHERE code='CAPRICORN'`);
    const sol = await idOf(`SELECT solicitor_id FROM solicitors WHERE code='DEMOSOL'`);

    // ---------- applicant ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM applicants WHERE email='andre.thomas@example.com' AND flag_deleted=0)
         INSERT INTO applicants (applicant_type_id, first_name, last_name, email, phone, dob, created_by)
         VALUES (@p0, 'Andre Matthew', 'Thomas', 'andre.thomas@example.com', '07700 900124', '1975-06-15', @p1);`,
      [indType, bdm],
    );
    const ap = await idOf(`SELECT applicant_id FROM applicants WHERE email='andre.thomas@example.com' AND flag_deleted=0`);
    if (!ap) return;

    // ---------- next refs (dynamic, collision-free) ----------
    const year = new Date().getFullYear();
    const nextRef = async (table, col, prefix) => {
      const r = await one(
        `SELECT TOP 1 ${col} AS ref FROM ${table} WHERE ${col} LIKE @p0 ORDER BY ${col} DESC`,
        [`${prefix}${year}-` + '%'],
      );
      let next = 1;
      if (r && r.ref) {
        const n = parseInt(String(r.ref).slice(`${prefix}${year}-`.length), 10);
        if (Number.isFinite(n)) next = n + 1;
      }
      return `${prefix}${year}-` + String(next).padStart(5, '0');
    };
    const facRow = await one(
      `SELECT ISNULL(MAX(TRY_CAST(SUBSTRING(loan_number, 5, 10) AS INT)), 458) + 1 AS n FROM loans WHERE loan_number LIKE 'FAC-%'`,
    );
    const facRef = 'FAC-' + String(facRow.n).padStart(6, '0');

    // ---------- enquiry ----------
    let enqRef = null;
    const enqRow = await one(
      `SELECT TOP 1 enquiry_id, enquiry_ref FROM enquiries WHERE email='andre.thomas@example.com' AND flag_deleted=0 ORDER BY enquiry_id DESC`,
    );
    let enq = enqRow ? Number(Object.values(enqRow)[0]) : null;
    if (!enq) {
      enqRef = await nextRef('enquiries', 'enquiry_ref', 'ENQ-');
      await db.query(
        `INSERT INTO enquiries (enquiry_ref, branch_id, product_id, enquiry_status_id, broker_id,
              applicant_name, email, phone, dob, amount_requested, term_months, property_address,
              estimated_value, lead_source, summary, assigned_to, created_at, converted_at)
         VALUES (@p0, @p1, @p2, @p3, @p4,
              'Andre Matthew Thomas', 'andre.thomas@example.com', '07700 900124', '1975-06-15', 200000, 12,
              '130 Derington Road, London SW17 8HY', 550000, 'Broker Introduction',
              'Owns mortgaged London property being sold plus a property in Thailand where he lives. Clean credit, exit via sale.',
              @p5, '2026-08-11T12:59:00', '2026-08-11T15:15:00');`,
        [enqRef, br, pr, enqStat, bk, bdm],
      );
      const r2 = await one(`SELECT enquiry_id FROM enquiries WHERE enquiry_ref=@p0`, [enqRef]);
      enq = r2 ? Number(Object.values(r2)[0]) : null;
    }

    // ---------- application ----------
    let app = await idOf(
      `SELECT TOP 1 a.application_id FROM applications a
         JOIN application_applicants aa ON aa.application_id = a.application_id
        WHERE aa.applicant_id = @p0 AND a.flag_deleted = 0 ORDER BY a.application_id DESC`,
      [ap],
    );
    if (!app) {
      const appRef = await nextRef('applications', 'application_ref', 'APP-');
      await db.query(
        `INSERT INTO applications
           (application_ref, enquiry_id, branch_id, product_id, loan_purpose_id, application_status_id,
            application_source_id, broker_id, amount_requested, term_months, assigned_to, underwriter_id,
            credit_manager_id, initial_offer_state, initial_offer_note, sla_days, completion_date,
            net_advance, ltv_pct, monthly_fee_pct, arrangement_fee_pct, exit_fee, doc_fee, rolled_interest,
            gross_redemption, loandesk_broker_fee_pct, borrower_broker_fee, introducer_fee, lender_income,
            kyc_identity_status, kyc_aml_status, kyc_pep_status, kyc_overall_status, submitted_at, created_at)
         VALUES
           (@p0, @p1, @p2, @p3, @p4, @p5,
            @p6, @p7, 238205, 12, @p8, @p9,
            @p10, 'Accepted', 'Indicative accepted by broker 11 Aug 2026', 2, '2026-08-12',
            200045.02, 43.310, 1.0500, 2.0000, 2501.15, 1000, 30013.83,
            268218.83, 1.0000, 2382.05, 0, 8265.25,
            'Passed', 'Passed', 'Passed', 'Verified', '2026-08-11T14:05:00', '2026-08-11T14:05:00');`,
        [appRef, enq, br, pr, lp, appStat, src, bk, bdm, uw, cm],
      );
      app = await idOf(`SELECT application_id FROM applications WHERE application_ref=@p0`, [appRef]);
    }
    if (!app) return;

    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM application_applicants WHERE application_id=@p0 AND applicant_id=@p1)
         INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@p0, @p1, 'Primary');`,
      [app, ap],
    );

    // ---------- security (valuation Accepted £550k) ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM application_security WHERE application_id=@p0)
         INSERT INTO application_security
           (application_id, property_address, estimated_value, charge_type, valuation_amount,
            valuation_date, valuation_status, valuation_check, risk_rating, ltv_band, legal_check_status)
         VALUES (@p0, '130 Derington Road, London SW17 8HY', 550000, '1st Legal Charge', 550000,
            '2026-08-13', 'Accepted', 'Passed', 'Low', 'Standard', 'Completed');`,
      [app],
    );

    // ---------- documents ----------
    const DOCS = [
      ['Passport — Andre Thomas', 'ID', 'Verified', 'Verified', '2026-08-11'],
      ['Proof of Address — Derington Road', 'ADDRESS', 'Verified', 'Verified', '2026-08-11'],
      ['Bank Statements (6 months)', 'BANK', 'Verified', 'Verified', '2026-08-11'],
      ['Valuation Report — 130 Derington Road', 'VALUATION', 'Accepted', 'Accepted', '2026-08-13'],
      ['Facility Agreement', 'LEGAL', 'Executed', 'Executed', '2026-08-12'],
      ['Debenture / Charge Document', 'CHARGE', 'Registered', 'Registered', '2026-08-12'],
    ];
    for (const [fname, dtCode, status, vstatus, vat] of DOCS) {
      await db.query(
        `DECLARE @dt INT = (SELECT TOP 1 document_type_id FROM document_types WHERE code=@p1);
         IF @dt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_documents WHERE application_id=@p2 AND file_name=@p0)
           INSERT INTO application_documents (application_id, document_type_id, file_name, version, status, verified_status, verified_at)
           VALUES (@p2, @dt, @p0, 'v1', @p3, @p4, @p5);`,
        [fname, dtCode, app, status, vstatus, vat],
      );
    }

    // ---------- tasks / comms / notes ----------
    const TASKS = [
      ['Document Collection', 'Collect ID, address, bank statements from borrower', '2026-08-11', bdm, 'Completed'],
      ['Valuation Review', 'Review valuation for Derington Road (£550k)', '2026-08-13', uw, 'Completed'],
      ['Legal Completion', 'Facility agreement + charge executed and registered', '2026-08-12', uw, 'Completed'],
    ];
    for (const [type, desc, due, who, status] of TASKS) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM application_tasks WHERE application_id=@p0 AND description=@p1)
           INSERT INTO application_tasks (application_id, task_type, description, due_date, assigned_to, status)
           VALUES (@p0, @p1, @p2, @p3, @p4, @p5);`,
        [app, type, desc, due, who, status],
      );
    }
    const COMMS = [
      [bdm, 'Capricorn International (Broker)', 'Email', 'Indicative figures subject to valuation — Andre Thomas', '2026-08-11T20:15:00'],
      [uw, 'Sarah Mitchell', 'Internal Note', 'Valuation accepted at £550,000 — 43.31% LTV, proceed to credit', '2026-08-13T10:20:00'],
      [bdm, 'Andre Thomas', 'Email', 'Completion confirmed — funds released', '2026-08-12T16:40:00'],
    ];
    for (const [who, toParty, channel, subject, at] of COMMS) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM application_communications WHERE application_id=@p0 AND subject=@p1)
           INSERT INTO application_communications (application_id, from_user_id, to_party, channel, subject, comm_at)
           VALUES (@p0, @p2, @p3, @p4, @p1, @p5);`,
        [app, subject, who, toParty, channel, at],
      );
    }
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM application_notes WHERE application_id=@p0)
         INSERT INTO application_notes (application_id, note, created_by, created_at)
         VALUES (@p0, 'Funded 12 Aug 2026. Clean credit, exit via sale of Derington Road property.', @p1, '2026-08-12T16:45:00');`,
      [app, uw],
    );

    // ---------- underwriting case (happy path, 8/8 steps) ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM underwriting_cases WHERE application_id=@p0 AND flag_deleted=0)
         INSERT INTO underwriting_cases (application_id, underwriter_id, status, current_step, created_by)
         VALUES (@p0, @p1, 'In Portfolio', 8, @p1);
       ELSE
         UPDATE underwriting_cases
            SET status='In Portfolio', current_step=8, underwriter_id=COALESCE(underwriter_id, @p1)
          WHERE application_id=@p0 AND flag_deleted=0;`,
      [app, uw],
    );
    const kase = await one(
      `SELECT TOP 1 underwriting_case_id AS id FROM underwriting_cases WHERE application_id=@p0 AND flag_deleted=0 ORDER BY underwriting_case_id DESC`,
      [app],
    );
    const caseId = kase ? Number(Object.values(kase)[0]) : null;
    if (caseId) {
      for (let n = 1; n <= 8; n += 1) {
        await db.query(
          `IF NOT EXISTS (SELECT 1 FROM underwriting_steps WHERE underwriting_case_id=@p0 AND step_no=@p1)
             INSERT INTO underwriting_steps (underwriting_case_id, step_no, step_key, status, assigned_role, completed_at, created_by)
             VALUES (@p0, @p1, CONCAT('step_', @p1), 'Completed', 'Underwriter', SYSUTCDATETIME(), @p2);
           ELSE
             UPDATE underwriting_steps SET status='Completed', completed_at=COALESCE(completed_at, SYSUTCDATETIME())
              WHERE underwriting_case_id=@p0 AND step_no=@p1;`,
          [caseId, n, uw],
        );
      }
    }

    // ---------- credit decision + legal case ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM credit_decisions WHERE application_id=@p0 AND decision='approve')
         INSERT INTO credit_decisions (application_id, decided_by, decision, amount_approved, rate_pct, notes, decided_at, created_by)
         VALUES (@p0, @p1, 'approve', 238205, 12.6, 'Clean credit, 43.31% LTV, mortgage-free security, exit via sale.', '2026-08-13T11:00:00', @p1);`,
      [app, cm],
    );
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM legal_cases WHERE application_id=@p0 AND flag_deleted=0)
         INSERT INTO legal_cases (application_id, solicitor_id, status, notes, created_by)
         VALUES (@p0, @p1, 'Completed', 'Facility agreement executed, 1st charge registered.', @p2);
       ELSE
         UPDATE legal_cases SET status='Completed', solicitor_id=COALESCE(solicitor_id, @p1)
          WHERE application_id=@p0 AND flag_deleted=0;`,
      [app, sol, uw],
    );

    // ---------- loan (Active; outstanding = principal + 34 days @ £82.23/day) ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM loans WHERE application_id=@p0 AND flag_deleted=0)
         INSERT INTO loans (loan_number, application_id, principal, rate_pct, term_months, repayment_frequency_id,
                            start_date, maturity_date, status, outstanding_balance, created_by)
         VALUES (@p1, @p0, 238205, 12.6, 12, @p2, '2026-08-12', '2027-08-12', 'Active', 241000.81, @p3);
       ELSE
         UPDATE loans SET status='Active', rate_pct=12.6
          WHERE application_id=@p0 AND flag_deleted=0;`,
      [app, facRef, freq, uw],
    );
    const loanRow = await one(`SELECT TOP 1 loan_id AS id FROM loans WHERE application_id=@p0 AND flag_deleted=0`, [app]);
    const loan = loanRow ? Number(Object.values(loanRow)[0]) : null;
    if (!loan) return;

    const FEES = [
      ['Arrangement', 4764.10, '2026-08-12', 'Paid', '2% arrangement fee from accepted terms'],
      ['Broker', 2382.05, '2026-08-12', 'Paid', '1% borrower broker fee'],
      ['Document', 1000.00, '2026-08-12', 'Paid', 'Document fee from completion statement'],
      ['Exit', 2501.15, '2027-08-12', 'Due', 'One month interest exit fee'],
    ];
    for (const [type, amount, due, status, notes] of FEES) {
      await db.query(
        `IF OBJECT_ID('dbo.loan_fees','U') IS NOT NULL
           IF NOT EXISTS (SELECT 1 FROM loan_fees WHERE loan_id=@p0 AND fee_type=@p1 AND amount=@p2)
             INSERT INTO loan_fees (loan_id, fee_type, amount, due_date, status, notes, created_by)
             VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6);`,
        [loan, type, amount, due, status, notes, uw],
      );
    }

    await db.query(
      `IF OBJECT_ID('dbo.loan_drawdowns','U') IS NOT NULL
         IF NOT EXISTS (SELECT 1 FROM loan_drawdowns WHERE loan_id=@p0 AND drawdown_no=1)
           INSERT INTO loan_drawdowns (loan_id, drawdown_no, drawn_on, amount, notes, status, created_by)
           VALUES (@p0, 1, '2026-08-12', 238205, 'Initial drawdown on completion', 'Released', @p1);`,
      [loan, uw],
    );

    const COVENANTS = [
      ['Monthly monitoring call', 'Operational', 'Monthly', '2026-10-12', 'Upcoming', 'Portfolio manager to confirm sale progress and repayment plan'],
      ['Buildings insurance confirmation', 'Insurance', 'Annual', '2027-08-01', 'Upcoming', 'Insurance must remain active until redemption'],
      ['No further borrowing without consent', 'Financial', 'Ongoing', null, 'Complied', 'Borrower covenant from facility agreement'],
    ];
    for (const [name, type, frequency, nextDue, status, notes] of COVENANTS) {
      await db.query(
        `IF OBJECT_ID('dbo.loan_covenants','U') IS NOT NULL
           IF NOT EXISTS (SELECT 1 FROM loan_covenants WHERE loan_id=@p0 AND name=@p1)
             INSERT INTO loan_covenants (loan_id, name, covenant_type, frequency, next_due, status, notes, created_by)
             VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7);`,
        [loan, name, type, frequency, nextDue, status, notes, uw],
      );
    }

    // ---------- 12 monthly schedules (£2,501.15 interest; final clears principal) ----------
    for (let n = 1; n <= 12; n += 1) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM loan_schedules WHERE loan_id=@p0 AND installment_no=@p1)
           INSERT INTO loan_schedules (loan_id, installment_no, due_date, principal_due, interest_due, total_due, status, created_by)
           VALUES (@p0, @p1, DATEADD(month, @p1, '2026-08-12'),
                   CASE WHEN @p1=12 THEN 238205 ELSE 0 END, 2501.15,
                   CASE WHEN @p1=12 THEN 238205 ELSE 0 END + 2501.15, 'Due', @p2);`,
        [loan, n, uw],
      );
    }

    // ---------- September interest received on time ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM loan_payments WHERE loan_id=@p0 AND reference='PMT-THOMAS-001')
         INSERT INTO loan_payments (loan_id, paid_on, amount, method, reference, created_by)
         VALUES (@p0, '2026-09-12', 2501.15, 'Bank Transfer', 'PMT-THOMAS-001', @p1);`,
      [loan, uw],
    );

    // ---------- contact logs (intro + check-in) ----------
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM portfolio_contact_logs WHERE loan_id=@p0 AND contact_date='2026-08-12')
         INSERT INTO portfolio_contact_logs (loan_id, application_id, applicant_id, contact_date, person, method,
                                             contact_notes, followup_date, outlook_reminder, followup_status, contact_outcome, created_by)
         VALUES (@p0, @p1, @p2, '2026-08-12', 'Andre Thomas', 'Phone',
                 'Portfolio introduction completed. Exit remains sale of Derington Road property.', '2026-09-12', 0, 'Done', 'Contacted', @p3);`,
      [loan, app, ap, bdm],
    );
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM portfolio_contact_logs WHERE loan_id=@p0 AND contact_date='2026-09-12')
         INSERT INTO portfolio_contact_logs (loan_id, application_id, applicant_id, contact_date, person, method,
                                             contact_notes, followup_date, outlook_reminder, followup_status, contact_outcome, created_by)
         VALUES (@p0, @p1, @p2, '2026-09-12', 'Andre Thomas', 'Phone',
                 'September interest received on time. Borrower confirms sale progressing.', '2026-10-12', 0, 'Pending', 'Contacted', @p3);`,
      [loan, app, ap, bdm],
    );

    // ---------- audit trail ----------
    const appRefRow = await one(`SELECT application_ref AS ref FROM applications WHERE application_id=@p0`, [app]);
    const appRef = appRefRow ? String(Object.values(appRefRow)[0]) : 'APP';
    const AUDIT = [
      ['APPLICATION_CREATE', 'APPLICATIONS', 'applications', app, '{"stage":"sales-to-application"}', '2026-08-11T14:05:00', bdm],
      ['CREDIT_DECISION', 'CREDIT', 'applications', app, '{"decision":"approve","amount":238205}', '2026-08-13T11:00:00', cm],
      ['LEGAL_COMPLETED', 'LEGAL', 'applications', app, '{"facility":"executed","charge":"registered"}', '2026-08-12T15:30:00', uw],
      ['LIVE_LOAN_CREATE', 'PORTFOLIO.CONTACT_LOG', 'loans', loan, `{"source":"funded ${appRef}","principal":238205}`, '2026-08-12T16:45:00', uw],
      ['PAYMENT_RECEIVED', 'PORTFOLIO.CONTACT_LOG', 'loans', loan, '{"reference":"PMT-THOMAS-001","amount":2501.15}', '2026-09-12T10:00:00', bdm],
    ];
    for (const [action, mod, entity, eid, details, at, who] of AUDIT) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_name=@p0 AND entity_id=CONVERT(varchar(60), @p1) AND action=@p2)
           INSERT INTO audit_logs (user_id, action, module_key, entity_name, entity_id, details, created_at)
           VALUES (@p3, @p2, @p4, @p0, CONVERT(varchar(60), @p1), @p5, @p6);`,
        [entity, eid, action, who, mod, details, at],
      );
    }
  },
};
