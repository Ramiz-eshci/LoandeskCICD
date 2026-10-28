'use strict';

/**
 * Migration: e-mail reply tracking (client 17-10-2026).
 *
 * When a broker / applicant replies to an "Information required" e-mail with
 * documents, the reply must be matched back to the enquiry / application /
 * underwriting case it was sent from and the attachments uploaded there.
 *
 *  - email_log.internet_message_id / conversation_id : ids of the sent message
 *    (read back from Sent Items after the send) so a reply can be matched.
 *  - outlook_processed_emails.module / record_id / match_method : which record
 *    an inbound reply was attached to (status = 'reply_matched').
 *
 * Additive + idempotent.
 */
async function addCol(db, table, col, ddl) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NULL ALTER TABLE dbo.${table} ADD ${ddl};`);
}
async function dropCol(db, table, col) {
  await db.raw(`IF COL_LENGTH('dbo.${table}','${col}') IS NOT NULL ALTER TABLE dbo.${table} DROP COLUMN ${col};`);
}

module.exports = {
  async up(db) {
    await addCol(db, 'email_log', 'internet_message_id', 'internet_message_id NVARCHAR(512) NULL');
    await addCol(db, 'email_log', 'conversation_id', 'conversation_id NVARCHAR(512) NULL');
    await db.raw(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_email_log_conv')
      CREATE INDEX IX_email_log_conv ON dbo.email_log(conversation_id);`);

    await addCol(db, 'outlook_processed_emails', 'module', 'module NVARCHAR(30) NULL');
    await addCol(db, 'outlook_processed_emails', 'record_id', 'record_id INT NULL');
    await addCol(db, 'outlook_processed_emails', 'match_method', 'match_method NVARCHAR(30) NULL');
  },
  async down(db) {
    await db.raw(`IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_email_log_conv') DROP INDEX IX_email_log_conv ON dbo.email_log;`);
    await dropCol(db, 'email_log', 'conversation_id');
    await dropCol(db, 'email_log', 'internet_message_id');
    await dropCol(db, 'outlook_processed_emails', 'match_method');
    await dropCol(db, 'outlook_processed_emails', 'record_id');
    await dropCol(db, 'outlook_processed_emails', 'module');
  },
};
