'use strict';

/**
 * Application module (Module-5) configuration — single source of truth for
 * server-side field validation, the RBAC module key, and the list search/sort
 * whitelist. Mirrors config/enquiry.config.js.
 *
 * Field `type` drives coercion + validation in application.service.validate():
 *   text | phone | email | int | decimal | date | select | longtext
 * Column identifiers here are trusted (never taken from the request).
 */

// `max` mirrors the REAL NVARCHAR width of each column; min/max on numbers keep
// a value inside both the SQL type and common sense. Without these the service
// validated shape but never size, so an over-long string reached SQL Server and
// came back as a raw truncation error naming the table and column.
const t = (name, required = false, max = 255) => ({ name, type: 'text', required, max });
const sel = (name, required = false) => ({ name, type: 'select', required });
const dec = (name, required = false) => ({ name, type: 'decimal', required });
const dt = (name, required = false) => ({ name, type: 'date', required });

/** Writable application columns (ref/status/audit are managed by the service). */
const FIELDS = [
  sel('branch_id'),
  sel('product_id'),
  sel('loan_purpose_id'),
  sel('application_source_id'),
  sel('broker_id'),
  sel('rate_id'),
  sel('repayment_frequency_id'),
  sel('assigned_to'),          // BDM
  sel('underwriter_id'),
  sel('credit_manager_id'),
  { name: 'amount_requested', type: 'decimal', min: 0, max: 999999999999 }, // gross loan
  { name: 'term_months', type: 'int', min: 1, max: 600 },
  dt('completion_date'),
  t('initial_offer_state', false, 40),
  t('initial_offer_note', false, 120),
  { name: 'sla_days', type: 'int', min: 0, max: 3650 },
  // carried over from the enquiry so the application can be edited on its own
  t('lead_source', false, 100),
  t('broker_name', false, 200),
  { name: 'summary', type: 'longtext', max: 4000 },
  dt('requested_completion_date'),
  // pricing / fee breakdown
  { name: 'net_advance', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'monthly_fee_pct', type: 'decimal', min: 0, max: 100 },
  { name: 'arrangement_fee_pct', type: 'decimal', min: 0, max: 100 },
  { name: 'exit_fee', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'doc_fee', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'rolled_interest', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'gross_redemption', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'irr_pct', type: 'decimal', min: 0, max: 100 },
  { name: 'ltv_pct', type: 'decimal', min: 0, max: 100 },
  // broker fee allocation
  { name: 'loandesk_broker_fee_pct', type: 'decimal', min: 0, max: 100 },
  { name: 'borrower_broker_fee', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'introducer_fee', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'lender_income', type: 'decimal', min: 0, max: 999999999999 },
  // KYC / AML / PEP screening summary
  t('kyc_identity_status'),
  t('kyc_aml_status'),
  t('kyc_pep_status'),
  t('kyc_overall_status'),
];

/**
 * Application status lifecycle (mirror seeder 20260101000003 / master_data,
 * ordered to match the Figma stage chips). Codes are the master `code`.
 */
const STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDERWRITING: 'UNDERWRITING',
  CREDIT_REVIEW: 'CREDIT_REVIEW',
  APPROVED: 'APPROVED',
  LEGAL: 'LEGAL',
  COMPLETED: 'COMPLETED',
  DECLINED: 'DECLINED',
};

/** Forward-only pipeline; DECLINED reachable from any active stage. */
const TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'DECLINED'],
  SUBMITTED: ['UNDERWRITING', 'DRAFT', 'DECLINED'],        // accept / return-to-BDM / reject
  // Client 15-10-2026: Credit Review and Legal are no longer application stages - the
  // credit committee is a step inside underwriting, so Underwriting -> Approved -> Completed.
  // CREDIT_REVIEW / LEGAL stay only so a legacy row can still move on.
  UNDERWRITING: ['APPROVED', 'SUBMITTED', 'DECLINED'], // forward / revert / reject
  CREDIT_REVIEW: ['APPROVED', 'UNDERWRITING', 'DECLINED'],
  APPROVED: ['COMPLETED', 'UNDERWRITING', 'DECLINED'],
  LEGAL: ['COMPLETED', 'APPROVED', 'DECLINED'],
  COMPLETED: [],
  DECLINED: [],
};

/** Map a status code to the front-end stage key used by the listing chips. */
const STAGE_OF = {
  DRAFT: 'awaiting-review',     // "Awaiting Initial Review" - its own chip (client 15-10-2026)
  // Client 16-10-2026: no Submitted chip any more - a submitted case waits in the
  // underwriting queue, so it counts under Underwriting.
  SUBMITTED: 'underwriting',
  UNDERWRITING: 'underwriting',
  CREDIT_REVIEW: 'underwriting', // retired stage (client 15-10-2026) - shown under Underwriting
  APPROVED: 'approved',
  LEGAL: 'approved',             // retired stage (client 15-10-2026) - shown under Approved
  COMPLETED: 'completed',
  DECLINED: 'declined',
  REJECTED: 'declined',
  WITHDRAWN: 'declined',
};

/** Stages at which the case is locked for content edits (fields/notes/tasks/comms/docs).
 *  Status MOVES are still governed by TRANSITIONS; this only blocks editing. */
const LOCKED_STATUSES = ['APPROVED', 'LEGAL', 'COMPLETED', 'DECLINED'];

/**
 * The enquiry's borrower block, on the application's own applicant record.
 *
 * These are the application's working copy, NOT a view of the enquiry: the
 * enquiry is the original record of what was asked for and must stay frozen
 * once converted (offer letters and PDFs already went out against it), while a
 * borrower's name or contact details may legitimately be corrected afterwards.
 *
 * `applicant_name` is accepted as a convenience and split across
 * first_name / last_name by the service - the UI shows one box.
 */
const APPLICANT_FIELDS = [
  sel('applicant_type_id'),
  // widths match dbo.applicants
  t('first_name', false, 100),
  t('last_name', false, 100),
  t('company_name', false, 200),
  t('company_reg_no', false, 50),
  { name: 'email', type: 'email', max: 150 },
  { name: 'phone', type: 'phone', max: 30 },
  dt('dob'),
];

/** The enquiry's property / security block, on application_security. */
const SECURITY_FIELDS = [
  // widths match dbo.application_security (see migration 031)
  t('property_address', false, 255),
  t('postcode', false, 20),
  t('property_type', false, 60),
  t('tenure', false, 30),
  { name: 'tenure_years', type: 'int', min: 0, max: 999 },
  t('charge_type', false, 40),
  { name: 'estimated_value', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'gdv', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'owns_property', type: 'bool' },
  { name: 'purchase_price', type: 'decimal', min: 0, max: 999999999999 },
  dt('purchase_date'),
  { name: 'outstanding_loan', type: 'decimal', min: 0, max: 999999999999 },
  { name: 'repaid_on_completion', type: 'bool' },
  t('lender', false, 150),
  t('added_value', false, 500),
];

module.exports = {
  TABLE: 'applications',
  PK: 'application_id',
  REF_PREFIX: 'APP',
  MODULE_KEY: 'APPLICATIONS.APPLICATION_LIST',
  SEARCH: ['application_ref'],
  SORTABLE: ['application_id', 'application_ref', 'amount_requested', 'created_at', 'submitted_at'],
  FIELDS,
  APPLICANT_FIELDS,
  SECURITY_FIELDS,
  STATUS,
  TRANSITIONS,
  STAGE_OF,
  LOCKED_STATUSES,
};
