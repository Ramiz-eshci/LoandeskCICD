'use strict';

/**
 * Seeder: default values for the contact-log lookup masters.
 * Idempotent (guarded by unique code). Follow-up statuses include the
 * call-disposition set requested for the portfolio contact log (CL6):
 * Ringing, Connected, Busy, Not Reachable — alongside the workflow states.
 */

const METHODS = [
  ['PHONE', 'Phone', 1],
  ['EMAIL', 'Email', 2],
  ['SMS', 'SMS', 3],
  ['MEETING', 'Meeting', 4],
  ['LETTER', 'Letter', 5],
];

const FOLLOWUP_STATUSES = [
  ['PENDING', 'Pending', 1],
  ['RINGING', 'Ringing', 2],
  ['CONNECTED', 'Connected', 3],
  ['BUSY', 'Busy', 4],
  ['NOT_REACHABLE', 'Not Reachable', 5],
  ['DONE', 'Done', 6],
  ['OVERDUE', 'Overdue', 7],
  ['SKIPPED', 'Skipped', 8],
];

const OUTCOMES = [
  ['CONTACTED', 'Contacted', 1],
  ['NO_ANSWER', 'No Answer', 2],
  ['PROMISE_TO_PAY', 'Promise to Pay', 3],
  ['PAID', 'Paid', 4],
  ['LEFT_MESSAGE', 'Left Message', 5],
  ['ESCALATED', 'Escalated', 6],
];

async function seed(db, table, pk, rows) {
  for (const [code, name, sort] of rows) {
    await db.query(
      `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE code=@p0)
         INSERT INTO ${table} (code, name, sort_order) VALUES (@p0, @p1, @p2);`,
      [code, name, sort],
    );
  }
}

module.exports = {
  async run(db) {
    await seed(db, 'contact_methods', 'contact_method_id', METHODS);
    await seed(db, 'followup_statuses', 'followup_status_id', FOLLOWUP_STATUSES);
    await seed(db, 'contact_outcomes', 'contact_outcome_id', OUTCOMES);
  },
};
