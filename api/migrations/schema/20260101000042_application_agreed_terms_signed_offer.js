'use strict';

/**
 * Migration: carry the agreed offer into the application + signed offer upload
 * (client offer-letter changes 28-09-2026).
 *
 *  - applications.agreed_terms        NVARCHAR(MAX) — JSON snapshot of the accepted
 *    offer (or best available indicative) at convert time: fees in £, broker fee,
 *    interest type, net release, drawdowns [{ month, gross, net }], other securities.
 *  - applications.signed_offer_doc_id INT — the signed offer letter + application
 *    form (one file) uploaded when converting; underwriting review opens it first.
 *  - document_types 'SIGNED_OFFER' — the type that upload is saved under.
 */
module.exports = {
  async up(db) {
    await db.raw(`
      IF COL_LENGTH('dbo.applications','agreed_terms') IS NULL
        ALTER TABLE dbo.applications ADD agreed_terms NVARCHAR(MAX) NULL;
      IF COL_LENGTH('dbo.applications','signed_offer_doc_id') IS NULL
        ALTER TABLE dbo.applications ADD signed_offer_doc_id INT NULL;`);
    await db.raw(`
      IF NOT EXISTS (SELECT 1 FROM dbo.document_types WHERE code = 'SIGNED_OFFER')
        INSERT INTO dbo.document_types (code, name, category)
        VALUES ('SIGNED_OFFER', 'Signed Offer & Application Form', 'Offer');`);
  },
  async down(db) {
    await db.raw(`
      IF COL_LENGTH('dbo.applications','signed_offer_doc_id') IS NOT NULL ALTER TABLE dbo.applications DROP COLUMN signed_offer_doc_id;
      IF COL_LENGTH('dbo.applications','agreed_terms') IS NOT NULL ALTER TABLE dbo.applications DROP COLUMN agreed_terms;`);
  },
};
