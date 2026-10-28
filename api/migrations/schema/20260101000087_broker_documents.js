'use strict';

/**
 * Migration: broker documents (client 22-10-2026).
 * Broker dashboard > Documents tab - e.g. the signed broker agreement, terms of business,
 * FCA registration. Files live under uploads/broker_documents. Additive + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF OBJECT_ID('dbo.broker_documents','U') IS NULL CREATE TABLE dbo.broker_documents (
        broker_document_id INT IDENTITY(1,1) PRIMARY KEY,
        broker_id     INT NOT NULL,
        document_type NVARCHAR(100) NULL,
        file_name     NVARCHAR(255) NOT NULL,
        file_path     NVARCHAR(500) NOT NULL,
        notes         NVARCHAR(500) NULL,
        expiry_date   DATE NULL,
        uploaded_by   INT NULL,
        flag_deleted  BIT NOT NULL DEFAULT 0,
        created_by    INT NULL,
        created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        deleted_by    INT NULL,
        deleted_on    DATETIME2 NULL,
        CONSTRAINT FK_broker_documents_broker FOREIGN KEY (broker_id) REFERENCES dbo.brokers (broker_id));`);
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_broker_documents_broker')
        CREATE INDEX IX_broker_documents_broker ON dbo.broker_documents (broker_id, flag_deleted);`);
  },
  async down(db) {
    await db.raw(`IF OBJECT_ID('dbo.broker_documents','U') IS NOT NULL DROP TABLE dbo.broker_documents;`);
  },
};
