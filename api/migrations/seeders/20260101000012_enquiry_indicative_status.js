'use strict';

/**
 * Add the INDICATIVE_SENT enquiry status (between the working stages and
 * QUALIFIED = "Offer Sent") and re-order the later statuses. Idempotent.
 */
const AFTER = [
  { code: 'INDICATIVE_SENT', name: 'Indicative Sent', sort_order: 6, is_terminal: 0 },
  { code: 'QUALIFIED', name: 'Offer Sent', sort_order: 7, is_terminal: 0 },
  { code: 'OFFER_ACCEPTED', name: 'Offer Accepted', sort_order: 8, is_terminal: 0 },
  { code: 'CONVERTED', name: 'Converted', sort_order: 9, is_terminal: 1 },
  { code: 'LOST', name: 'Declined', sort_order: 10, is_terminal: 1 },
  { code: 'CLOSED', name: 'Closed', sort_order: 11, is_terminal: 1 },
];

module.exports = {
  async run(db) {
    for (const s of AFTER) {
      await db.query(
        `IF NOT EXISTS (SELECT 1 FROM enquiry_statuses WHERE code = @p0)
           INSERT INTO enquiry_statuses (code, name, sort_order, is_terminal)
           VALUES (@p0, @p1, @p2, @p3);`,
        [s.code, s.name, s.sort_order, s.is_terminal],
      );
      await db.query(
        `UPDATE enquiry_statuses SET name = @p1, sort_order = @p2, is_terminal = @p3 WHERE code = @p0;`,
        [s.code, s.name, s.sort_order, s.is_terminal],
      );
    }
  },
};
