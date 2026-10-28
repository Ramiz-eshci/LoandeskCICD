import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';

/** Reference option ({ id, name }) returned by /enquiries/meta/form-options. */
export interface Option {
  id: number;
  name: string;
  /** Present on assignees; used for self-matching fallback. */
  email?: string;
  /** Present on brokers; shown in brackets as the broker's company. */
  company?: string;
  /** Present on brokers; used to prefill the inline edit form. */
  phone?: string;
  /** Brokers: application form section 1 (client 15-10-2026). */
  address?: string | null;
  fca_number?: string | null;
}
export interface StatusOption extends Option {
  code: string;
}

/** Type of Deal (client 26-10-2026) - same list the API accepts for enquiries.deal_type. */
export const DEAL_TYPES = ['Residential', 'Commercial', 'Mixed'] as const;

/** Borrower's solicitor master row - the 5 application-form fields (client 15-10-2026). */
export interface SolicitorOption {
  id: number;
  firm: string;
  contact_name: string | null;
  address: string | null;
  telephone: string | null;
  email: string | null;
  /** Number of SRA Partners - application form section 5 (client 15-10-2026). */
  sra_partners?: number | string | null;
}

/** The four optional credit-paper notes typed on the Convert popup (client 15-10-2026). */
export interface CreditNotes {
  deal_appraisal: string;
  exit_strategy: string;
  risk_mitigants: string;
  credit_recommendation: string;
}

export interface EnquiryFormOptions {
  branches: Option[];
  products: Option[];
  purposes: Option[];
  sources: Option[];
  brokers: Option[];
  /** Borrower's solicitor master (client 15-10-2026). */
  solicitors?: SolicitorOption[];
  applicantTypes: Option[];
  statuses: StatusOption[];
  assignees: Option[];
  documentTypes: Option[];
  leadSources: { id: number | null; name: string }[];
  /** Decline Reason master (active rows) for the Decline popup. */
  declineReasons?: Option[];
}

/** Row shape from GET /enquiries (list). */
export interface EnquiryListRow {
  enquiry_id: number;
  enquiry_ref: string;
  applicant_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  amount_requested: number | null;
  /** Gross loan from the accepted/sent offer / indicative (falls back to amount_requested unless it is a Net figure). */
  gross_loan_accepted?: number | null;
  /** 'Net' -> amount_requested is a net figure; list shows it with a NET marker until a gross exists. */
  loan_basis?: 'Gross' | 'Net' | string | null;
  /** "Loan Amount" column (client 15-10-2026): offer / sent-indicative gross, else the amount typed on the enquiry. */
  loan_amount?: number | null;
  /** Basis of loan_amount: 'Gross' once an offer / sent indicative exists, else the enquiry's loan_basis. */
  loan_amount_basis?: 'Gross' | 'Net' | string | null;
  /** LTV incl. other charges on the securities (null when none); ltv_pct is OUR loan's LTV (client 15-10-2026). */
  total_ltv_pct?: number | null;
  term_months: number | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  enquiry_status_id: number | null;
  status_code: string | null;
  status_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  product_id: number | null;
  product_name: string | null;
  loan_purpose_id: number | null;
  purpose_name: string | null;
  application_source_id: number | null;
  source_name: string | null;
  broker_id: number | null;
  broker_name: string | null;
  converted_application_id: number | null;
  converted_application_ref?: string | null;
  created_at: string;
  lead_source?: string | null;
  lead_source_id?: number | null;
  broker_name_text?: string | null;
  dob?: string | null;
  requested_completion_date?: string | null;
  company_reg_no?: string | null;
  ltv_pct?: number | null;
  [key: string]: unknown;
}

export interface EnquiryNote {
  note_id: number;
  note: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export interface EnquiryAssignment {
  assignment_id: number;
  assigned_to: number | null;
  assigned_to_name: string | null;
  previous_assigned_to: number | null;
  previous_assigned_to_name: string | null;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_at: string;
  note: string | null;
}

export interface EnquiryDocument {
  enquiry_document_id: number;
  file_name: string | null;
  file_path: string | null;
  document_type_id: number | null;
  document_type_name?: string | null;
  uploaded_by?: number | null;
  created_at: string;
}

export interface EnquiryApplicant {
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

/** Full enquiry from GET /enquiries/:id. */
export interface AdditionalSecurity {
  security_type?: string | null;
  description?: string | null;
  address?: string | null;
  estimated_value?: number | string | null;
  existing_charge?: number | string | null;
  tenure?: string | null;
  notes?: string | null;
}

export interface AdditionalSecurity {
  security_type?: string | null;
  description?: string | null;
  address?: string | null;
  estimated_value?: number | string | null;
  existing_charge?: number | string | null;
  tenure?: string | null;
  notes?: string | null;
  // Same fields as the main Security / Property (client 26-09-2026)
  map_link?: string | null;
  postcode?: string | null;
  property_type?: string | null;
  tenure_years?: number | string | null;
  charge_type?: string | null;
  owns_property?: boolean | string | null;
  gdv?: number | string | null;
  purchase_price?: number | string | null;
  purchase_date?: string | null;
  outstanding_loan?: number | string | null;
  charge_amount?: number | string | null;
  repaid_on_completion?: boolean | string | null;
  lender?: string | null;
  added_value?: string | null;
}

export interface Enquiry extends EnquiryListRow {
  /** Step 3 — whether amount_requested is a Gross or Net loan figure (client 09-10-2026). */
  loan_basis?: 'Gross' | 'Net' | string | null;
  property_address: string | null;
  estimated_value: number | null;
  interest_type?: string | null;
  additional_securities?: AdditionalSecurity[] | null;
  /** Step 3 — drawdowns wanted at enquiry time (pre-fill the Send Indicatives popup). */
  drawdowns_required?: number | boolean | null;
  drawdowns?: { month: number | null; amount: number | null }[] | null;
  /** Google Maps link for the main security (Security tab map). */
  map_link?: string | null;
  /** Email of the broker picked from the Brokers master — indicatives / offers go here. */
  broker_email?: string | null;
  /** Assigned BDM's email — always CC'd on indicative / offer emails. */
  assigned_to_email?: string | null;
  // Security / Property (PDF section 3)
  postcode?: string | null;
  property_type?: string | null;
  /** Type of Deal: Residential / Commercial / Mixed (client 26-10-2026). */
  deal_type?: string | null;
  tenure?: string | null;
  tenure_years?: number | null;
  charge_type?: string | null;
  gdv?: number | null;
  owns_property?: number | boolean | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  outstanding_loan?: number | null;
  charge_amount?: number | null;
  repaid_on_completion?: number | boolean | null;
  lender?: string | null;
  added_value?: string | null;
  applicants?: EnquiryApplicant[];
  summary: string | null;
  /** Step 3 — solicitor representation (client 15-10-2026). Single -> borrower's own solicitor below. */
  rep_type?: 'single' | 'dual' | string | null;
  /** Solicitor master row picked for the borrower (single rep). */
  borrower_solicitor_id?: number | null;
  borrower_sol_firm?: string | null;
  borrower_sol_contact?: string | null;
  borrower_sol_address?: string | null;
  borrower_sol_telephone?: string | null;
  borrower_sol_email?: string | null;
  /** Step 3 — optional credit paper narrative (Credit Deal Summary / Credit Paper). */
  deal_appraisal?: string | null;
  exit_strategy?: string | null;
  // Application form section 2 "Loan Details" (client 15-10-2026)
  total_project_cost?: number | string | null;
  own_contribution?: number | string | null;
  deposit_source?: string | null;
  additional_borrowing?: boolean | number | null;
  risk_mitigants?: string | null;
  credit_recommendation?: string | null;
  /** Latest sent / accepted offer figures — the header strip shows these once an offer is out. */
  /** Gross of the accepted/sent offer or SENT indicative (null until one exists). */
  latest_gross?: number | null;
  /** Our LTV / Total LTV on the current gross (offer > sent indicative > typed gross). */
  current_ltv_pct?: number | null;
  current_total_ltv_pct?: number | null;
  /** Client 17-10-2026: (gross + other charges) ÷ all security values - Summary tab only. */
  summary_total_ltv_pct?: number | null;
  /** Actual net: offer / sent-indicative net, else the typed Net amount (client 15-10-2026). */
  net_loan?: number | null;
  current_terms?: { gross_loan_amount: number | null; term_months: number | null; ltv_pct: number | null; total_ltv_pct?: number | null; status?: string; version_no?: number; source?: string } | null;
  lost_reason: string | null;
  /** The decline in force (status LOST, not re-opened), else null. */
  decline?: EnquiryDecline | null;
  /** Full decline / re-open history, newest first. */
  declines?: EnquiryDecline[];
  applicant_type_id: number | null;
  applicant_type_name: string | null;
  converted_at: string | null;
  offer_amount?: number | null;
  offer_rate?: number | null;
  offer_valid_until?: string | null;
  offer_notes?: string | null;
  offer_sent_at?: string | null;
  indicative_sent_at?: string | null;
  offer_accepted_at?: string | null;
  notes: EnquiryNote[];
  assignments: EnquiryAssignment[];
  documents: EnquiryDocument[];
}

export interface ConvertResult {
  applicationId: number;
  applicationRef: string;
  /** Credit Deal Summary e-mail to Head of Application users (29-09-2026). */
  summary?: { ok: boolean; sentTo: number; failed?: number; error?: string } | null;
  /** Gross carried into the application and where it came from (offer / indicative / enquiry). */
  grossAmount?: number | null;
  grossSource?: string | null;
}


/** Indicative terms calculation output (mirrors api enquiry.calc.service). */
/** One row of the enquiry's audit trail (GET /enquiries/:id/audit). */
export interface EnquiryAuditRow {
  audit_id: number;
  /** Enquiry / Application / Underwriting — where in the case this happened. */
  module?: string | null;
  role_name?: string | null;
  step_no?: number | null;
  from_status?: string | null;
  to_status?: string | null;
  reason?: string | null;
  action: string;
  module_key: string | null;
  entity_name: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_id: number | null;
  user_name: string | null;
}

export interface IndicativeCalc {
  /** false until a property value AND a gross loan have been entered. */
  ready?: boolean;
  property_value: number; ltv_pct: number | null; gdv: number; ltgdv_pct: number | null;
  max_ltv: number; total_gross_loan_incl_dds: number; arrangement_fee: number; broker_fee: number;
  document_fee: number; retained_interest_day1_rate_pct: number; retained_interest_day1: number;
  retained_interest_total: number; day1_total_deductions: number; day1_net: number;
  total_deductions: number; total_net: number; term_months: number;
  interest_type?: string; first_charge?: number; base_gross?: number;
  drawdown_retained_interest?: number; drawdowns_total?: number;
  total_net_incl_drawdowns?: number; actual_total_ltv_pct?: number;
  monthly_payment?: number; rolled_up_interest?: number | null; redemption_total?: number;
  serviced_interest_total?: number;
  arrangement_fee_is_pct?: boolean; broker_fee_is_pct?: boolean;
  arrangement_fee_pct?: number | null; broker_fee_pct?: number | null;
  calc_type?: string; ltv_mode?: string; annual_rate_pct?: number | null; monthly_interest?: number | null;
  drawdowns?: { month: number | null; amount: number; months_left: number; interest: number | null; net: number | null }[];
  /** Other / additional securities ticked on the indicative (client point #5). */
  main_property_value?: number | null; main_first_charge?: number | null;
  additional_securities?: IndSecurity[]; additional_securities_value?: number; additional_securities_charges?: number;
  total_security_value?: number | null;
  /** 'net' = LTV taken of securities less outstanding loans / 2nd charges (29-09-2026). */
  value_model?: 'net' | null; net_property_value?: number | null;
}
/** One other / additional security as the indicative uses it. */
export interface IndSecurity {
  address: string; security_type?: string; value: number | null; existing_charge: number | null; include?: boolean; gdv?: number | null;
}
export interface IndicativeResult { inputs: Record<string, unknown>; calc: IndicativeCalc; warnings: string[]; }
export interface IndicativeVersion {
  enquiry_indicative_id: number; version_no: number; status: string; document_id: number | null;
  email_status?: string | null; email_error?: string | null;
  sent_at: string | null; created_at: string; inputs: Record<string, unknown>; calc: IndicativeCalc;
  /** Notes e-mailed to the broker with this version (client 20-10-2026). */
  notes?: string | null;
}
export interface OfferVersion {
  enquiry_offer_id: number; version_no: number; status: string; offer_pdf_doc_id: number | null;
  app_form_doc_id: number | null; valid_until: string | null; email_status: string | null;
  email_to: string | null; email_cc: string | null; email_error: string | null; sent_at: string | null;
  accepted_at: string | null; created_at: string; offer: Record<string, unknown>;
}

/** Map an enquiry status code to a design-system badge tone. */
export function statusTone(code: string | null | undefined): BadgeStatus {
  switch ((code || '').toUpperCase()) {
    case 'NEW': return 'closed';
    case 'UNASSIGNED': return 'closed';
    case 'ASSIGNED': return 'info';
    case 'CONTACTED': return 'pending';
    case 'FOLLOW_UP': return 'pending';
    case 'QUALIFIED': return 'review';
    case 'OFFER_ACCEPTED': return 'approved';
    case 'CONVERTED': return 'active';
    case 'LOST': return 'declined';
    case 'CLOSED': return 'closed';
    default: return 'info';
  }
}

/** One decline of an enquiry (client 29-09-2026). */
export interface EnquiryDecline {
  enquiry_decline_id: number;
  notes: string | null;
  previous_status_code: string | null;
  declined_by: number | null;
  declined_by_name: string | null;
  declined_at: string;
  reopened_by: number | null;
  reopened_by_name: string | null;
  reopened_at: string | null;
  reopen_note: string | null;
  reasons: { id: number; name: string }[];
}
