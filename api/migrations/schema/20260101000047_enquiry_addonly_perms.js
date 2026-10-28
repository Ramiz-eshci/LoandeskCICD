'use strict';

/**
 * Migration: Enquiries "Request Info" + "Send Indicative & Offer" are ADD only
 * (client 30-09-2026) - same work as seeder 20260101000062_enquiry_addonly_perms.js,
 * run here so a plain `npm run migrate` is enough. See the seeder for details. Idempotent.
 *
 * down() re-creates the removed permission rows (view / edit / delete on both, plus
 * OFFER reject / accept) so the columns come back; the grants that were deleted are
 * NOT restored - take a DB backup before running if you may need to roll back.
 */
const seeder = require('../seeders/20260101000062_enquiry_addonly_perms');

module.exports = {
  async up(db) {
    await seeder.run(db);
  },
  async down(db) {
    await db.raw(`
      MERGE permissions AS t
      USING (VALUES
        ('ENQUIRIES.REQUEST_INFO','view'),   ('ENQUIRIES.REQUEST_INFO','edit'),  ('ENQUIRIES.REQUEST_INFO','delete'),
        ('ENQUIRIES.OFFER','view'),          ('ENQUIRIES.OFFER','edit'),         ('ENQUIRIES.OFFER','delete'),
        ('ENQUIRIES.OFFER','reject'),        ('ENQUIRIES.OFFER','accept')
      ) AS s(module_key, permission_key)
        ON t.module_key = s.module_key AND LOWER(t.permission_key) = s.permission_key
      WHEN NOT MATCHED THEN
        INSERT (module_key, permission_key, description)
        VALUES (s.module_key, s.permission_key, s.permission_key + ' ' + s.module_key);`);
  },
};
