'use strict';

/**
 * Enquiry module (Module-4) configuration — the single source of truth for
 * server-side field validation and the CONFIGURABLE "convert to application"
 * rule set. Controllers/services read this; nothing is hardcoded in handlers.
 *
 * Field `type` drives coercion + validation in enquiry.service.validate():
 *   code | text | phone | email | int | decimal | date | select | longtext
 *
 * Column identifiers here are trusted (never taken from the request), matching
 * the masters.config.js pattern.
 */

const t = (name, required = false, max = 255) => ({ name, type: 'text', required, max });
const sel = (name, required = false) => ({ name, type: 'select', required });
// notFuture: the value may not be later than today (validated in enquiry.service).
const dt = (name, required = false, notFuture = false) => ({ name, type: 'date', required, notFuture });

/** Writable enquiry columns (status/ref/audit are managed by the service). */
/**
 * `max` mirrors the REAL NVARCHAR width of each column in dbo.enquiries, and
 * `min`/`max` on numbers keep a value inside both the SQL type and common sense.
 *
 * Without these the service validated shape but never size: a 40-character
 * phone number passed the phone regex and reached NVARCHAR(30), where SQL
 * Server aborted the insert with "String or binary data would be truncated".
 * That surfaced to the user as a raw database error naming the table and
 * column - a leak of the schema as well as a bad experience.
 *
 * Keep these in step with the migrations whenever a column is widened.
 */
/**
 * `required: true`  -> enforced on EVERY create path (staff form + public
 *                      website intake). Used for the bare minimum an enquiry
 *                      cannot exist without (email, loan purpose).
 * `staffRequired`    -> enforced ONLY for manual/staff creation (the New
 *                      Enquiry drawer), so it mirrors the `*` fields on that
 *                      Angular form without forcing the lighter public intake
 *                      to supply branch/product/amount/term/property.
 */
const FIELDS = [
  sel('applicant_type_id'),
  t('applicant_name', false, 200),
  t('company_name', false, 200),
  { name: 'company_reg_no', type: 'text', max: 50 },
  // Borrower email is NOT required on the staff form (client 25-09-2026: often the
  // borrower is not known yet, e.g. broker enquiries). The website / email
  // intakes still need it, so it stays required for every non-staff path.
  { name: 'email', type: 'email', required: false, publicRequired: true, max: 150 },
  { name: 'phone', type: 'phone', max: 30 },
  { name: 'branch_id', type: 'select', staffRequired: true },   // Step 1 — Branch (required on staff form)
  { name: 'product_id', type: 'select', staffRequired: true },   // Step 3 — Product (required on staff form)
  // Staff-only: the email / website intakes cannot pick a loan_purposes id, and
  // requiring it on every path rejected every inbound email enquiry.
  { name: 'loan_purpose_id', type: 'select', staffRequired: true },
  sel('application_source_id'),   // Step 1 — Source Type
  { name: 'lead_source', type: 'text', max: 100 },
  { name: 'lead_source_id', type: 'select' }, // Step 1 — Lead Source
  sel('broker_id'),
  t('broker_name', false, 200),   // Step 1 — Broker / Introducer (free text)
  dt('dob', false, true),                      // Step 2 — Date of Birth (not in the future)
  // Client 15-10-2026: a requested completion is normally a FUTURE date - the old
  // not-in-the-future rule blocked every real date, so it was always left blank.
  dt('requested_completion_date', false, false),// Step 3 — Requested Completion
  { name: 'amount_requested', type: 'decimal', min: 0, max: 999999999999, staffRequired: true }, // Step 3 — loan amount (gross or net, see loan_basis)
  { name: 'loan_basis', type: 'text', max: 10 }, // Step 3 — 'Gross' | 'Net'; drives the Est. LTV label
  { name: 'term_months', type: 'int', min: 1, max: 600, staffRequired: true }, // Step 3 — Term; 50 years is already generous
  { name: 'interest_type', type: 'text', max: 20 }, // Step 3 — Interest financing type (Serviced/Retained/Rolled Up)
  { name: 'drawdowns_required', type: 'bool' }, // Step 3 — Drawdowns required? (rows stored as JSON in `drawdowns`)
  // ---- Step 3: application form section 2 "Loan Details" (client 15-10-2026) ----
  // Exit Strategy reuses `exit_strategy` (credit-paper narrative) below.
  { name: 'total_project_cost', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'deposit_source', type: 'longtext', max: 500 },
  { name: 'own_contribution', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'additional_borrowing', type: 'bool' },
  // ---- Step 3: solicitor representation (client 15-10-2026) ----
  // 'single' -> borrower has their own solicitor (borrower_sol_*); 'dual' -> ours acts for both.
  { name: 'rep_type', type: 'text', max: 10 },
  sel('borrower_solicitor_id'), // Solicitor master row (single rep); borrower_sol_* are filled from it
  { name: 'borrower_sol_firm', type: 'text', max: 200 },
  { name: 'borrower_sol_contact', type: 'text', max: 200 },
  { name: 'borrower_sol_address', type: 'longtext', max: 500 },
  { name: 'borrower_sol_telephone', type: 'phone', max: 30 },
  { name: 'borrower_sol_email', type: 'email', max: 150 },
  // ---- Step 3: credit paper narrative, all optional (client 15-10-2026) ----
  { name: 'deal_appraisal', type: 'longtext', max: 4000 },
  { name: 'exit_strategy', type: 'longtext', max: 4000 },
  { name: 'risk_mitigants', type: 'longtext', max: 4000 },
  { name: 'credit_recommendation', type: 'longtext', max: 4000 },
  { name: 'property_address', type: 'text', required: false, staffRequired: true, max: 255 }, // Step 4 — Property address
  { name: 'estimated_value', type: 'decimal', min: 0, max: 999999999999, staffRequired: true }, // Security — Current Value (required on staff New Enquiry form, client 09-10-2026)
  // ---- Step 4: Security / Property (client PDF section 3) ----
  { name: 'postcode', type: 'text', max: 20 },
  { name: 'property_type', type: 'text', max: 80 },
  // Client 26-10-2026: Type of Deal - 'Residential' | 'Commercial' | 'Mixed' (normalised in enquiry.service).
  { name: 'deal_type', type: 'text', max: 20 },
  { name: 'tenure', type: 'text', max: 20 },     // Freehold / Leasehold
  { name: 'tenure_years', type: 'int', min: 0, max: 999 }, // remaining lease years
  { name: 'charge_type', type: 'text', max: 20 }, // 1st / 2nd
  { name: 'charge_amount', type: 'decimal', min: 0, max: 999999999999 }, // only when charge_type = 2nd
  { name: 'gdv', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'owns_property', type: 'bool' },
  { name: 'purchase_price', type: 'decimal', min: 0, max: 999999999999 },
  dt('purchase_date'),
  { name: 'outstanding_loan', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'repaid_on_completion', type: 'bool' },
  { name: 'lender', type: 'text', max: 150 },
  { name: 'added_value', type: 'longtext', max: 4000 },
  { name: 'map_link', type: 'text', max: 1000 }, // Step 4 / Security tab — Google Maps link (checked in enquiry.service)
  sel('assigned_to'),
  { name: 'summary', type: 'longtext', max: 4000 },
];

/**
 * CONVERT rule set (Module-4 point 6). Each rule is checked before an enquiry
 * may become an application. `field` is the enquiry column; `label` is shown to
 * the user; `check` (optional) is a custom predicate, else "not null/empty".
 * Edit this array to change conversion requirements — no code change needed.
 */
// Primary applicant / director carried into the application on convert: the is_primary
// row, else the first. Convert stores THIS row as the application's Primary applicant.
const primaryApplicant = (e) => {
  const list = Array.isArray(e.applicants) ? e.applicants : [];
  return list.find((a) => a && (a.is_primary === 1 || a.is_primary === true)) || list[0] || null;
};
const nonEmpty = (v) => !!(v !== null && v !== undefined && String(v).trim() !== '');
// Name/email may live on the enquiry itself OR, for a company with directors (and for
// individual enquiries whose contact is captured as an applicant row), on the primary
// director. Checking both makes the convert validation consistent in every enquiry status,
// instead of only passing when the enquiry-level email happens to be set (client 02-10-2026).
const hasApplicantName = (e) => nonEmpty(e.applicant_name) || nonEmpty(e.company_name)
  || nonEmpty(primaryApplicant(e) && primaryApplicant(e).full_name);
const hasApplicantEmail = (e) => nonEmpty(e.email)
  || nonEmpty(primaryApplicant(e) && primaryApplicant(e).email);
// Client 06-10-2026: the applicant email is NOT required to convert when a broker
// (with an email) is on the enquiry - the correspondence goes to the broker. Block
// conversion only when there is neither an applicant email nor a broker email.
const hasBrokerEmail = (e) => nonEmpty(e.broker_id) && nonEmpty(e.broker_email);
const hasContactEmail = (e) => hasApplicantEmail(e) || hasBrokerEmail(e);

const CONVERT_RULES = [
  { field: 'applicant_name', label: 'Applicant name', check: hasApplicantName },
  { field: 'email', label: 'Applicant email (or a broker with an email)', check: hasContactEmail },
  { field: 'amount_requested', label: 'Requested amount', check: (e) => Number(e.amount_requested) > 0 },
  { field: 'loan_purpose_id', label: 'Loan purpose' },
  { field: 'product_id', label: 'Product' },
  { field: 'branch_id', label: 'Branch' },
  { field: 'assigned_to', label: 'Assigned BDM' },
];

/**
 * OFFER rule set — fields required before an indicative offer may be SENT
 * (status -> Offer Sent / QUALIFIED). Lighter than CONVERT_RULES.
 */
const OFFER_RULES = [
  { field: 'amount_requested', label: 'Requested amount', check: (e) => Number(e.amount_requested) > 0 },
  { field: 'loan_purpose_id', label: 'Loan purpose' },
  { field: 'product_id', label: 'Product' },
];

/**
 * Default fee / rate parameters for indicative & offer calculations. Editable
 * here without code change; each is overridable per-enquiry from the popup inputs.
 */
const OFFER_DEFAULTS = {
  monthly_rate_pct: 1.05,        // discounted serviced/retained rate, % per month
  nominal_default_rate_pct: 4,   // default rate if terms breached
  arrangement_fee_pct: 2,        // % of total gross loan incl DDs
  document_fee: 1000,            // GBP flat
  broker_fee: 0,                 // GBP, or % if broker_fee_is_pct
  default_term_months: 12,
  min_term_months: 3,
  retained_months: 12,           // months used for "Retained Interest Total" (STILL PROVISIONAL)
  retained_months_day1: 9,       // months retained on day 1 - reconciles the client sample exactly
  offer_validity_days: 7,
  max_ltv_pct: 75,               // default max LTV guardrail
  // Serviced monthly interest: monthly% -> annual% (compounded) per the client's
  // "Calc monthly serviced" card. Monthly interest = gross x annual% / 12.
  serviced_rate_card: { '1.05': 14.4, '1.15': 16, '1.25': 17.6, '15.00': 21.95 },

  /**
   * Base for the day-1 net release.
   *   'max_ltv' - day1_net = max_ltv - day1_total_deductions   <- matches the client sample
   *   'gross'   - day1_net = gross_loan - day1_total_deductions (the old assumption)
   * Verified against the client's table (property 110,000 / GDV 200,000 / gross 104,334):
   *   retained_day1 = 82,500 x 1.05% x 9      = 7,796.25   (table 7,796)
   *   day1_deductions = 2,086.68+1,000+0+7,796.25 = 10,882.93 (table 10,883)
   *   day1_net = 82,500 - 10,882.93           = 71,617.07  (table 71,617.07) EXACT
   * Flip to 'gross' if the client later says otherwise - no code change needed.
   */
  net_basis: 'max_ltv',
};

module.exports = {
  TABLE: 'enquiries',
  PK: 'enquiry_id',
  REF_PREFIX: 'ENQ',
  MODULE_KEY: 'ENQUIRIES.ENQUIRY_LIST',
  SEARCH: ['enquiry_ref', 'applicant_name', 'company_name', 'email', 'phone'],
  SORTABLE: ['enquiry_id', 'enquiry_ref', 'applicant_name', 'amount_requested', 'created_at'],
  FIELDS,
  CONVERT_RULES,
  OFFER_RULES,
  OFFER_DEFAULTS,
};
