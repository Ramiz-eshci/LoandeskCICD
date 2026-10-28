'use strict';

/**
 * Migration: extend the Enquiry module (Module-4).
 *
 * Additive only — never edits the applied 20260101000006_create_domain migration.
 * Brings the enquiries schema up to the Module-4 field list:
 *   company details, applicant type, broker, property/security, term, summary,
 *   lost reason, and the conversion link to applications.
 * Also adds assignment history (previous owner + note) and an attachments table.
 *
 * Every statement is guarded (COL_LENGTH / OBJECT_ID / sys.foreign_keys) so the
 * migration is idempotent and safe to re-run.
 */

async function addCol(db, table, col, ddl) {
  await db.raw(
    `IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`,
  );
}
async function addFk(db, name, table, ddl) {
  await db.raw(
    `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${name}')
       ALTER TABLE dbo.${table} ADD CONSTRAINT ${name} ${ddl};`,
  );
}
async function IX(db, ix, tbl, cols) {
  await db.raw(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`,
  );
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
    /* ---------- enquiries: new Module-4 columns ---------- */
    await addCol(db, 'enquiries', 'company_name', 'company_name NVARCHAR(200) NULL');
    await addCol(db, 'enquiries', 'applicant_type_id', 'applicant_type_id INT NULL');
    await addCol(db, 'enquiries', 'broker_id', 'broker_id INT NULL');
    await addCol(db, 'enquiries', 'property_address', 'property_address NVARCHAR(255) NULL');
    await addCol(db, 'enquiries', 'estimated_value', 'estimated_value DECIMAL(18,2) NULL');
    await addCol(db, 'enquiries', 'term_months', 'term_months INT NULL');
    await addCol(db, 'enquiries', 'summary', 'summary NVARCHAR(MAX) NULL');
    await addCol(db, 'enquiries', 'lost_reason', 'lost_reason NVARCHAR(255) NULL');
    await addCol(db, 'enquiries', 'converted_application_id', 'converted_application_id INT NULL');
    await addCol(db, 'enquiries', 'converted_at', 'converted_at DATETIME2 NULL');

    await addFk(db, 'FK_enq_applicant_type', 'enquiries',
      'FOREIGN KEY (applicant_type_id) REFERENCES dbo.applicant_types(applicant_type_id)');
    await addFk(db, 'FK_enq_broker', 'enquiries',
      'FOREIGN KEY (broker_id) REFERENCES dbo.brokers(broker_id)');
    await addFk(db, 'FK_enq_converted_app', 'enquiries',
      'FOREIGN KEY (converted_application_id) REFERENCES dbo.applications(application_id)');
    await IX(db, 'IX_enq_broker', 'enquiries', 'broker_id');

    /* ---------- enquiry_assignments: history fields ---------- */
    await addCol(db, 'enquiry_assignments', 'previous_assigned_to', 'previous_assigned_to INT NULL');
    await addCol(db, 'enquiry_assignments', 'note', 'note NVARCHAR(500) NULL');
    await addFk(db, 'FK_ea_prev_user', 'enquiry_assignments',
      'FOREIGN KEY (previous_assigned_to) REFERENCES dbo.users(user_id)');

    /* ---------- enquiry_documents: attachments ---------- */
    await db.raw(`
      IF OBJECT_ID('dbo.enquiry_documents','U') IS NULL
      CREATE TABLE dbo.enquiry_documents (
        enquiry_document_id INT IDENTITY(1,1) PRIMARY KEY,
        enquiry_id   INT NOT NULL,
        document_type_id INT NULL,
        file_name NVARCHAR(255) NULL,
        file_path NVARCHAR(500) NULL,
        uploaded_by INT NULL,
        ${AUDIT},
        CONSTRAINT FK_enqdoc_enq FOREIGN KEY (enquiry_id) REFERENCES dbo.enquiries(enquiry_id),
        CONSTRAINT FK_enqdoc_type FOREIGN KEY (document_type_id) REFERENCES dbo.document_types(document_type_id)
      );`);
    await IX(db, 'IX_enqdoc_enq', 'enquiry_documents', 'enquiry_id');
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.enquiry_documents','U') IS NOT NULL DROP TABLE dbo.enquiry_documents;");

    for (const fk of ['FK_ea_prev_user']) {
      await db.raw(`IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${fk}') ALTER TABLE dbo.enquiry_assignments DROP CONSTRAINT ${fk};`);
    }
    for (const c of ['previous_assigned_to', 'note']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiry_assignments','${c}') IS NOT NULL ALTER TABLE dbo.enquiry_assignments DROP COLUMN ${c};`);
    }

    for (const fk of ['FK_enq_applicant_type', 'FK_enq_broker', 'FK_enq_converted_app']) {
      await db.raw(`IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='${fk}') ALTER TABLE dbo.enquiries DROP CONSTRAINT ${fk};`);
    }
    await db.raw("IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_enq_broker') DROP INDEX IX_enq_broker ON dbo.enquiries;");
    for (const c of ['company_name','applicant_type_id','broker_id','property_address','estimated_value','term_months','summary','lost_reason','converted_application_id','converted_at']) {
      await db.raw(`IF COL_LENGTH('dbo.enquiries','${c}') IS NOT NULL ALTER TABLE dbo.enquiries DROP COLUMN ${c};`);
    }
  },
};
