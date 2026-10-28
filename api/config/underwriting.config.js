'use strict';

/**
 * Underwriting workflow (Module-6) configuration — single source of truth for
 * the step model, the case/step state machines, and per-step role permissions.
 * Mirrors the Figma underwriting stepper (silver-march-... /underwriting).
 *
 * Steps are validated + gated on the BACKEND. The frontend renders from this
 * same shape (served via /meta) so UI and enforcement never drift.
 */

const MODULE_KEY = 'UNDERWRITING.CASE';

/*
 * Per-stage gating: each step carries `perm: [module_key, 'edit']` — one Roles
 * matrix row per stage under "Underwriting Stages" (UNDERWRITING_STAGES.*).
 *   view -> can open the stage and see its data
 *   edit -> can work the stage (save / complete / decide)
 * Step 1 (Initial Review) is the case acceptance -> UNDERWRITING.CASE.approve (was .accept).
 * `roles` is kept for display / default assignee only (baseline grants live in
 * seeder 20260101000046_underwriting_stages).
 */

/** Case-level lifecycle. */
const CASE_STATUS = {
  NEW_REVIEW: 'New Review',        // "New Application — Underwriter Review Required"
  IN_PROGRESS: 'In Progress',
  PENDING_INFO: 'Pending Information',
  READY: 'Ready to Proceed',
  SENT_TO_CREDIT: 'Sent to Credit',
  IN_PORTFOLIO: 'In Portfolio',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
  RETURNED_TO_BDM: 'Returned to BDM',  // sent back to BDM — not "closed" (client 07-10-2026)
  ON_HOLD: 'On Hold',                  // paused — excluded from pipeline numbers (client 07-10-2026)
};

/** Step-level status set (Figma: Done / Active / locked, + workflow states). */
const STEP_STATUS = {
  LOCKED: 'Locked',
  AVAILABLE: 'Available',
  IN_PROGRESS: 'In Progress',
  PENDING_INFO: 'Pending Information',
  QUERY: 'Query Raised',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

/**
 * The 8 steps + FINAL. `roles` = who may act (System Administrator always may).
 * `checklist` items are mandatory to COMPLETE the step (server-validated).
 * `decisions` where the step ends in a branch.
 */
const STEPS = [
  {
    no: 1, key: 'initial_review', name: 'Initial Review',
    hint: 'Accept the file, assign underwriter, review application completeness',
    roles: ['Underwriter'],
    perm: ['UNDERWRITING.CASE', 'approve'],
    checklist: [
      'Application completeness reviewed', 'All required documents received',
      'Applicant identity confirmed', 'Loan parameters within policy',
      'Initial underwriting email sent to broker', 'Case accepted and assigned',
    ],
    cta: 'Accept & Proceed to Valuation Instruction',
  },
  {
    no: 2, key: 'valuation_instruction', name: 'Valuation Instruction',
    formLabel: 'Valuation Instruction',
    hint: 'Choose AVM / desktop / full valuation and instruct',
    roles: ['Underwriter', 'Valuation User'],
    perm: ['UNDERWRITING_STAGES.VALUATION_INSTRUCTION', 'edit'],
    fields: [
      { key: 'valuation_type', label: 'Valuation Type', type: 'select', source: 'valuationTypes' },
      { key: 'valuer_firm', label: 'Surveyor / Valuer Firm', type: 'select', source: 'valuers' },
      { key: 'instruction_date', label: 'Instruction Date', type: 'date' },
      { key: 'report_due_date', label: 'Report Due Date', type: 'date' },
      { key: 'fee', label: 'Fee (£)', type: 'number' },
      { key: 'notes', label: 'Valuation Notes / Special Instructions', type: 'textarea' },
    ],
    cta: 'Proceed to Solicitor Quote',
  },
  {
    no: 3, key: 'kyc_aml', name: 'KYC / AML',
    formLabel: 'Assign KYC / AML',
    hint: 'Company KYC, director checks, AML, PEP and sanctions screening',
    roles: ['Underwriter'],
    perm: ['UNDERWRITING_STAGES.KYC_AML', 'edit'],
    checklist: [
      'Companies House search', 'AML / Sanctions screening', 'PEP check', 'Insolvency search',
      'Gazette search', 'Valid ID checked', 'Proof of address checked', 'Credit report (30 days)',
      'Adverse media search', 'Director Google search',
    ],
    decisions: ['approve', 'reject', 'raise_query'],
    fields: [
      // One KYC entry (client 28-09-2026: multiple entries per case, stored in fields.entries).
      { key: 'kyc_type', label: 'KYC Type', type: 'select', options: [
        'Companies House search', 'AML / Sanctions screening', 'PEP check', 'Insolvency search',
        'Gazette search', 'Valid ID checked', 'Proof of address checked', 'Credit report (30 days)',
        'Adverse media search', 'Director Google search'] },
      { key: 'assign_to', label: 'Assign To (KYC Team)', type: 'select', source: 'kycTeam' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    cta: 'Proceed to Underwrite & Findings',
  },
  {
    no: 4, key: 'solicitor_quote', name: 'Solicitor Quote',
    formLabel: 'Borrower Solicitor Checks',
    hint: 'Approach panel solicitor for a fee quote',
    roles: ['Underwriter', 'Solicitor'],
    perm: ['UNDERWRITING_STAGES.SOLICITOR_QUOTE', 'edit'],
    checklist: [
      'Google / firm and contact search complete', 'Regulator membership checked',
      'Two or more partners confirmed', 'PI cover requirement satisfied',
      'Solicitor fee quote received', 'Dual representation confirmed / N/A', 'Solicitor panel status confirmed',
    ],
    fields: [
      { key: 'firm_name', label: 'Firm Name', type: 'text' },
      { key: 'contact_name', label: 'Contact Name', type: 'text' },
      { key: 'sra_no', label: 'SRA / Regulator No.', type: 'text' },
      { key: 'lender_solicitor', label: 'Lender Solicitor', type: 'select', source: 'solicitors' },
      { key: 'quote_amount', label: 'Quote Amount (£)', type: 'number' },
      { key: 'quote_date', label: 'Quote Date', type: 'date' },
    ],
    cta: 'Proceed to KYC',
  },
  {
    no: 6, key: 'underwrite_findings', name: 'Underwrite & Findings',
    formLabel: 'Findings & Recommendation',
    hint: 'Review the file, complete all checks and document findings',
    roles: ['Underwriter', 'Credit'],
    perm: ['UNDERWRITING_STAGES.UNDERWRITE_FINDINGS', 'edit'],
    checklist: [
      'Credit file reviewed — no adverse findings', 'Background / adverse media clear',
      'Companies House review complete', 'Director / Guarantor KYC complete',
      'Title / security review complete', 'Valuation report reviewed and accepted', 'Introducer checks complete',
    ],
    fields: [
      { key: 'risk_finding', label: 'Risk / Finding', type: 'textarea' },
    ],
    recommendations: ['Proceed — no material concerns', 'Proceed with conditions', 'Refer to Credit for discussion', 'Cannot proceed'],
    recLabel: 'Recommendation',
    decisions: ['proceed', 'refer_credit'],
    cta: 'Happy to Proceed',
  },
  {
    no: 7, key: 'credit_discussion', name: 'Credit Discussion',
    formLabel: 'Credit Discussion',
    hint: 'Discuss derogatory information or low valuation with Credit',
    roles: ['Underwriter', 'Credit'],
    perm: ['UNDERWRITING_STAGES.UNDERWRITE_FINDINGS', 'edit'],
    fields: [
      { key: 'topic', label: 'Discussion Topic', type: 'select', options: ['Valuation below initial estimate', 'Derogatory credit information', 'Background / adverse media concern', 'LTV / policy exception', 'Other — see notes'] },
      { key: 'notes', label: 'Discussion Notes', type: 'textarea' },
      { key: 'credit_contact', label: 'Credit Contact', type: 'text' },
      { key: 'discussion_date', label: 'Discussion Date', type: 'date' },
    ],
    decisions: ['proceed', 'cannot_proceed'],
    cta: 'Happy to Proceed',
  },
  {
    no: 8, key: 'draft_legal', name: 'Draft Legal Documents & Credit Paper',
    formLabel: 'Credit Paper',
    hint: 'Prepare the Credit Paper (Credit Deal Summary) and draft the legal documents',
    roles: ['Underwriter', 'Legal'],
    perm: ['UNDERWRITING_STAGES.UNDERWRITE_FINDINGS', 'edit'],
    checklist: ['Credit paper prepared', 'Legal documents drafted'],
    /**
     * Credit Paper (Credit Deal Summary) — fields mirror the client's
     * "Credit Paper - Example.docx" one-for-one, in the document's own order.
     * Owned by the LEGAL team: filled from the Legal & Completion tab
     * (/api/legal/:id/credit-paper) and rendered read/write here too.
     */
    /**
     * Credit Paper (Credit Deal Summary) — DOCUMENT UPLOAD ONLY.
     * No manual data entry: the prepared credit paper is uploaded as a file.
     * Uploaded from here or from the Legal & Completion tab
     * (/api/legal/:id/credit-paper/documents) — both write the SAME
     * underwriting_documents rows for step 8, so neither side holds a copy.
     */
    creditPaper: true,
    filledBy: 'Legal',
    fields: [],
    photos: true,
    filesLabel: 'Credit Paper Document',
    cta: 'Confirm Credit Paper & Legal',
  },
  {
    no: 9, key: 'site_diligence', name: 'Site Visit & Solicitor Diligence',
    formLabel: 'Site Visit & Solicitor Diligence',
    hint: 'Site visit / video call, solicitor property diligence and client signing',
    roles: ['Underwriter', 'Solicitor'],
    perm: ['UNDERWRITING_STAGES.UNDERWRITE_FINDINGS', 'edit'],
    checklist: ['Site visit / video call completed', 'Solicitor property diligence complete', 'Client signed documents'],
    fields: [
      { key: 'visit_type', label: 'Visit Type', type: 'select', options: ['Site Visit', 'Video Call'] },
      { key: 'visit_date', label: 'Visit Date', type: 'date' },
      { key: 'diligence_notes', label: 'Solicitor Diligence Notes', type: 'textarea' },
      { key: 'docs_signed_date', label: 'Client Documents Signed Date', type: 'date' },
    ],
    photos: true,
    cta: 'Confirm Site Visit & Diligence',
  },
  {
    no: 10, key: 'credit_committee', name: 'Final Credit Committee',
    formLabel: 'Final Credit Committee',
    hint: 'Credit team holds the final credit committee prior to funding',
    roles: ['Credit', 'Credit Manager'],
    perm: ['UNDERWRITING_STAGES.CREDIT_COMMITTEE', 'edit'],
    fields: [
      { key: 'committee_date', label: 'Credit Committee Date', type: 'date' },
      { key: 'committee_members', label: 'Final Committee Members', type: 'textarea' },
      { key: 'committee_notes', label: 'Committee Decision Notes', type: 'textarea' },
    ],
    decisions: ['fund', 'cannot_proceed'],
    cta: 'Agree to Fund →',
  },
  {
    no: 11, key: 'funds_completion', name: 'Funds to Solicitor (Completion)',
    formLabel: 'Funds to Solicitor',
    hint: 'Funds sent to the solicitor for completion',
    roles: ['Underwriter'],
    perm: ['UNDERWRITING_STAGES.FUNDS_COMPLETION', 'edit'],
    // Client 16-10-2026: the amount sent to the solicitor is the NET loan (what actually
    // goes out). Funds to Broker (broker fee + broker's share of the arrangement fee) and,
    // when the deal has drawdowns, Funds Drawn Down (net, client 21-10-2026) sit alongside it.
    checklist: ['Funds sent to solicitor for completion', 'Funds sent to broker', 'Funds drawn down'],
    fields: [
      { key: 'funds_amount', label: 'Net Amount (£)', type: 'number' },
      { key: 'funds_date', label: 'Date Sent to Solicitor', type: 'date' },
      { key: 'broker_funds_amount', label: 'Broker Amount (£)', type: 'number' },
      { key: 'broker_funds_date', label: 'Date Sent to Broker', type: 'date' },
      { key: 'drawdown_funds_amount', label: 'Net Amount (£)', type: 'number' },   // client 21-10-2026: net, not gross
      { key: 'drawdown_funds_date', label: 'Drawn Down Date', type: 'date' },
    ],
    cta: 'Confirm Funds Sent',
  },
  {
    no: 12, key: 'completion_portfolio', name: 'Completion & Move to Portfolio',
    formLabel: 'Completion',
    hint: 'Completion confirmed — underwriting hands the file to Portfolio',
    roles: ['Underwriter'],
    perm: ['UNDERWRITING_STAGES.COMPLETION_PORTFOLIO', 'edit'],
    checklist: ['Completion confirmed', 'File handed to Portfolio'],
    fields: [
      { key: 'completion_date', label: 'Completion Date', type: 'date' },
      { key: 'portfolio_notes', label: 'Handover Notes', type: 'textarea' },
    ],
    cta: 'Complete & Move to Portfolio',
  },
];

const STEP_KEYS = STEPS.map((s) => s.key);
const stepByNo = (n) => STEPS.find((s) => s.no === Number(n)) || null;

/** SLA default (working days) from acceptance. */
const SLA_DAYS = 5;

module.exports = {
  MODULE_KEY, CASE_STATUS, STEP_STATUS, STEPS, STEP_KEYS, stepByNo, SLA_DAYS,
};
