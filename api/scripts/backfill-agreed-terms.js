'use strict';
/**
 * One-off (28-09-2026): fill fees, broker fee, drawdowns and other securities into
 * applications that were converted BEFORE convert started copying them.
 *
 *   node scripts/backfill-agreed-terms.js
 *
 * Only touches applications that came from an enquiry and have no agreed_terms yet,
 * so running it twice does nothing the second time. Existing fee values are kept
 * (it only fills blanks), except extra "other security" rows, which it adds.
 * Run `npm run migrate` first (adds applications.agreed_terms).
 */
require('dotenv').config();
const enquirySvc = require('../services/enquiry.service');

(async () => {
  const r = await enquirySvc.backfillAgreedTerms();
  console.log(`[backfill] checked ${r.checked}, updated ${r.updated}`); // eslint-disable-line no-console
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); }); // eslint-disable-line no-console
