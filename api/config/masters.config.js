'use strict';

/**
 * Master registry (single source of truth for the generic master CRUD).
 * key -> { table, pk, unique, label, search, columns }.
 * Field types drive server-side validation:
 *   code    - alphanumeric + _ - (no spaces/special)
 *   text    - letters/digits/space + . , & / ' ( ) - (no other special chars)
 *   phone   - digits + spaces + ( ) - +
 *   email   - email
 *   int     - whole number
 *   decimal - number (allows fractions)
 *   date    - date string
 *   bool    - boolean
 *   select  - FK id; `ref` = { master, valueCol, labelCol } (options from /api/masters/<master>)
 */

const c = (name, required = true) => ({ name, type: 'code', required });
const tx = (name, required = false) => ({ name, type: 'text', required });
const int = (name, required = false) => ({ name, type: 'int', required });
const dec = (name, required = false) => ({ name, type: 'decimal', required });

module.exports = {
  branch: {
    table: 'branches', pk: 'branch_id', unique: 'branch_code', label: 'Branch',
    search: ['branch_code', 'branch_name', 'city'],
    columns: [
      c('branch_code'), tx('branch_name', true), tx('address'), tx('city'), tx('state'),
      tx('postcode'), { name: 'phone', type: 'phone' }, { name: 'email', type: 'email' },
    ],
  },
  product: {
    table: 'products', pk: 'product_id', unique: 'code', label: 'Product',
    search: ['code', 'name'],
    columns: [
      c('code'), tx('name', true), tx('description'),
    ],
  },
  'loan-purpose': { table: 'loan_purposes', pk: 'loan_purpose_id', unique: 'code', label: 'Loan Purpose', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  'applicant-type': { table: 'applicant_types', pk: 'applicant_type_id', unique: 'code', label: 'Applicant Type', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  'lead-source': { table: 'lead_sources', pk: 'lead_source_id', unique: 'code', label: 'Lead Source', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  'application-status': {
    table: 'application_statuses', pk: 'application_status_id', unique: 'code', label: 'Application Status', search: ['code', 'name'],
    columns: [c('code'), tx('name', true), int('sort_order'), { name: 'is_terminal', type: 'bool' }],
  },
  'enquiry-status': {
    table: 'enquiry_statuses', pk: 'enquiry_status_id', unique: 'code', label: 'Enquiry Status', search: ['code', 'name'],
    columns: [c('code'), tx('name', true), int('sort_order'), { name: 'is_terminal', type: 'bool' }],
  },
  'document-type': { table: 'document_types', pk: 'document_type_id', unique: 'code', label: 'Document Type', search: ['code', 'name', 'category'], columns: [c('code'), tx('name', true), tx('category')] },
  'valuation-type': { table: 'valuation_types', pk: 'valuation_type_id', unique: 'code', label: 'Valuation Type', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  broker: {
    // uniqueAlso: extra columns that must not repeat. Unlike `unique` this is
    // still checked when the code is auto-generated, which is why duplicate
    // broker emails were getting through.
    // Client 06-10-2026: COMPANY is the broker's unique key; name & email may repeat.
    table: 'brokers', pk: 'broker_id', unique: 'code', uniqueAlso: ['company'], label: 'Broker', search: ['code', 'name', 'company'],
    columns: [c('code'), tx('name', true), tx('company', true), { name: 'email', type: 'email' }, { name: 'phone', type: 'phone' }, dec('commission_pct'),
      // Client 15-10-2026: application form section 1 (Introducer Details).
      tx('address'), tx('fca_number')],
  },
  solicitor: {
    table: 'solicitors', pk: 'solicitor_id', unique: 'code', label: 'Solicitor', search: ['code', 'name', 'firm'],
    columns: [c('code'), tx('name', true), tx('firm'), { name: 'email', type: 'email' }, { name: 'phone', type: 'phone' },
      int('sra_partners')], // client 15-10-2026: application form section 5
  },
  // Borrower's solicitor picked on the New Enquiry popup (client 15-10-2026) - the 5 fields
  // of section 5 of the application form. Firm name is the unique key.
  'borrower-solicitor': {
    // Firm name AND email must not repeat (client 15-10-2026); a blank email is not checked.
    table: 'borrower_solicitors', pk: 'borrower_solicitor_id', unique: 'code', uniqueAlso: ['firm_name', 'email'], label: "Borrower's Solicitor",
    search: ['code', 'firm_name', 'contact_name', 'email'],
    columns: [c('code'), tx('firm_name', true), tx('contact_name'), tx('address'), { name: 'telephone', type: 'phone' }, { name: 'email', type: 'email' },
      int('sra_partners'), // client 15-10-2026: application form section 5
      tx('sra_no')], // client 16-10-2026: shown on the underwriting Solicitor Quote step
  },
  'valuer-firm': {
    table: 'valuer_firms', pk: 'valuer_firm_id', unique: 'code', label: 'Valuer Firm', search: ['code', 'name', 'firm'],
    columns: [c('code'), tx('name', true), tx('firm'), { name: 'email', type: 'email' }, { name: 'phone', type: 'phone' }],
  },
  // KYC checks the underwriter must run, typed per applicant type (client 07-10-2026).
  // Replaces the old "KYC Team" assignment master.
  'kyc-check': {
    table: 'kyc_check_items', pk: 'kyc_check_item_id', unique: 'code', label: 'KYC Check', search: ['code', 'name'],
    columns: [
      c('code'),
      { name: 'applicant_type_id', type: 'select', required: true, ref: { master: 'applicant-type', valueCol: 'applicant_type_id', labelCol: 'name' } },
      tx('name', true), int('sort_order'),
    ],
  },
  // Checks run on the borrower's solicitor (single rep) — client 07-10-2026.
  'solicitor-check': {
    table: 'solicitor_check_items', pk: 'solicitor_check_item_id', unique: 'code', label: 'Solicitor Check', search: ['code', 'name'],
    columns: [c('code'), tx('name', true), int('sort_order')],
  },
  // Solicitor Quote "Additional costs" names (client 16-10-2026) - a dropdown, so the
  // extra costs can be reported by type instead of free-typed text.
  'solicitor-cost-type': {
    table: 'solicitor_cost_types', pk: 'solicitor_cost_type_id', unique: 'code', uniqueAlso: ['name'], label: 'Solicitor Cost Type', search: ['code', 'name'],
    columns: [c('code'), tx('name', true), int('sort_order')],
  },
  roi: {
    table: 'interest_rates', pk: 'rate_id', unique: 'name', label: 'ROI Configuration', search: ['name', 'rate_type'],
    columns: [
      { name: 'product_id', type: 'select', ref: { master: 'product', valueCol: 'product_id', labelCol: 'name' } },
      tx('name', true), dec('rate_pct', true), tx('rate_type'),
      { name: 'effective_from', type: 'date' }, { name: 'effective_to', type: 'date' },
    ],
  },
  'repayment-frequency': { table: 'repayment_frequencies', pk: 'repayment_frequency_id', unique: 'code', label: 'Repayment Frequency', search: ['code', 'name'], columns: [c('code'), tx('name', true), int('payments_per_year', true)] },
  'source-type': { table: 'application_sources', pk: 'application_source_id', unique: 'code', label: 'Source Type', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  'contact-method': { table: 'contact_methods', pk: 'contact_method_id', unique: 'code', uniqueAlso: ['name'], label: 'Contact Method', search: ['code', 'name'], columns: [c('code'), tx('name', true), int('sort_order')] },
  'followup-status': { table: 'followup_statuses', pk: 'followup_status_id', unique: 'code', uniqueAlso: ['name'], label: 'Followup Status', search: ['code', 'name'], columns: [c('code'), tx('name', true), int('sort_order')] },
  'contact-outcome': { table: 'contact_outcomes', pk: 'contact_outcome_id', unique: 'code', uniqueAlso: ['name'], label: 'Contact Outcome', search: ['code', 'name'], columns: [c('code'), tx('name', true), int('sort_order')] },
  'rejection-reason': { table: 'rejection_reasons', pk: 'rejection_reason_id', unique: 'code', label: 'Rejection Reason', search: ['code', 'name'], columns: [c('code'), tx('name', true)] },
  // Enquiry > Decline popup reasons (client 29-09-2026).
  'decline-reason': { table: 'decline_reasons', pk: 'decline_reason_id', unique: 'code', uniqueAlso: ['name'], label: 'Decline Reason', search: ['code', 'name'], columns: [c('code'), tx('name', true), int('sort_order')] },
  'approval-condition': { table: 'approval_conditions', pk: 'approval_condition_id', unique: 'code', label: 'Approval Condition', search: ['code', 'name'], columns: [c('code'), tx('name', true), tx('description')] },
};

/* ------------------------------------------------------------------ *
 * Auto-generated business code (prefix + running number, e.g. BRN-0001)
 * One unique prefix per master; counter runs per master, resets nowhere.
 * roi (unique 'name') is excluded
 * on purpose — it has no dedicated code column.
 * ------------------------------------------------------------------ */
const CODE_PREFIX = {
  branch: 'BRN', product: 'PRD', 'loan-purpose': 'LPU',
  'applicant-type': 'APT', 'lead-source': 'LSR', 'application-status': 'AST',
  'enquiry-status': 'EST', 'document-type': 'DTY', 'valuation-type': 'VTY',
  broker: 'BRK', solicitor: 'SOL', 'borrower-solicitor': 'BSL', 'valuer-firm': 'VLR', 'repayment-frequency': 'RPF',
  'source-type': 'ASR', 'contact-method': 'CMT', 'followup-status': 'FST',
  'contact-outcome': 'COU', 'rejection-reason': 'RJR', 'approval-condition': 'APC', 'kyc-team': 'KYC',
  'decline-reason': 'DCR', 'solicitor-cost-type': 'SCT',
};
for (const [key, prefix] of Object.entries(CODE_PREFIX)) {
  const cfg = module.exports[key];
  if (cfg && cfg.unique) cfg.autoCode = { field: cfg.unique, prefix };
}
