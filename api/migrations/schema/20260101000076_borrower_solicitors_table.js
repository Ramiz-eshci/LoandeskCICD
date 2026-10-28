'use strict';

/**
 * Migration: make sure the Borrower's Solicitor master table exists (client 15-10-2026).
 * 075 first shipped as "solicitors.address + enquiries.borrower_solicitor_id"; databases
 * that ran that early version have 075 recorded as applied, so its later
 * borrower_solicitors table never got created ("Invalid object name 'borrower_solicitors'").
 * This re-runs the same idempotent DDL. Safe on a DB where 075 already created everything.
 */
const m075 = require('./20260101000075_borrower_solicitor_master');

module.exports = {
  async up(db) { await m075.up(db); },
  // Nothing of its own to undo - 075's down() drops the table / column.
  async down() {},
};
