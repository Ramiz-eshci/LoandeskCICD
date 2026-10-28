'use strict';

/**
 * Migration: solicitors.sra_partners (+ re-check the 079 columns) - client 15-10-2026.
 * solicitors.sra_partners was added to 079 AFTER 079 had already been run on some
 * databases, so it was never created there and "Number of SRA Partners" did not save.
 * Re-runs 079's idempotent DDL (every column guarded by IF COL_LENGTH ... IS NULL).
 */
const m079 = require('./20260101000079_app_form_broker_loan_sol_fields');

module.exports = {
  async up(db) { await m079.up(db); },
  // Nothing of its own to undo - 079's down() drops the columns.
  async down() {},
};
