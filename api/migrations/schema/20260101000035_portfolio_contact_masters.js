'use strict';

/**
 * Migration: contact-log lookup masters — contact_methods, followup_statuses,
 * contact_outcomes. These replace the hard-coded dropdown values in the
 * Portfolio "Customer Logs" (contact log) area so they become admin-managed
 * masters. Same convention as config/masters.config.js: IDENTITY PK, unique
 * business `code`, `name`, `sort_order`, standard audit columns.
 */

const AUDIT = `
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL`;

async function table(db, name, bodySql) {
  await db.raw(`IF OBJECT_ID('dbo.${name}','U') IS NULL CREATE TABLE dbo.${name} (${bodySql});`);
}

module.exports = {
  async up(db) {
    await table(db, 'contact_methods', `
        contact_method_id INT IDENTITY(1,1) PRIMARY KEY,
        code       NVARCHAR(30)  NOT NULL,
        name       NVARCHAR(150) NOT NULL,
        sort_order INT NULL,
        ${AUDIT},
        CONSTRAINT UQ_contact_methods_code UNIQUE (code)`);

    await table(db, 'followup_statuses', `
        followup_status_id INT IDENTITY(1,1) PRIMARY KEY,
        code       NVARCHAR(30)  NOT NULL,
        name       NVARCHAR(150) NOT NULL,
        sort_order INT NULL,
        ${AUDIT},
        CONSTRAINT UQ_followup_statuses_code UNIQUE (code)`);

    await table(db, 'contact_outcomes', `
        contact_outcome_id INT IDENTITY(1,1) PRIMARY KEY,
        code       NVARCHAR(40)  NOT NULL,
        name       NVARCHAR(150) NOT NULL,
        sort_order INT NULL,
        ${AUDIT},
        CONSTRAINT UQ_contact_outcomes_code UNIQUE (code)`);
  },

  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.contact_outcomes','U') IS NOT NULL DROP TABLE dbo.contact_outcomes;`);
    await db.raw(`IF OBJECT_ID('dbo.followup_statuses','U') IS NOT NULL DROP TABLE dbo.followup_statuses;`);
    await db.raw(`IF OBJECT_ID('dbo.contact_methods','U') IS NOT NULL DROP TABLE dbo.contact_methods;`);
  },
};
