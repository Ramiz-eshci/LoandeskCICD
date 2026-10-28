'use strict';

module.exports = {
  async run(db) {
    await db.query(`
      DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @app IS NULL RETURN;

      IF NOT EXISTS (SELECT 1 FROM underwriting_cases WHERE application_id=@app AND flag_deleted=0)
        INSERT INTO underwriting_cases (application_id, underwriter_id, status, current_step, created_by)
        VALUES (@app, @uw, 'In Portfolio', 8, @uw);
      ELSE
        UPDATE underwriting_cases
           SET status='In Portfolio', current_step=8, underwriter_id=COALESCE(underwriter_id, @uw), updated_by=@uw, updated_at=SYSUTCDATETIME()
         WHERE application_id=@app AND flag_deleted=0;

      DECLARE @case INT = (SELECT TOP 1 underwriting_case_id FROM underwriting_cases WHERE application_id=@app AND flag_deleted=0 ORDER BY underwriting_case_id DESC);
      DECLARE @n INT = 1;
      WHILE @n <= 8
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM underwriting_steps WHERE underwriting_case_id=@case AND step_no=@n)
          INSERT INTO underwriting_steps (underwriting_case_id, step_no, step_key, status, assigned_role, completed_at, created_by)
          VALUES (@case, @n, CONCAT('step_', @n), 'Completed', 'Underwriter', SYSUTCDATETIME(), @uw);
        ELSE
          UPDATE underwriting_steps SET status='Completed', completed_at=COALESCE(completed_at, SYSUTCDATETIME()) WHERE underwriting_case_id=@case AND step_no=@n;
        SET @n += 1;
      END;
    `);

    await db.query(`
      DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @app IS NULL RETURN;
      IF NOT EXISTS (SELECT 1 FROM loans WHERE application_id=@app AND flag_deleted=0)
        INSERT INTO loans (loan_number, application_id, principal, rate_pct, term_months, repayment_frequency_id, start_date, maturity_date, status, outstanding_balance, created_by)
        SELECT 'FAC-000458', application_id, amount_requested, 13.2, term_months, repayment_frequency_id, '2026-08-12', DATEADD(month, term_months, '2026-08-12'), 'Active', amount_requested + 8624, @uw
          FROM applications WHERE application_id=@app;
      ELSE
        UPDATE loans SET status='Active', rate_pct=13.2, start_date=COALESCE(start_date, '2026-08-12'), outstanding_balance=COALESCE(outstanding_balance, principal + 8624) WHERE application_id=@app AND flag_deleted=0;
    `);

    await db.query(`
      DECLARE @loan INT = (SELECT TOP 1 loan_id FROM loans l JOIN applications a ON a.application_id=l.application_id WHERE a.application_ref='APP-000458' AND l.flag_deleted=0);
      DECLARE @principal DECIMAL(18,2) = (SELECT principal FROM loans WHERE loan_id=@loan);
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      DECLARE @n INT = 1;
      IF @loan IS NULL RETURN;
      WHILE @n <= 12
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM loan_schedules WHERE loan_id=@loan AND installment_no=@n)
          INSERT INTO loan_schedules (loan_id, installment_no, due_date, principal_due, interest_due, total_due, status, created_by)
          VALUES (@loan, @n, DATEADD(month, @n, '2026-08-12'), CASE WHEN @n=12 THEN @principal ELSE 0 END, ROUND(@principal * 13.2 / 1200, 2), CASE WHEN @n=12 THEN @principal ELSE 0 END + ROUND(@principal * 13.2 / 1200, 2), 'Due', @uw);
        SET @n += 1;
      END;
    `);

    await db.query(`
      DECLARE @loan INT = (SELECT TOP 1 loan_id FROM loans l JOIN applications a ON a.application_id=l.application_id WHERE a.application_ref='APP-000458' AND l.flag_deleted=0);
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @loan IS NULL RETURN;
      IF NOT EXISTS (SELECT 1 FROM loan_payments WHERE loan_id=@loan AND reference='PMT-PORT-DEMO-001')
        INSERT INTO loan_payments (loan_id, paid_on, amount, method, reference, created_by)
        VALUES (@loan, '2026-09-12', 2673.00, 'Bank Transfer', 'PMT-PORT-DEMO-001', @uw);
      IF NOT EXISTS (SELECT 1 FROM collections WHERE loan_id=@loan AND notes='Portfolio demo monitoring case')
        INSERT INTO collections (loan_id, status, arrears_amount, days_overdue, assigned_to, notes, created_by)
        VALUES (@loan, 'Open', 0, 0, @uw, 'Portfolio demo monitoring case', @uw);
    `);

    await db.query(`
      DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
      DECLARE @loan INT = (SELECT TOP 1 loan_id FROM loans WHERE application_id=@app AND flag_deleted=0);
      DECLARE @ap INT = (SELECT TOP 1 applicant_id FROM application_applicants WHERE application_id=@app ORDER BY CASE WHEN applicant_role='Primary' THEN 0 ELSE 1 END);
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @loan IS NULL OR @ap IS NULL RETURN;
      IF NOT EXISTS (SELECT 1 FROM portfolio_contact_logs WHERE loan_id=@loan AND person='John Smith' AND contact_date='2026-09-15')
        INSERT INTO portfolio_contact_logs (loan_id, application_id, applicant_id, contact_date, person, method, contact_notes, followup_date, outlook_reminder, followup_status, contact_outcome, created_by)
        VALUES (@loan, @app, @ap, '2026-09-15', 'John Smith', 'Phone', 'Monthly portfolio check-in completed. Exit remains sale of property.', '2026-10-15', 0, 'Pending', 'Contacted', @uw);
      IF NOT EXISTS (SELECT 1 FROM portfolio_facility_requests WHERE loan_id=@loan AND request_type='Extension')
        INSERT INTO portfolio_facility_requests (loan_id, request_type, effective_date, current_maturity, proposed_maturity, revised_rate_pct, reason, created_by)
        SELECT @loan, 'Extension', '2026-09-15', maturity_date, DATEADD(month, 3, maturity_date), rate_pct, 'Demo extension request for credit review.', @uw FROM loans WHERE loan_id=@loan;
    `);

    await db.query(`
      DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
      DECLARE @loan INT = (SELECT TOP 1 loan_id FROM loans WHERE application_id=@app AND flag_deleted=0);
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @loan IS NULL RETURN;
      IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_name='loans' AND entity_id=CONVERT(varchar(60), @loan) AND action='LIVE_LOAN_CREATE')
        INSERT INTO audit_logs (user_id, action, module_key, entity_name, entity_id, details)
        VALUES (@uw, 'LIVE_LOAN_CREATE', 'PORTFOLIO.CONTACT_LOG', 'loans', CONVERT(varchar(60), @loan), '{"source":"underwriting_cases.status=In Portfolio"}');
    `);

    // Sample security/valuation, fees, drawdowns and covenants so the
    // facility detail tabs show data on the demo pipeline loan (not just the
    // Thomas customer). All guarded so re-seeding is idempotent.
    await db.query(`
      DECLARE @app INT = (SELECT application_id FROM applications WHERE application_ref='APP-000458');
      DECLARE @loan INT = (SELECT TOP 1 loan_id FROM loans WHERE application_id=@app AND flag_deleted=0);
      DECLARE @uw INT = (SELECT user_id FROM users WHERE email='daniel.hayes@loandesk.local');
      IF @app IS NULL OR @loan IS NULL RETURN;

      IF NOT EXISTS (SELECT 1 FROM application_security WHERE application_id=@app AND property_address='14 Kingsway, London EC2')
        INSERT INTO application_security (application_id, property_address, estimated_value, valuation_amount, valuation_date, valuation_status, charge_type, created_by)
        VALUES (@app, '14 Kingsway, London EC2', 520000, 500000, '2026-08-01', 'Completed', 'First Legal Charge', @uw);

      IF NOT EXISTS (SELECT 1 FROM loan_fees WHERE loan_id=@loan AND fee_type='Arrangement')
        INSERT INTO loan_fees (loan_id, fee_type, amount, due_date, status, notes, created_by)
        VALUES (@loan, 'Arrangement', 4500, '2026-08-12', 'Paid', 'Arrangement fee on drawdown', @uw);
      IF NOT EXISTS (SELECT 1 FROM loan_fees WHERE loan_id=@loan AND fee_type='Exit')
        INSERT INTO loan_fees (loan_id, fee_type, amount, due_date, status, notes, created_by)
        VALUES (@loan, 'Exit', 3000, DATEADD(month, 12, '2026-08-12'), 'Due', 'Exit fee at redemption', @uw);

      IF NOT EXISTS (SELECT 1 FROM loan_drawdowns WHERE loan_id=@loan AND drawdown_no=1)
        INSERT INTO loan_drawdowns (loan_id, drawdown_no, drawn_on, amount, notes, status, created_by)
        SELECT @loan, 1, '2026-08-12', principal, 'Initial drawdown', 'Released', @uw FROM loans WHERE loan_id=@loan;

      IF NOT EXISTS (SELECT 1 FROM loan_covenants WHERE loan_id=@loan AND name='Quarterly management accounts')
        INSERT INTO loan_covenants (loan_id, name, covenant_type, frequency, next_due, status, notes, created_by)
        VALUES (@loan, 'Quarterly management accounts', 'Reporting', 'Quarterly', DATEADD(month, 3, '2026-08-12'), 'Upcoming', 'Borrower to supply quarterly accounts', @uw);
      IF NOT EXISTS (SELECT 1 FROM loan_covenants WHERE loan_id=@loan AND name='Buildings insurance in place')
        INSERT INTO loan_covenants (loan_id, name, covenant_type, frequency, next_due, status, notes, created_by)
        VALUES (@loan, 'Buildings insurance in place', 'Insurance', 'Annual', DATEADD(month, 12, '2026-08-12'), 'Complied', 'Evidence of buildings insurance held', @uw);
    `);
  },
};
