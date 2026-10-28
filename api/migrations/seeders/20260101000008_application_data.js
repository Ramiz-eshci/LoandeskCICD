'use strict';

/**
 * Seeder: Application module (Module-5) — status alignment, permission top-ups
 * and the two Figma sample applications populated across every detail tab.
 *
 *  1) application_statuses: align display names + sort_order to the Figma stage
 *     chips and add DECLINED (kept alongside the existing REJECTED/WITHDRAWN).
 *  2) sample case-team users, broker, applicants, one source enquiry, and the
 *     two applications APP-000458 (John Smith) & APP-000457 (Harrison Properties)
 *     with security, documents, tasks, communications and notes.
 *
 * Every write is guarded — safe to run any number of times.
 */

const DEV_HASH = '$2b$10$253jqiDS9XE8SUu.SoMFL.p2rMmd1KYlJALTBrk9dyCARJt4BSBJO'; // Password@123

const STATUSES = [
  { code: 'DRAFT', name: 'Awaiting Initial Review', sort_order: 1, is_terminal: 0 }, // client 15-10-2026: was "Draft"
  { code: 'SUBMITTED', name: 'Submitted', sort_order: 2, is_terminal: 0 },
  { code: 'UNDERWRITING', name: 'Underwriting', sort_order: 3, is_terminal: 0 },
  { code: 'CREDIT_REVIEW', name: 'Credit Review', sort_order: 4, is_terminal: 0 },
  { code: 'APPROVED', name: 'Approved', sort_order: 5, is_terminal: 0 },
  { code: 'LEGAL', name: 'Legal', sort_order: 6, is_terminal: 0 },
  { code: 'COMPLETED', name: 'Completed', sort_order: 7, is_terminal: 1 },
  { code: 'DECLINED', name: 'Declined', sort_order: 8, is_terminal: 1 },
];

// email -> [full_name, role_name]
const TEAM = [
  ['sarah.mitchell@loandesk.local', 'Sarah Mitchell', 'Sales / BDM'],
  ['daniel.hayes@loandesk.local', 'Daniel Hayes', 'Underwriter'],
  ['emma.clarke@loandesk.local', 'Emma Clarke', 'Credit Manager'],
];

module.exports = {
  async run(db) {
    /* ---------------- 1) statuses ---------------- */
    for (const s of STATUSES) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM application_statuses WHERE code = @p0)
           INSERT INTO application_statuses (code, name, sort_order, is_terminal)
           VALUES (@p0, @p1, @p2, @p3);`,
        [s.code, s.name, s.sort_order, s.is_terminal],
      );
      await db.query(
        `UPDATE application_statuses SET name = @p1, sort_order = @p2 WHERE code = @p0;`,
        [s.code, s.name, s.sort_order],
      );
    }

    /* ---------------- 3a) case-team users ---------------- */
    for (const [email, name, roleName] of TEAM) {
      await db.query(
        `DECLARE @rl INT = (SELECT role_id FROM roles WHERE role_name=@p3 AND flag_deleted=0);
         DECLARE @b INT = (SELECT branch_id FROM branches WHERE branch_name='London Branch');
         IF NOT EXISTS (SELECT 1 FROM users WHERE email=@p0)
           INSERT INTO users (email, password_hash, full_name, role_id, branch_id, is_active)
           VALUES (@p0, @p1, @p2, @rl, @b, 1);`,
        [email, DEV_HASH, name, roleName],
      );
    }

    /* ---------------- 3b) broker ---------------- */
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM brokers WHERE code='PREMIER')
         INSERT INTO brokers (code, name, company, email, phone, commission_pct)
         VALUES ('PREMIER', 'Test Broker', 'Premier Finance Ltd', 'test.broker@yopmail', '020 7946 0123', 1.00);`,
    );

    /* ---------------- 3b-ii) ensure '1st Charge Bridge' product (was 'Bridge Loan') ---------------- */
    await db.query(
      `DECLARE @pt INT = (SELECT TOP 1 product_type_id FROM product_types WHERE code='BRDG');
       IF NOT EXISTS (SELECT 1 FROM products WHERE code='BRIDGE-1ST')
         INSERT INTO products (code, name, product_type_id) VALUES ('BRIDGE-1ST', '1st Charge Bridge', @pt);`,
    );

    /* ---------------- 3c) applicants ---------------- */
    await db.query(
      `DECLARE @it INT = (SELECT TOP 1 applicant_type_id FROM applicant_types WHERE name LIKE 'Individual%');
       IF NOT EXISTS (SELECT 1 FROM applicants WHERE email='john.smith@email.com')
         INSERT INTO applicants (applicant_type_id, first_name, last_name, email, phone, dob)
         VALUES (@it, 'John', 'Smith', 'john.smith@email.com', '07700 900123', '1978-03-15');`,
    );
    await db.query(
      `DECLARE @ct INT = (SELECT TOP 1 applicant_type_id FROM applicant_types WHERE name LIKE 'Compan%' OR name LIKE 'Ltd%' OR name LIKE 'Corporate%');
       IF NOT EXISTS (SELECT 1 FROM applicants WHERE company_name='Harrison Properties Ltd')
         INSERT INTO applicants (applicant_type_id, company_name, first_name, last_name, email, phone)
         VALUES (@ct, 'Harrison Properties Ltd', 'Mark', 'Harrison', 'info@yopmail.com', '0161 555 0134');`,
    );

    /* ---------------- 3d) source enquiry for APP-000458 ---------------- */
    await db.query(
      `DECLARE @st INT = (SELECT TOP 1 enquiry_status_id FROM enquiry_statuses WHERE code='CONVERTED');
       DECLARE @br INT = (SELECT branch_id FROM branches WHERE branch_name='London Branch');
       DECLARE @pr INT = (SELECT TOP 1 product_id FROM products WHERE code = 'BRIDGE-1ST');
       DECLARE @bk INT = (SELECT broker_id FROM brokers WHERE code='PREMIER');
       DECLARE @bd INT = (SELECT user_id FROM users WHERE email='sarah.mitchell@loandesk.local');
       IF NOT EXISTS (SELECT 1 FROM enquiries WHERE enquiry_ref='ENQ-00124')
         INSERT INTO enquiries (enquiry_ref, branch_id, product_id, enquiry_status_id, broker_id,
              applicant_name, email, phone, dob, amount_requested, term_months, property_address,
              estimated_value, lead_source, summary, assigned_to, created_at, converted_at)
         VALUES ('ENQ-00124', @br, @pr, @st, @bk,
              'John Smith', 'john.smith@email.com', '07700 900123', '1978-03-15', 243000, 12,
              '14 Kensington Rd, London W8 4PT', 357000, 'Broker Introduction',
              'Strong borrower, clean credit. Looking to bridge to sale of existing property.',
              @bd, '2026-08-22T14:30:00', '2026-08-22T16:45:00');`,
    );

    /* ---------------- 3e) APP-000458 — John Smith / Bridge Loan ---------------- */
    await db.query(
      `DECLARE @stat INT = (SELECT application_status_id FROM application_statuses WHERE code='UNDERWRITING');
       DECLARE @br INT = (SELECT branch_id FROM branches WHERE branch_name='London Branch');
       DECLARE @pr INT = (SELECT TOP 1 product_id FROM products WHERE code = 'BRIDGE-1ST');
       DECLARE @lp INT = (SELECT TOP 1 loan_purpose_id FROM loan_purposes WHERE name LIKE 'Purchase%');
       DECLARE @src INT = (SELECT TOP 1 application_source_id FROM application_sources WHERE name LIKE 'Broker%');
       DECLARE @bk INT = (SELECT broker_id FROM brokers WHERE code='PREMIER');
       DECLARE @enq INT = (SELECT enquiry_id FROM enquiries WHERE enquiry_ref='ENQ-00124');
       DECLARE @bdm INT = (SELECT user_id FROM users WHERE email='sarah.mitchell@loandesk.local');
       DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
       DECLARE @cm INT = (SELECT user_id FROM users WHERE email='emma.clarke@loandesk.local');
       IF NOT EXISTS (SELECT 1 FROM applications WHERE application_ref='APP-000458')
         INSERT INTO applications
           (application_ref, enquiry_id, branch_id, product_id, loan_purpose_id, application_status_id,
            application_source_id, broker_id, amount_requested, term_months, assigned_to, underwriter_id,
            credit_manager_id, initial_offer_state, initial_offer_note, sla_days, completion_date,
            net_advance, ltv_pct, monthly_fee_pct, arrangement_fee_pct, exit_fee, doc_fee, rolled_interest,
            gross_redemption, irr_pct, loandesk_broker_fee_pct, borrower_broker_fee, introducer_fee, lender_income,
            kyc_identity_status, kyc_aml_status, kyc_pep_status, kyc_overall_status, submitted_at, created_at)
         VALUES
           ('APP-000458', @enq, @br, @pr, @lp, @stat, @src, @bk, 243000, 12, @bdm, @uw, @cm,
            'INDICATIVE_FOLLOWUP', 'Indicative F/Up', 2, '2026-09-30',
            202162, 68.000, 1.0500, 2.0000, 2551.50, 500, 30618, 245551.50, 16.0100,
            1.0000, 4860, 4860, 36099.50,
            'Passed', 'Passed', 'Pending', 'Verified', '2026-08-22T14:32:00', '2026-08-22T16:45:00');`,
    );
    // link primary applicant + security + docs/tasks/comms/notes for 458
    await db.query(
      `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
       DECLARE @ap INT = (SELECT applicant_id FROM applicants WHERE email='john.smith@email.com');
       IF @app IS NOT NULL AND @ap IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_applicants WHERE application_id=@app AND applicant_id=@ap)
         INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@app, @ap, 'Primary');`,
    );
    await db.query(
      `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
       IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_security WHERE application_id=@app)
         INSERT INTO application_security
           (application_id, property_address, estimated_value, charge_type, valuation_status,
            valuation_check, risk_rating, ltv_band, legal_check_status)
         VALUES (@app, '14 Kensington Rd, London W8 4PT', 357000, '1st Legal Charge', 'Instructed',
            'In Progress', 'Medium', 'Standard', 'Not Started');`,
    );
    const DOCS_458 = [
      ['Passport — John Smith', 'ID', 'Verified', 'Verified', '2026-08-22'],
      ['Bank Statements (6 months)', 'BANK', 'Pending Review', 'Pending Review', null],
      ['Valuation Report — 14 Kensington Rd', 'VALUATION', 'Accepted', 'Accepted', '2026-08-21'],
      ['RICS Schedule of Condition', 'VALUATION', 'Accepted', 'Accepted', '2026-08-21'],
      ['Proof of Address', 'ADDRESS', 'Verified', 'Verified', '2026-08-20'],
    ];
    for (const [fname, dtCode, status, vstatus, vat] of DOCS_458) {
      await db.query(
        `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
         DECLARE @dt INT = (SELECT TOP 1 document_type_id FROM document_types WHERE code=@p1);
         IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_documents WHERE application_id=@app AND file_name=@p0)
           INSERT INTO application_documents (application_id, document_type_id, file_name, version, status, verified_status, verified_at)
           VALUES (@app, @dt, @p0, 'v1', @p2, @p3, @p4);`,
        [fname, dtCode, status, vstatus, vat],
      );
    }
    const TASKS_458 = [
      ['Document Request', 'Obtain 6 months bank statements', '2026-09-03', 'sarah.mitchell@loandesk.local', 'Outstanding'],
      ['Valuation Review', 'Review RICS report for Kensington Rd', '2026-08-21', 'daniel.hayes@loandesk.local', 'Completed'],
      ['KYC Review', 'Verify John Smith identity documents', '2026-08-20', 'daniel.hayes@loandesk.local', 'Completed'],
    ];
    for (const [type, desc, due, email, status] of TASKS_458) {
      await db.query(
        `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
         DECLARE @u INT = (SELECT user_id FROM users WHERE email=@p3);
         IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_tasks WHERE application_id=@app AND description=@p1)
           INSERT INTO application_tasks (application_id, task_type, description, due_date, assigned_to, status)
           VALUES (@app, @p0, @p1, @p2, @u, @p4);`,
        [type, desc, due, email, status],
      );
    }
    const COMMS_458 = [
      ['sarah.mitchell@loandesk.local', 'Premier Finance Ltd (Broker)', 'Email', 'Application APP-000458 — Documents Required', '2026-08-22T09:15:00'],
      ['daniel.hayes@loandesk.local', 'Sarah Mitchell', 'Internal Note', 'Valuation report reviewed — acceptable', '2026-08-21T14:30:00'],
      ['sarah.mitchell@loandesk.local', 'John Smith', 'Email', 'Initial Offer Letter attached', '2026-08-20T10:00:00'],
    ];
    for (const [email, toParty, channel, subject, at] of COMMS_458) {
      await db.query(
        `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
         DECLARE @u INT = (SELECT user_id FROM users WHERE email=@p0);
         IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_communications WHERE application_id=@app AND subject=@p3)
           INSERT INTO application_communications (application_id, from_user_id, to_party, channel, subject, comm_at)
           VALUES (@app, @u, @p1, @p2, @p3, @p4);`,
        [email, toParty, channel, subject, at],
      );
    }
    await db.query(
      `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
       DECLARE @u INT = (SELECT user_id FROM users WHERE email='sarah.mitchell@loandesk.local');
       IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_notes WHERE application_id=@app)
         INSERT INTO application_notes (application_id, note, created_by, created_at)
         VALUES (@app, 'Application submitted to underwriting. All initial documents received from broker.', @u, '2026-08-22T14:32:00');`,
    );

    /* ---------------- 3f) APP-000457 — Harrison Properties / Development Finance ---------------- */
    await db.query(
      `DECLARE @stat INT = (SELECT application_status_id FROM application_statuses WHERE code='CREDIT_REVIEW');
       DECLARE @br INT = (SELECT branch_id FROM branches WHERE branch_name='London Branch');
       DECLARE @pr INT = (SELECT TOP 1 product_id FROM products WHERE code = 'BRIDGE-MULTI');
       DECLARE @src INT = (SELECT TOP 1 application_source_id FROM application_sources WHERE name LIKE 'Broker%');
       DECLARE @bk INT = (SELECT broker_id FROM brokers WHERE code='PREMIER');
       DECLARE @bdm INT = (SELECT user_id FROM users WHERE email='sarah.mitchell@loandesk.local');
       DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
       DECLARE @cm INT = (SELECT user_id FROM users WHERE email='emma.clarke@loandesk.local');
       IF NOT EXISTS (SELECT 1 FROM applications WHERE application_ref='APP-000457')
         INSERT INTO applications
           (application_ref, branch_id, product_id, application_status_id, application_source_id, broker_id,
            amount_requested, term_months, assigned_to, underwriter_id, credit_manager_id,
            initial_offer_state, initial_offer_note, sla_days, ltv_pct, submitted_at, created_at)
         VALUES
           ('APP-000457', @br, @pr, @stat, @src, @bk, 1250000, 18, @bdm, @uw, @cm,
            'CHASING', 'Chasing (30d)', 1, 72.000, '2026-08-20T10:00:00', '2026-08-20T10:00:00');`,
    );
    await db.query(
      `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000457');
       DECLARE @ap INT = (SELECT applicant_id FROM applicants WHERE company_name='Harrison Properties Ltd');
       IF @app IS NOT NULL AND @ap IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_applicants WHERE application_id=@app AND applicant_id=@ap)
         INSERT INTO application_applicants (application_id, applicant_id, applicant_role) VALUES (@app, @ap, 'Primary');`,
    );
    await db.query(
      `DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000457');
       IF @app IS NOT NULL AND NOT EXISTS (SELECT 1 FROM application_security WHERE application_id=@app)
         INSERT INTO application_security
           (application_id, property_address, estimated_value, charge_type, valuation_status, risk_rating, ltv_band, legal_check_status)
         VALUES (@app, 'Millbrook Development Site, Manchester M3', 1736000, '1st Legal Charge', 'Instructed', 'Medium', 'Standard', 'Not Started');`,
    );
  },
};
