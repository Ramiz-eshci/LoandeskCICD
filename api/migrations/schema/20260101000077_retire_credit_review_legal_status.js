'use strict';

/**
 * Migration: retire the Credit Review and Legal application stages (client 15-10-2026).
 * The credit committee is a step inside underwriting and the Credit / Legal modules left
 * the menu on 29-09-2026, so applications go Underwriting -> Approved -> Completed.
 *   - applications at CREDIT_REVIEW -> UNDERWRITING (still awaiting the committee)
 *   - applications at LEGAL         -> APPROVED
 *   - both statuses set inactive (rows kept: old audit / history still resolve the name)
 * Idempotent. down() re-activates the statuses; the moved applications are not moved back.
 */
async function moveApps(db, fromCode, toCode) {
  await db.query(
    `UPDATE a SET application_status_id = t.application_status_id, updated_at = SYSUTCDATETIME()
       FROM applications a
       JOIN application_statuses f ON f.application_status_id = a.application_status_id AND f.code = @p0
       JOIN application_statuses t ON t.code = @p1 AND t.flag_deleted = 0
      WHERE a.flag_deleted = 0`, [fromCode, toCode]);
}
module.exports = {
  async up(db) {
    await moveApps(db, 'CREDIT_REVIEW', 'UNDERWRITING');
    await moveApps(db, 'LEGAL', 'APPROVED');
    await db.query(`UPDATE application_statuses SET is_active = 0, updated_at = SYSUTCDATETIME() WHERE code IN ('CREDIT_REVIEW','LEGAL')`);
  },
  async down(db) {
    await db.query(`UPDATE application_statuses SET is_active = 1, updated_at = SYSUTCDATETIME() WHERE code IN ('CREDIT_REVIEW','LEGAL')`);
  },
};
