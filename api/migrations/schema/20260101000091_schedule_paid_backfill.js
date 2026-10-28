'use strict';

/**
 * Migration: mark repayment instalments Paid from the payments already recorded
 * (client 27-10-2026). Instalments were never marked Paid, so every facility showed a
 * Payment due on the Portfolio Today tab. Payments are applied to the instalments in
 * order: Paid once the running total due is covered, else Due - the same rule
 * portfolio.service syncSchedule() applies on every new payment.
 * Data only + idempotent.
 */
module.exports = {
  async up(db) {
    await db.raw(`
      WITH paid AS (SELECT loan_id, SUM(amount) AS amt FROM loan_payments WHERE flag_deleted = 0 GROUP BY loan_id),
      s AS (
        SELECT ls.status, ls.loan_id,
               SUM(ls.total_due) OVER (PARTITION BY ls.loan_id ORDER BY ls.installment_no ROWS UNBOUNDED PRECEDING) AS cum
          FROM loan_schedules ls
         WHERE ls.flag_deleted = 0 AND ls.status IN ('Due', 'Paid'))
      UPDATE s SET status = CASE WHEN s.cum <= ISNULL((SELECT p.amt FROM paid p WHERE p.loan_id = s.loan_id), 0) + 0.005 THEN 'Paid' ELSE 'Due' END;
    `);
  },
  async down(db) {
    await db.raw(`UPDATE loan_schedules SET status = 'Due' WHERE status = 'Paid';`);
  },
};
