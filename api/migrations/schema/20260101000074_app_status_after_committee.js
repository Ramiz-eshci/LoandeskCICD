'use strict';

/**
 * Migration: application status catch-up, round 2 (client 15-10-2026).
 * 073 only promoted CREDIT_REVIEW -> APPROVED when step 10 (Final Credit Committee) was
 * stored as 'Completed'. Cases whose committee step was saved as 'Approved' / 'Skipped',
 * or that have already moved on to Funds to Solicitor / Completion (current_step >= 11),
 * kept saying "Credit Review". Data-only, idempotent; down() is a no-op.
 */
module.exports = {
  async up(db) {
    const r = await db.query(`SELECT TOP 1 application_status_id AS id FROM application_statuses WHERE code = 'APPROVED'`);
    if (!r.length) return;
    await db.query(
      `UPDATE a SET application_status_id = @p0, updated_at = SYSUTCDATETIME()
         FROM applications a
         JOIN underwriting_cases uc ON uc.application_id = a.application_id AND uc.flag_deleted = 0
         JOIN application_statuses st ON st.application_status_id = a.application_status_id
        WHERE a.flag_deleted = 0
          AND st.code IN ('CREDIT_REVIEW','UNDERWRITING','SUBMITTED','DRAFT')
          AND uc.status NOT IN ('In Portfolio','Closed','Rejected','Returned to BDM')
          AND (uc.current_step >= 11
               OR EXISTS (SELECT 1 FROM underwriting_steps s
                           WHERE s.underwriting_case_id = uc.underwriting_case_id AND s.step_no = 10
                             AND s.status IN ('Completed','Approved','Skipped')))`, [r[0].id]);
  },
  async down() { /* data correction only */ },
};
