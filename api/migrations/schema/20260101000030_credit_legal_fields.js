'use strict';

/**
 * Migration: Credit Approval + Legal & Completion module fields (client Figma).
 * Additive & idempotent. Credit + Legal run on the applications table;
 * underwriting module is untouched.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function addFk(db, name, table, ddl) {
  await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${name}') ALTER TABLE dbo.${table} ADD CONSTRAINT ${name} ${ddl};`);
}

module.exports = {
  async up(db) {
    /* ---- applications: credit + legal columns ---- */
    await addCol(db, 'applications', 'irr', 'irr DECIMAL(6,3) NULL');
    await addCol(db, 'applications', 'uw_recommendation', 'uw_recommendation NVARCHAR(60) NULL');
    await addCol(db, 'applications', 'initial_offer_status', 'initial_offer_status NVARCHAR(60) NULL');
    await addCol(db, 'applications', 'policy_exceptions', 'policy_exceptions INT NULL');
    await addCol(db, 'applications', 'legal_stage', "legal_stage NVARCHAR(40) NULL");
    await addCol(db, 'applications', 'borrower_solicitor_id', 'borrower_solicitor_id INT NULL');
    await addCol(db, 'applications', 'lender_solicitor_id', 'lender_solicitor_id INT NULL');
    await addCol(db, 'applications', 'offer_date', 'offer_date DATE NULL');
    await addCol(db, 'applications', 'target_completion_date', 'target_completion_date DATE NULL');
    await addCol(db, 'applications', 'credit_conditions', 'credit_conditions NVARCHAR(MAX) NULL');
    await addCol(db, 'applications', 'completed_at', 'completed_at DATETIME2 NULL');

    await addFk(db, 'FK_app_borr_sol', 'applications', 'FOREIGN KEY (borrower_solicitor_id) REFERENCES dbo.solicitors(solicitor_id)');
    await addFk(db, 'FK_app_lend_sol', 'applications', 'FOREIGN KEY (lender_solicitor_id) REFERENCES dbo.solicitors(solicitor_id)');

    /* ---- credit_decisions: conditions text ---- */
    await addCol(db, 'credit_decisions', 'conditions', 'conditions NVARCHAR(MAX) NULL');

    /* ---- legal_conditions: per-application completion conditions ---- */
    await db.raw(
      `IF OBJECT_ID('dbo.legal_conditions','U') IS NULL
       CREATE TABLE dbo.legal_conditions (
         legal_condition_id INT IDENTITY(1,1) PRIMARY KEY,
         application_id INT NOT NULL,
         name        NVARCHAR(200) NOT NULL,
         status      NVARCHAR(20) NOT NULL DEFAULT 'Pending',
         sort_order  INT NOT NULL DEFAULT 0,
         is_active   BIT NOT NULL DEFAULT 1,
         flag_deleted BIT NOT NULL DEFAULT 0,
         created_by  INT NULL,
         created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
         updated_by  INT NULL,
         updated_at  DATETIME2 NULL,
         deleted_on  DATETIME2 NULL,
         CONSTRAINT FK_legalcond_app FOREIGN KEY (application_id) REFERENCES dbo.applications(application_id)
       );`,
    );
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_legalcond_app') CREATE INDEX IX_legalcond_app ON dbo.legal_conditions(application_id);`);
  },

  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.legal_conditions','U') IS NOT NULL DROP TABLE dbo.legal_conditions;`);
    for (const c of ['irr','uw_recommendation','initial_offer_status','policy_exceptions','legal_stage','borrower_solicitor_id','lender_solicitor_id','offer_date','target_completion_date','credit_conditions','completed_at']) {
      await db.raw(`IF COL_LENGTH('dbo.applications','${c}') IS NOT NULL ALTER TABLE dbo.applications DROP COLUMN ${c};`);
    }
    await db.raw(`IF COL_LENGTH('dbo.credit_decisions','conditions') IS NOT NULL ALTER TABLE dbo.credit_decisions DROP COLUMN conditions;`);
  },
};
