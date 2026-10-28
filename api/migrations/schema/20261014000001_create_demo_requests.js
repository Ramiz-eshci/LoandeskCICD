'use strict';

module.exports = {
  async up(db) {
    await db.raw(`
      IF OBJECT_ID('dbo.demo_requests', 'U') IS NULL
      CREATE TABLE dbo.demo_requests (
        demo_request_id INT IDENTITY(1,1) PRIMARY KEY,
        request_ref UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        name NVARCHAR(120) NOT NULL,
        email NVARCHAR(254) NOT NULL,
        company NVARCHAR(160) NOT NULL,
        interest NVARCHAR(80) NOT NULL,
        message NVARCHAR(2000) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_demo_requests_ref UNIQUE (request_ref)
      );
    `);
  },

  async down(db) {
    await db.raw("IF OBJECT_ID('dbo.demo_requests', 'U') IS NOT NULL DROP TABLE dbo.demo_requests;");
  },
};
