'use strict';

/**
 * Migration: extend the Application module (Module-5) to the Figma detail spec.
 *
 * Additive & idempotent (COL_LENGTH / OBJECT_ID / sys.foreign_keys guards) —
 * never edits the applied 20260101000006_create_domain migration.
 *
 * Brings applications up to the Figma "Application Detail" field list:
 *   - case team (underwriter, credit manager)
 *   - loan pricing / fee breakdown + IRR (Summary & Loan Details tabs)
 *   - broker fee allocation (Broker tab)
 *   - KYC/AML/PEP screening summary (Applicant tab)
 *   - initial-offer state + SLA + completion date (listing + header)
 * Extends application_security (Security tab: valuation status, risk rating,
 * LTV band, legal check, charge type) and application_documents (version +
 * verification), and adds the Tasks, Communications and Notes tab tables.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function addFk(db, name, table, ddl) {
  await db.raw(
    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${name}')
       ALTER TABLE dbo.${table} ADD CONSTRAINT ${name} ${ddl};`,
  );
}
async function IX(db, ix, tbl, cols) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`);
}

const AUDIT = `
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL`;

module.exports = {
  async up(db) {
    /* ---------- applications: case team ---------- */
    await addCol(db, 'applications', 'underwriter_id', 'underwriter_id INT NULL');
    await addCol(db, 'applications', 'credit_manager_id', 'credit_manager_id INT NULL');
    await addFk(db, 'FK_app_underwriter', 'applications',
      'FOREIGN KEY (underwriter_id) REFERENCES dbo.users(user_id)');
    await addFk(db, 'FK_app_credit_mgr', 'applications',
      'FOREIGN KEY (credit_manager_id) REFERENCES dbo.users(user_id)');

    /* ---------- applications: header / listing extras ---------- */
    await addCol(db, 'applications', 'initial_offer_state', 'initial_offer_state NVARCHAR(40) NULL');
    await addCol(db, 'applications', 'initial_offer_note', 'initial_offer_note NVARCHAR(120) NULL');
    await addCol(db, 'applications', 'sla_days', 'sla_days INT NULL');
    await addCol(db, 'applications', 'completion_date', 'completion_date DATE NULL');

    /* ---------- applications: loan pricing / fee breakdown (Summary + Loan Details) ---------- */
    await addCol(db, 'applications', 'net_advance', 'net_advance DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'ltv_pct', 'ltv_pct DECIMAL(6,3) NULL');
    await addCol(db, 'applications', 'monthly_fee_pct', 'monthly_fee_pct DECIMAL(9,4) NULL');
    await addCol(db, 'applications', 'arrangement_fee_pct', 'arrangement_fee_pct DECIMAL(9,4) NULL');
    await addCol(db, 'applications', 'exit_fee', 'exit_fee DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'doc_fee', 'doc_fee DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'rolled_interest', 'rolled_interest DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'gross_redemption', 'gross_redemption DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'irr_pct', 'irr_pct DECIMAL(9,4) NULL');

    /* ---------- applications: broker fee allocation (Broker tab) ---------- */
    await addCol(db, 'applications', 'loandesk_broker_fee_pct', 'loandesk_broker_fee_pct DECIMAL(9,4) NULL');
    await addCol(db, 'applications', 'borrower_broker_fee', 'borrower_broker_fee DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'introducer_fee', 'introducer_fee DECIMAL(18,2) NULL');
    await addCol(db, 'applications', 'lender_income', 'lender_income DECIMAL(18,2) NULL');

    /* ---------- applications: KYC / AML / PEP screening summary (Applicant tab) ---------- */
    await addCol(db, 'applications', 'kyc_identity_status', 'kyc_identity_status NVARCHAR(30) NULL');
    await addCol(db, 'applications', 'kyc_aml_status', 'kyc_aml_status NVARCHAR(30) NULL');
    await addCol(db, 'applications', 'kyc_pep_status', 'kyc_pep_status NVARCHAR(30) NULL');
    await addCol(db, 'applications', 'kyc_overall_status', 'kyc_overall_status NVARCHAR(30) NULL');

    await IX(db, 'IX_app_underwriter', 'applications', 'underwriter_id');

    /* ---------- application_security: Security tab extras ---------- */
    await addCol(db, 'application_security', 'charge_type', 'charge_type NVARCHAR(40) NULL');
    await addCol(db, 'application_security', 'valuation_status', 'valuation_status NVARCHAR(30) NULL');
    await addCol(db, 'application_security', 'valuation_check', 'valuation_check NVARCHAR(30) NULL');
    await addCol(db, 'application_security', 'risk_rating', 'risk_rating NVARCHAR(20) NULL');
    await addCol(db, 'application_security', 'ltv_band', 'ltv_band NVARCHAR(30) NULL');
    await addCol(db, 'application_security', 'legal_check_status', 'legal_check_status NVARCHAR(30) NULL');

    /* ---------- application_documents: version + verification (Documents tab) ---------- */
    await addCol(db, 'application_documents', 'version', "version NVARCHAR(10) NOT NULL DEFAULT 'v1'");
    await addCol(db, 'application_documents', 'verified_status', 'verified_status NVARCHAR(30) NULL');
    await addCol(db, 'application_documents', 'verified_at', 'verified_at DATE NULL');

    /* ---------- application_tasks (Tasks tab) ---------- */
    await db.raw(`
      IF OBJECT_ID('dbo.application_tasks','U') IS NULL
      CREATE TABLE dbo.application_tasks (
        task_id        INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        task_type      NVARCHAR(60) NULL,
        description    NVARCHAR(500) NULL,
        due_date       DATE NULL,
        assigned_to    INT NULL,
        status         NVARCHAR(30) NOT NULL DEFAULT 'Outstanding',
        completed_at   DATETIME2 NULL,
        ${AUDIT},
        CONSTRAINT FK_atask_app  FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_atask_user FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)
      );`);
    await IX(db, 'IX_atask_app', 'application_tasks', 'application_id');

    /* ---------- application_communications (Communications tab) ---------- */
    await db.raw(`
      IF OBJECT_ID('dbo.application_communications','U') IS NULL
      CREATE TABLE dbo.application_communications (
        communication_id INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        from_user_id   INT NULL,
        to_party       NVARCHAR(200) NULL,
        channel        NVARCHAR(30) NOT NULL DEFAULT 'Email',
        subject        NVARCHAR(300) NULL,
        body           NVARCHAR(MAX) NULL,
        comm_at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        ${AUDIT},
        CONSTRAINT FK_acomm_app  FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id),
        CONSTRAINT FK_acomm_user FOREIGN KEY (from_user_id) REFERENCES dbo.users(user_id)
      );`);
    await IX(db, 'IX_acomm_app', 'application_communications', 'application_id');

    /* ---------- application_notes (Applicant tab: Recent Notes) ---------- */
    await db.raw(`
      IF OBJECT_ID('dbo.application_notes','U') IS NULL
      CREATE TABLE dbo.application_notes (
        note_id        INT IDENTITY(1,1) PRIMARY KEY,
        application_id INT NOT NULL,
        note           NVARCHAR(MAX) NOT NULL,
        created_by     INT NULL,
        created_at     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_anote_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id)
      );`);
    await IX(db, 'IX_anote_app', 'application_notes', 'application_id');
  },

  async down(db) {
    for (const t of ['application_notes', 'application_communications', 'application_tasks']) {
      await db.raw(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DROP TABLE dbo.${t};`);
    }
    for (const c of ['version', 'verified_status', 'verified_at']) {
      await db.raw(`IF COL_LENGTH('dbo.application_documents','${c}') IS NOT NULL ALTER TABLE dbo.application_documents DROP COLUMN ${c};`);
    }
    for (const c of ['charge_type','valuation_status','valuation_check','risk_rating','ltv_band','legal_check_status']) {
      await db.raw(`IF COL_LENGTH('dbo.application_security','${c}') IS NOT NULL ALTER TABLE dbo.application_security DROP COLUMN ${c};`);
    }
    for (const fk of ['FK_app_underwriter', 'FK_app_credit_mgr']) {
      await db.raw(`IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${fk}') ALTER TABLE dbo.applications DROP CONSTRAINT ${fk};`);
    }
    await db.raw("IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_app_underwriter') DROP INDEX IX_app_underwriter ON dbo.applications;");
    for (const c of ['underwriter_id','credit_manager_id','initial_offer_state','initial_offer_note','sla_days','completion_date',
      'net_advance','ltv_pct','monthly_fee_pct','arrangement_fee_pct','exit_fee','doc_fee','rolled_interest','gross_redemption','irr_pct',
      'loandesk_broker_fee_pct','borrower_broker_fee','introducer_fee','lender_income',
      'kyc_identity_status','kyc_aml_status','kyc_pep_status','kyc_overall_status']) {
      await db.raw(`IF COL_LENGTH('dbo.applications','${c}') IS NOT NULL ALTER TABLE dbo.applications DROP COLUMN ${c};`);
    }
  },
};
