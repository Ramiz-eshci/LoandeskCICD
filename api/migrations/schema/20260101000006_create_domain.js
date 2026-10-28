'use strict';

/**
 * Migration: core domain tables (Doc-02 Section 19).
 * Normalized schema for the Enquiry -> Application -> Underwriting -> Credit ->
 * Legal -> Loan -> Portfolio -> Collections flow.
 * Transactional tables carry row_version (ROWVERSION) for optimistic concurrency
 * (Section 32) plus standard audit columns and soft-delete (flag_deleted).
 */

const AUDIT = `
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL`;

async function T(db, name, body) {
  await db.raw(`IF OBJECT_ID('dbo.${name}','U') IS NULL CREATE TABLE dbo.${name} (${body});`);
}
async function IX(db, ix, tbl, cols) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`);
}

module.exports = {
  async up(db) {
    /* ---------- Applicants ---------- */
    await T(db, 'applicants', `
        applicant_id      INT IDENTITY(1,1) PRIMARY KEY,
        applicant_type_id INT NULL,
        first_name  NVARCHAR(100) NULL,
        last_name   NVARCHAR(100) NULL,
        company_name NVARCHAR(200) NULL,
        email       NVARCHAR(150) NULL,
        phone       NVARCHAR(30)  NULL,
        dob         DATE NULL,
        national_id NVARCHAR(50) NULL,
        ${AUDIT},
        CONSTRAINT FK_applicants_type FOREIGN KEY (applicant_type_id) REFERENCES dbo.applicant_types(applicant_type_id)`);
    await IX(db, 'IX_applicants_email', 'applicants', 'email');

    await T(db, 'applicant_addresses', `
        address_id   INT IDENTITY(1,1) PRIMARY KEY,
        applicant_id INT NOT NULL,
        address_type NVARCHAR(30) NULL,
        line1 NVARCHAR(255) NULL, line2 NVARCHAR(255) NULL,
        city NVARCHAR(100) NULL, state NVARCHAR(100) NULL,
        postcode NVARCHAR(20) NULL, country NVARCHAR(100) NULL,
        ${AUDIT},
        CONSTRAINT FK_addr_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);
    await IX(db, 'IX_addr_applicant', 'applicant_addresses', 'applicant_id');

    await T(db, 'applicant_employment', `
        employment_id INT IDENTITY(1,1) PRIMARY KEY,
        applicant_id  INT NOT NULL,
        employer_name NVARCHAR(200) NULL,
        job_title     NVARCHAR(150) NULL,
        employment_type NVARCHAR(50) NULL,
        annual_income DECIMAL(18,2) NULL,
        start_date DATE NULL, end_date DATE NULL,
        ${AUDIT},
        CONSTRAINT FK_emp_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);
    await IX(db, 'IX_emp_applicant', 'applicant_employment', 'applicant_id');

    await T(db, 'applicant_financials', `
        financial_id INT IDENTITY(1,1) PRIMARY KEY,
        applicant_id INT NOT NULL,
        total_income      DECIMAL(18,2) NULL,
        total_expenses    DECIMAL(18,2) NULL,
        total_assets      DECIMAL(18,2) NULL,
        total_liabilities DECIMAL(18,2) NULL,
        ${AUDIT},
        CONSTRAINT FK_fin_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);
    await IX(db, 'IX_fin_applicant', 'applicant_financials', 'applicant_id');

    /* ---------- Enquiries ---------- */
    await T(db, 'enquiries', `
        enquiry_id  INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_ref NVARCHAR(40) NOT NULL,
        branch_id   INT NULL,
        product_id  INT NULL,
        loan_purpose_id INT NULL,
        application_source_id INT NULL,
        enquiry_status_id INT NULL,
        applicant_name NVARCHAR(200) NULL,
        email NVARCHAR(150) NULL,
        phone NVARCHAR(30) NULL,
        amount_requested DECIMAL(18,2) NULL,
        assigned_to INT NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT UQ_enquiries_ref UNIQUE (enquiry_ref),
        CONSTRAINT FK_enq_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_enq_product FOREIGN KEY (product_id) REFERENCES dbo.products(product_id),
        CONSTRAINT FK_enq_purpose FOREIGN KEY (loan_purpose_id) REFERENCES dbo.loan_purposes(loan_purpose_id),
        CONSTRAINT FK_enq_source FOREIGN KEY (application_source_id) REFERENCES dbo.application_sources(application_source_id),
        CONSTRAINT FK_enq_status FOREIGN KEY (enquiry_status_id) REFERENCES dbo.enquiry_statuses(enquiry_status_id),
        CONSTRAINT FK_enq_assignee FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_enq_status', 'enquiries', 'enquiry_status_id');
    await IX(db, 'IX_enq_assignee', 'enquiries', 'assigned_to');

    await T(db, 'enquiry_assignments', `
        assignment_id INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id   INT NOT NULL,
        assigned_to  INT NOT NULL,
        assigned_by  INT NULL,
        assigned_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_ea_enq FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id),
        CONSTRAINT FK_ea_user FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_ea_enq', 'enquiry_assignments', 'enquiry_id');

    await T(db, 'enquiry_notes', `
        note_id    INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id INT NOT NULL,
        note       NVARCHAR(MAX) NOT NULL,
        created_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_en_enq FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id)`);
    await IX(db, 'IX_en_enq', 'enquiry_notes', 'enquiry_id');

    /* ---------- Applications ---------- */
    await T(db, 'applications', `
        application_id  INT IDENTITY(1,1) PRIMARY KEY,
        application_ref NVARCHAR(40) NOT NULL,
        enquiry_id INT NULL,
        branch_id  INT NULL,
        product_id INT NULL,
        loan_purpose_id INT NULL,
        application_status_id INT NULL,
        application_source_id INT NULL,
        broker_id INT NULL,
        rate_id   INT NULL,
        repayment_frequency_id INT NULL,
        amount_requested DECIMAL(18,2) NULL,
        term_months INT NULL,
        assigned_to INT NULL,
        submitted_at DATETIME2 NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT UQ_applications_ref UNIQUE (application_ref),
        CONSTRAINT FK_app_enq FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id),
        CONSTRAINT FK_app_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_app_product FOREIGN KEY (product_id) REFERENCES dbo.products(product_id),
        CONSTRAINT FK_app_purpose FOREIGN KEY (loan_purpose_id) REFERENCES dbo.loan_purposes(loan_purpose_id),
        CONSTRAINT FK_app_status FOREIGN KEY (application_status_id) REFERENCES dbo.application_statuses(application_status_id),
        CONSTRAINT FK_app_source FOREIGN KEY (application_source_id) REFERENCES dbo.application_sources(application_source_id),
        CONSTRAINT FK_app_broker FOREIGN KEY (broker_id) REFERENCES dbo.brokers(broker_id),
        CONSTRAINT FK_app_rate FOREIGN KEY (rate_id) REFERENCES dbo.interest_rates(rate_id),
        CONSTRAINT FK_app_freq FOREIGN KEY (repayment_frequency_id) REFERENCES dbo.repayment_frequencies(repayment_frequency_id),
        CONSTRAINT FK_app_assignee FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_app_status', 'applications', 'application_status_id');
    await IX(db, 'IX_app_enq', 'applications', 'enquiry_id');

    await T(db, 'application_applicants', `
        application_id INT NOT NULL,
        applicant_id   INT NOT NULL,
        applicant_role NVARCHAR(30) NOT NULL DEFAULT 'Primary',
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_app_applicants PRIMARY KEY (application_id, applicant_id),
        CONSTRAINT FK_aa_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_aa_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);

    await T(db, 'application_security', `
        security_id    INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        valuation_type_id INT NULL,
        property_address NVARCHAR(255) NULL,
        estimated_value  DECIMAL(18,2) NULL,
        valuation_amount DECIMAL(18,2) NULL,
        valuation_date DATE NULL,
        ${AUDIT},
        CONSTRAINT FK_sec_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_sec_valtype FOREIGN KEY (valuation_type_id) REFERENCES dbo.valuation_types(valuation_type_id)`);
    await IX(db, 'IX_sec_app', 'application_security', 'application_id');

    await T(db, 'application_financials', `
        app_financial_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        total_income      DECIMAL(18,2) NULL,
        total_expenses    DECIMAL(18,2) NULL,
        total_assets      DECIMAL(18,2) NULL,
        total_liabilities DECIMAL(18,2) NULL,
        ltv_pct DECIMAL(6,3) NULL,
        dsr_pct DECIMAL(6,3) NULL,
        ${AUDIT},
        CONSTRAINT FK_afin_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id)`);
    await IX(db, 'IX_afin_app', 'application_financials', 'application_id');

    await T(db, 'application_documents', `
        app_document_id  INT IDENTITY(1,1) PRIMARY KEY,
        application_id   INT NOT NULL,
        document_type_id INT NULL,
        file_name NVARCHAR(255) NULL,
        file_path NVARCHAR(500) NULL,
        status    NVARCHAR(30) NOT NULL DEFAULT 'Uploaded',
        uploaded_by INT NULL,
        ${AUDIT},
        CONSTRAINT FK_adoc_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_adoc_type FOREIGN KEY (document_type_id) REFERENCES dbo.document_types(document_type_id)`);
    await IX(db, 'IX_adoc_app', 'application_documents', 'application_id');

    /* ---------- KYC / AML ---------- */
    await T(db, 'kyc_checks', `
        kyc_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NULL,
        applicant_id   INT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        result NVARCHAR(30) NULL,
        checked_by INT NULL, checked_at DATETIME2 NULL,
        notes NVARCHAR(500) NULL,
        ${AUDIT},
        CONSTRAINT FK_kyc_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_kyc_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);

    await T(db, 'aml_checks', `
        aml_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NULL,
        applicant_id   INT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        result NVARCHAR(30) NULL,
        risk_level NVARCHAR(20) NULL,
        checked_by INT NULL, checked_at DATETIME2 NULL,
        notes NVARCHAR(500) NULL,
        ${AUDIT},
        CONSTRAINT FK_aml_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_aml_applicant FOREIGN KEY (applicant_id) REFERENCES dbo.applicants(applicant_id)`);

    /* ---------- Underwriting / Credit / Legal ---------- */
    await T(db, 'underwriting_cases', `
        underwriting_case_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        underwriter_id INT NULL,
        status   NVARCHAR(30) NOT NULL DEFAULT 'Pending',
        decision NVARCHAR(30) NULL,
        recommendation NVARCHAR(MAX) NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT FK_uw_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_uw_user FOREIGN KEY (underwriter_id) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_uw_app', 'underwriting_cases', 'application_id');

    await T(db, 'underwriting_conditions', `
        condition_id INT IDENTITY(1,1) PRIMARY KEY,
        underwriting_case_id INT NOT NULL,
        approval_condition_id INT NULL,
        description NVARCHAR(500) NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Open',
        ${AUDIT},
        CONSTRAINT FK_uwc_case FOREIGN KEY (underwriting_case_id) REFERENCES dbo.underwriting_cases(underwriting_case_id),
        CONSTRAINT FK_uwc_cond FOREIGN KEY (approval_condition_id) REFERENCES dbo.approval_conditions(approval_condition_id)`);
    await IX(db, 'IX_uwc_case', 'underwriting_conditions', 'underwriting_case_id');

    await T(db, 'credit_decisions', `
        credit_decision_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        decided_by INT NULL,
        decision   NVARCHAR(30) NOT NULL,
        rejection_reason_id INT NULL,
        amount_approved DECIMAL(18,2) NULL,
        rate_pct DECIMAL(6,3) NULL,
        notes NVARCHAR(MAX) NULL,
        decided_at DATETIME2 NULL,
        ${AUDIT},
        CONSTRAINT FK_cd_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_cd_user FOREIGN KEY (decided_by) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_cd_reason FOREIGN KEY (rejection_reason_id) REFERENCES dbo.rejection_reasons(rejection_reason_id)`);
    await IX(db, 'IX_cd_app', 'credit_decisions', 'application_id');

    await T(db, 'legal_cases', `
        legal_case_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        solicitor_id INT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Open',
        notes NVARCHAR(MAX) NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT FK_legal_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_legal_solicitor FOREIGN KEY (solicitor_id) REFERENCES dbo.solicitors(solicitor_id)`);
    await IX(db, 'IX_legal_app', 'legal_cases', 'application_id');

    /* ---------- Loans / Portfolio / Collections ---------- */
    await T(db, 'loans', `
        loan_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_number NVARCHAR(40) NOT NULL,
        application_id INT NULL,
        principal DECIMAL(18,2) NOT NULL,
        rate_pct  DECIMAL(6,3) NOT NULL,
        term_months INT NOT NULL,
        repayment_frequency_id INT NULL,
        start_date DATE NULL,
        maturity_date DATE NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Active',
        outstanding_balance DECIMAL(18,2) NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT UQ_loans_number UNIQUE (loan_number),
        CONSTRAINT FK_loan_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_loan_freq FOREIGN KEY (repayment_frequency_id) REFERENCES dbo.repayment_frequencies(repayment_frequency_id)`);
    await IX(db, 'IX_loan_app', 'loans', 'application_id');

    await T(db, 'loan_schedules', `
        schedule_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_id INT NOT NULL,
        installment_no INT NOT NULL,
        due_date DATE NOT NULL,
        principal_due DECIMAL(18,2) NOT NULL DEFAULT 0,
        interest_due  DECIMAL(18,2) NOT NULL DEFAULT 0,
        total_due     DECIMAL(18,2) NOT NULL DEFAULT 0,
        status NVARCHAR(20) NOT NULL DEFAULT 'Due',
        ${AUDIT},
        CONSTRAINT FK_sched_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT UQ_sched_loan_inst UNIQUE (loan_id, installment_no)`);
    await IX(db, 'IX_sched_loan', 'loan_schedules', 'loan_id');

    await T(db, 'loan_payments', `
        payment_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_id INT NOT NULL,
        schedule_id INT NULL,
        paid_on DATE NOT NULL,
        amount  DECIMAL(18,2) NOT NULL,
        method  NVARCHAR(30) NULL,
        reference NVARCHAR(80) NULL,
        ${AUDIT},
        CONSTRAINT FK_pay_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT FK_pay_sched FOREIGN KEY (schedule_id) REFERENCES dbo.loan_schedules(schedule_id)`);
    await IX(db, 'IX_pay_loan', 'loan_payments', 'loan_id');

    await T(db, 'collections', `
        collection_id INT IDENTITY(1,1) PRIMARY KEY,
        loan_id INT NOT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'Open',
        arrears_amount DECIMAL(18,2) NULL,
        days_overdue INT NULL,
        assigned_to INT NULL,
        notes NVARCHAR(MAX) NULL,
        row_version ROWVERSION,
        ${AUDIT},
        CONSTRAINT FK_col_loan FOREIGN KEY (loan_id) REFERENCES dbo.loans(loan_id),
        CONSTRAINT FK_col_user FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_col_loan', 'collections', 'loan_id');

    /* ---------- Notifications ---------- */
    await T(db, 'notifications', `
        notification_id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NULL,
        title NVARCHAR(200) NOT NULL,
        body  NVARCHAR(MAX) NULL,
        type  NVARCHAR(40) NULL,
        is_read BIT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_notif_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_notif_user', 'notifications', 'user_id');
  },

  async down(db) {
    const drop = [
      'notifications','collections','loan_payments','loan_schedules','loans',
      'legal_cases','credit_decisions','underwriting_conditions','underwriting_cases',
      'aml_checks','kyc_checks','application_documents','application_financials',
      'application_security','application_applicants','applications',
      'enquiry_notes','enquiry_assignments','enquiries',
      'applicant_financials','applicant_employment','applicant_addresses','applicants',
    ];
    for (const t of drop) {
      await db.raw(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DROP TABLE dbo.${t};`);
    }
  },
};
