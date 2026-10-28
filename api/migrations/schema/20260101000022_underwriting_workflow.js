'use strict';

/**
 * Migration: Underwriting workflow engine (Module-6).
 *
 * Additive & idempotent. Reuses the existing underwriting_cases table (created
 * in 20260101000006_create_domain) as the case root and adds the persisted
 * workflow: per-step rows, queries and a granular workflow audit trail. Legal /
 * valuation / credit already have their own tables/modules — not duplicated here.
 *
 * Figma stepper (silver-march-... /underwriting): 8 steps + FINAL Credit Review.
 *   1 Initial Review · 2 Valuation Instruction · 3 KYC/AML · 4 Solicitor Quote
 *   5 Requirements to Broker · 6 Underwrite & Findings · 7 Credit Discussion
 *   8 Final Ready to Proceed  -> Send to Credit Team.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function T(db, name, body) {
  await db.raw(`IF OBJECT_ID('dbo.${name}','U') IS NULL CREATE TABLE dbo.${name} (${body});`);
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
    /* ---- extend underwriting_cases: workflow driver columns ---- */
    await addCol(db, 'underwriting_cases', 'current_step', 'current_step INT NOT NULL DEFAULT 1');
    await addCol(db, 'underwriting_cases', 'accepted_by', 'accepted_by INT NULL');
    await addCol(db, 'underwriting_cases', 'accepted_at', 'accepted_at DATETIME2 NULL');
    await addCol(db, 'underwriting_cases', 'sla_due_date', 'sla_due_date DATE NULL');
    await addCol(db, 'underwriting_cases', 'closed_reason', 'closed_reason NVARCHAR(500) NULL');
    await IX(db, 'IX_uw_case_status', 'underwriting_cases', 'status');

    /* ---- per-step rows: one per (case, step_no) ---- */
    await T(db, 'underwriting_steps', `
        underwriting_step_id INT IDENTITY(1,1) PRIMARY KEY,
        underwriting_case_id INT NOT NULL,
        step_no       INT NOT NULL,
        step_key      NVARCHAR(50) NOT NULL,
        status        NVARCHAR(30) NOT NULL DEFAULT 'Locked',
        assigned_to   INT NULL,
        assigned_role NVARCHAR(50) NULL,
        data          NVARCHAR(MAX) NULL,
        decision      NVARCHAR(50) NULL,
        notes         NVARCHAR(MAX) NULL,
        started_at    DATETIME2 NULL,
        completed_at  DATETIME2 NULL,
        row_version   ROWVERSION,
        ${AUDIT},
        CONSTRAINT FK_uwstep_case FOREIGN KEY (underwriting_case_id) REFERENCES dbo.underwriting_cases(underwriting_case_id),
        CONSTRAINT FK_uwstep_user FOREIGN KEY (assigned_to) REFERENCES dbo.users(user_id)`);
    await IX(db, 'IX_uwstep_case', 'underwriting_steps', 'underwriting_case_id, step_no');

    /* ---- queries / request-information ---- */
    await T(db, 'underwriting_queries', `
        underwriting_query_id INT IDENTITY(1,1) PRIMARY KEY,
        underwriting_case_id INT NOT NULL,
        step_no       INT NULL,
        raised_by     INT NULL,
        target_role   NVARCHAR(50) NULL,
        target_user   INT NULL,
        description   NVARCHAR(MAX) NOT NULL,
        status        NVARCHAR(30) NOT NULL DEFAULT 'Open',
        response      NVARCHAR(MAX) NULL,
        responded_by  INT NULL,
        responded_at  DATETIME2 NULL,
        ${AUDIT},
        CONSTRAINT FK_uwq_case FOREIGN KEY (underwriting_case_id) REFERENCES dbo.underwriting_cases(underwriting_case_id)`);
    await IX(db, 'IX_uwq_case', 'underwriting_queries', 'underwriting_case_id');

    /* ---- granular workflow audit (every transition) ---- */
    await T(db, 'underwriting_audit', `
        underwriting_audit_id INT IDENTITY(1,1) PRIMARY KEY,
        underwriting_case_id INT NOT NULL,
        step_no      INT NULL,
        action       NVARCHAR(60) NOT NULL,
        from_status  NVARCHAR(60) NULL,
        to_status    NVARCHAR(60) NULL,
        user_id      INT NULL,
        role_name    NVARCHAR(60) NULL,
        reason       NVARCHAR(MAX) NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_uwaudit_case FOREIGN KEY (underwriting_case_id) REFERENCES dbo.underwriting_cases(underwriting_case_id)`);
    await IX(db, 'IX_uwaudit_case', 'underwriting_audit', 'underwriting_case_id');
  },

  async down(db) {
    for (const t of ['underwriting_audit', 'underwriting_queries', 'underwriting_steps']) {
      await db.raw(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DROP TABLE dbo.${t};`);
    }
    for (const c of ['current_step', 'accepted_by', 'accepted_at', 'sla_due_date', 'closed_reason']) {
      await db.raw(`IF COL_LENGTH('dbo.underwriting_cases','${c}') IS NOT NULL ALTER TABLE dbo.underwriting_cases DROP COLUMN ${c};`);
    }
  },
};
