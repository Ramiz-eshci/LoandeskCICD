import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';
import { TagTone } from '../../../shared/ui/ui-tag/ui-tag.component';

export type ApplicationStageKey =
  | 'awaiting-review'
  | 'submitted'
  | 'underwriting'
  | 'credit-review'
  | 'approved'
  | 'legal'
  | 'completed'
  | 'declined';

/** Row returned by GET /api/applications (server-shaped, see application.service.js). */
export interface ApplicationListRow {
  application_id: number;
  application_ref: string;
  applicant_name: string;
  applicant_company: string | null;
  /** Email (else phone) shown under the name, as on the Enquiries list. */
  applicant_contact?: string | null;
  product_name: string;
  amount_requested: number | null;
  /** Basis CHOSEN on the source enquiry: 'Gross' | 'Net' - which figure to headline (client 15-10-2026). */
  loan_basis?: string | null;
  /** Basis of amount_requested itself ('Net' only while no offer / indicative gross exists). */
  amount_basis?: string | null;
  /** Actual net: net advance, else the offer / indicative net (client 15-10-2026). */
  net_loan?: number | null;
  /** LTV incl. other charges on the securities (null when none); ltv_pct is OUR loan's LTV. */
  total_ltv_pct?: number | null;
  term_months: number | null;
  ltv_pct: number | null;
  bdm_name: string;
  underwriter_name: string;
  status_code: string | null;
  status_name: string;
  stage_key: ApplicationStageKey;
  initial_offer_state: string | null;
  initial_offer_note: string | null;
  sla_days: number | null;
  enquiry_id: number | null;
  created_at: string;
  [key: string]: unknown;
}

/** Legacy design-stage row shape (kept for the sample data file). */
export interface LoanApplication {
  id: string;
  applicant: string;
  applicantCompany: string | null;
  product: string;
  grossAmount: string;
  term: string;
  ltv: string;
  bdm: string;
  underwriter: string;
  stageKey: ApplicationStageKey;
  status: string;
  statusTone: BadgeStatus;
  initialOffer: string;
  initialOfferTone: TagTone;
  sla: string;
  slaTone: 'ok' | 'warn' | 'breach';
  [key: string]: unknown;
}

/* ---------- Detail payload (GET /api/applications/:id) ---------- */

export interface Option {
  id: number;
  name: string;
  code?: string;
  category?: string;
}

export interface ApplicationFormOptions {
  branches: Option[];
  products: Option[];
  purposes: Option[];
  sources: Option[];
  brokers: Option[];
  applicantTypes: Option[];
  rejectionReasons: Option[];
  statuses: Option[];
  bdms: Option[];
  underwriters: Option[];
  documentTypes: Option[];
  valuationTypes: Option[];
}

export interface ApplicationApplicant {
  applicant_id: number;
  applicant_role?: string;
  applicant_type_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  /** Carried over from the enquiry; editable on the application. */
  company_reg_no: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  national_id: string | null;
}

export interface ApplicationSecurity {
  security_id?: number;
  property_address: string | null;
  estimated_value: number | null;
  valuation_amount: number | null;
  valuation_date: string | null;
  charge_type: string | null;
  valuation_status: string | null;
  valuation_check: string | null;
  risk_rating: string | null;
  ltv_band: string | null;
  legal_check_status: string | null;
  valuation_type_name: string | null;

  /**
   * The enquiry's property block, held on the application's own security row.
   * This is the application's working copy — the enquiry stays frozen as the
   * original record of what was asked for.
   */
  map_link: string | null;
  postcode: string | null;
  property_type: string | null;
  tenure: string | null;
  tenure_years: number | null;
  gdv: number | null;
  owns_property: boolean | number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  outstanding_loan: number | null;
  repaid_on_completion: boolean | number | null;
  lender: string | null;
  added_value: string | null;
}

export interface ApplicationDocument {
  app_document_id: number;
  file_name: string;
  document_type_id: number | null;
  document_type_name: string | null;
  /** Master document-type code, e.g. SIGNED_OFFER — used to surface the signed offer on the detail page. */
  document_type_code: string | null;
  document_category: string | null;
  version: string | null;
  status: string | null;
  verified_status: string | null;
  verified_at: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface ApplicationTask {
  task_id: number;
  task_type: string | null;
  description: string | null;
  due_date: string | null;
  status: string;
  assigned_to_name: string | null;
}

export interface ApplicationCommunication {
  communication_id: number;
  channel: string;
  to_party: string | null;
  subject: string | null;
  body: string | null;
  comm_at: string;
  from_user_name: string | null;
}

export interface ApplicationNote {
  note_id: number;
  note: string;
  created_by_name: string | null;
  created_at: string;
}

export interface ApplicationAudit {
  timestamp: string;
  /** Enquiry / Application / Underwriting — where in the case this happened. */
  module?: string | null;
  created_at?: string;
  action: string;
  /** Parsed server-side by audit.service.listForEntity; may be raw text on older rows. */
  details: Record<string, unknown> | string | null;
  user_name: string | null;
  role_name: string | null;
}

export interface ApplicationEnquiry {
  enquiry_id: number;
  enquiry_ref: string;
  applicant_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  company_reg_no: string | null;
  amount_requested: number | null;
  /** Basis CHOSEN on the source enquiry: 'Gross' | 'Net' - which figure to headline (client 15-10-2026). */
  loan_basis?: string | null;
  /** Basis of amount_requested itself ('Net' only while no offer / indicative gross exists). */
  amount_basis?: string | null;
  /** Actual net: net advance, else the offer / indicative net (client 15-10-2026). */
  net_loan?: number | null;
  /** LTV incl. other charges on the securities (null when none); ltv_pct is OUR loan's LTV. */
  total_ltv_pct?: number | null;
  term_months: number | null;
  property_address: string | null;
  estimated_value: number | null;
  postcode?: string | null;
  property_type?: string | null;
  tenure?: string | null;
  tenure_years?: number | null;
  charge_type?: string | null;
  gdv?: number | null;
  owns_property?: number | boolean | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  outstanding_loan?: number | null;
  repaid_on_completion?: number | boolean | null;
  lender?: string | null;
  added_value?: string | null;
  ltv_pct?: number | null;
  summary: string | null;
  lead_source: string | null;
  requested_completion_date: string | null;
  /** Loan request extras shown on the Application Loan Request tab (tester 20-10-2026). */
  interest_type?: string | null;
  drawdowns_required?: number | boolean | null;
  total_project_cost?: number | null;
  own_contribution?: number | null;
  deposit_source?: string | null;
  additional_borrowing?: number | boolean | null;
  rep_type?: string | null;
  borrower_sol_firm?: string | null;
  borrower_sol_contact?: string | null;
  borrower_sol_address?: string | null;
  borrower_sol_telephone?: string | null;
  borrower_sol_email?: string | null;
  deal_appraisal?: string | null;
  exit_strategy?: string | null;
  risk_mitigants?: string | null;
  credit_recommendation?: string | null;
  created_at: string;
  converted_at: string | null;
  purpose_name: string | null;
  source_name: string | null;
  broker_name: string | null;
  branch_name: string | null;
  bdm_name: string | null;
  product_name: string | null;
  applicants?: EnquiryApplicantSnapshot[];
  notes?: ApplicationNote[];
}

export interface EnquiryApplicantSnapshot {
  enquiry_applicant_id: number;
  sort_order: number;
  is_primary: number | boolean;
  full_name: string | null;
  dob: string | null;
  nationality: string | null;
  address: string | null;
  time_at_address: string | null;
  email: string | null;
  mobile: string | null;
  owns_home: number | boolean | null;
  occupation: string | null;
  employer_name: string | null;
  business_address: string | null;
  length_of_service: string | null;
  relationship: string | null;
  shareholding_pct: number | null;
  prev_bridging: number | boolean | null;
  prev_bridging_lender: string | null;
}

export interface ApplicationOffer {
  enquiry_offer_id: number;
  version_no: number;
  status: string;
  offer_pdf_doc_id: number | null;
  app_form_doc_id: number | null;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  created_at: string;
  gross_loan_amount: number | null;
  monthly_rate_pct: number | null;
  indicative_id: number | null;
  offer_notes: string | null;
}

export interface ApplicationIndicative {
  enquiry_indicative_id: number;
  version_no: number;
  status: string;
  document_id: number | null;
  sent_at: string | null;
  created_at: string;
}

export interface ApplicationDetail {
  application_id: number;
  application_ref: string;
  enquiry_id: number | null;
  enquiry_ref: string | null;
  /** Open underwriting case, or null until sent to underwriting. */
  underwriting_case_id: number | null;
  /** First signed offer + application form uploaded at convert; others carry the SIGNED_OFFER doc type. */
  signed_offer_doc_id?: number | null;
  amount_requested: number | null;
  /** Basis CHOSEN on the source enquiry: 'Gross' | 'Net' - which figure to headline (client 15-10-2026). */
  loan_basis?: string | null;
  /** Basis of amount_requested itself ('Net' only while no offer / indicative gross exists). */
  amount_basis?: string | null;
  /** Actual net: net advance, else the offer / indicative net (client 15-10-2026). */
  net_loan?: number | null;
  /** LTV incl. other charges on the securities (null when none); ltv_pct is OUR loan's LTV. */
  total_ltv_pct?: number | null;
  /** Client 17-10-2026: (gross + other charges) ÷ all security values - Summary tab only. */
  summary_total_ltv_pct?: number | null;
  term_months: number | null;
  ltv_pct: number | null;
  net_advance: number | null;
  monthly_fee_pct: number | null;
  arrangement_fee_pct: number | null;
  exit_fee: number | null;
  doc_fee: number | null;
  rolled_interest: number | null;
  gross_redemption: number | null;
  irr_pct: number | null;
  loandesk_broker_fee_pct: number | null;
  borrower_broker_fee: number | null;
  introducer_fee: number | null;
  lender_income: number | null;
  completion_date: string | null;
  sla_days: number | null;
  initial_offer_state: string | null;
  initial_offer_note: string | null;
  status_code: string | null;
  status_name: string | null;
  stage_key: ApplicationStageKey;
  branch_name: string | null;
  product_name: string | null;
  purpose_name: string | null;
  source_name: string | null;
  broker_name: string | null;
  bdm_name: string | null;
  bdm_email: string | null;
  underwriter_name: string | null;
  credit_manager_name: string | null;
  kyc_identity_status: string | null;
  kyc_aml_status: string | null;
  kyc_pep_status: string | null;
  kyc_overall_status: string | null;
  /** Server-computed display name (primary applicant, else enquiry fallback). */
  applicant_name?: string | null;
  primary_applicant: ApplicationApplicant | null;
  applicants: ApplicationApplicant[];
  security: ApplicationSecurity | null;
  documents: ApplicationDocument[];
  /** Source enquiry's documents (read-only here). Client 17-10-2026. */
  enquiry_documents?: { enquiry_document_id: number; file_name: string; document_type_name: string | null; created_at: string }[];
  tasks: ApplicationTask[];
  communications: ApplicationCommunication[];
  /** #B4: notes/communications carried from the originating enquiry. */
  enquiry_communications?: ApplicationNote[];
  /** Initial Offer tab: enquiry indicative + offer history (read-only). */
  offers?: ApplicationOffer[];
  indicatives?: ApplicationIndicative[];
  notes: ApplicationNote[];
  audit: ApplicationAudit[];
  enquiry: ApplicationEnquiry | null;
  [key: string]: unknown;
}

/** Map an application status code to the ui-badge tone. */
export function applicationTone(code: string | null | undefined): BadgeStatus {
  switch (String(code || '').toUpperCase()) {
    case 'APPROVED':
    case 'COMPLETED':
      return 'approved';
    case 'UNDERWRITING':
      return 'review';
    case 'CREDIT_REVIEW':
    case 'SUBMITTED':
      return 'pending';
    case 'LEGAL':
      return 'active';
    case 'DECLINED':
    case 'REJECTED':
    case 'WITHDRAWN':
      return 'declined';
    case 'DRAFT':
      return 'info';
    default:
      return 'info';
  }
}
