'use strict';

/**
 * Classify an applicant type into the two dimensions that drive the offer
 * letter template (client 09-10-2026). The applicant-type master now carries
 * four combined types — Scotland / England+Wales × Individual / Limited
 * Companies — so a single flag no longer tells us "company?" or "which
 * jurisdiction?". This reads either the master NAME or the CODE and returns
 * both. Legacy 'Individual' / 'Company' rows still classify correctly.
 *
 *   isCompany : true for any company / limited-company type
 *   region    : 'SCOTLAND' or 'EW' (England/Wales; the default)
 */
function classifyApplicantType(typeNameOrCode) {
  const s = String(typeNameOrCode || '').trim().toLowerCase();
  const isCompany = /compan|limited|ltd|corporate/.test(s);
  const isScotland = /scot/.test(s);
  return { isCompany, region: isScotland ? 'SCOTLAND' : 'EW' };
}

module.exports = { classifyApplicantType };
