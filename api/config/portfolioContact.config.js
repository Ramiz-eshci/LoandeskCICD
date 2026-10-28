'use strict';

/**
 * Portfolio contact-schedule configuration.
 * Default milestones = months after loan start when the portfolio manager
 * should contact the client (per the portfolio email: 3, 6, 9, 10, 11, 12).
 * Monthly-serviced loans (repayments every month) get a monthly cadence.
 */
module.exports = {
  DEFAULT_MILESTONE_MONTHS: [3, 6, 9, 10, 11, 12],
  MATCH_WINDOW_DAYS: 20, // a contact log within ±N days of a milestone marks it done
  OVERDUE_GRACE_DAYS: 3, // milestone is Overdue once this many days past due with no contact
  PROMPT_LOOKAHEAD_DAYS: 7, // notify the PM this many days before a milestone is due
};
