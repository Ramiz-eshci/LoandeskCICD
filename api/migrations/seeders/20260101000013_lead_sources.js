'use strict';

/** Seed Lead Source master with the previously hardcoded values. Idempotent by code. */
const ITEMS = [
  { code: 'BROKER_INTRO', name: 'Broker Introduction' },
  { code: 'WEBSITE', name: 'Website Enquiry' },
  { code: 'REFERRAL', name: 'Referral' },
  { code: 'PHONE', name: 'Phone Enquiry' },
  { code: 'REPEAT', name: 'Repeat Client' },
];
module.exports = {
  async run(db) {
    for (const it of ITEMS) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM lead_sources WHERE code = @p0)
           INSERT INTO lead_sources (code, name) VALUES (@p0, @p1);`,
        [it.code, it.name]);
    }
  },
};
