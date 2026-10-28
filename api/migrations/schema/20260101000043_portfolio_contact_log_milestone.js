'use strict';

/**
 * Migration: link a portfolio contact log to a Contact Schedule milestone.
 * milestone_month = the milestone (months after loan start) the contact was logged
 * against from the facility Contacts tab. NULL = free log, matched by date window.
 */
module.exports = {
  async up(db) {
    await db.raw(`IF COL_LENGTH('dbo.portfolio_contact_logs','milestone_month') IS NULL
      ALTER TABLE dbo.portfolio_contact_logs ADD milestone_month INT NULL;`);
  },
  async down(db) {
    await db.raw(`IF COL_LENGTH('dbo.portfolio_contact_logs','milestone_month') IS NOT NULL
      ALTER TABLE dbo.portfolio_contact_logs DROP COLUMN milestone_month;`);
  },
};
