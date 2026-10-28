/** Legal & Completion module — types mirror /api/legal. */

export interface LegalCaseRow {
  application_id: number;
  application_ref: string;
  applicant_name: string | null;
  amount_requested: number | null;
  property_address: string | null;
  borrower_solicitor: string | null;
  lender_solicitor: string | null;
  borrower_solicitor_id: number | null;
  lender_solicitor_id: number | null;
  offer_date: string | null;
  target_completion_date: string | null;
  completed_at: string | null;
  legal_stage: string;
  conditions_met: number;
  conditions_total: number;
  conditions_all_met: boolean;
  status_code: string | null;
  status_name: string | null;
  [key: string]: unknown;
}

export interface LegalCondition {
  legal_condition_id: number;
  name: string;
  status: 'Pending' | 'Satisfied' | string;
  sort_order: number;
}

export interface LegalCaseDetail extends LegalCaseRow {
  conditions: LegalCondition[];
}

export interface LegalKpis {
  in_legal: number;
  ready_to_complete: number;
  completing_this_week: number;
  completed: number;
}

export interface LegalPipelineResponse {
  active: LegalCaseRow[];
  completed: LegalCaseRow[];
  stages: string[];
  stage_counts: Record<string, number>;
  kpis: LegalKpis;
  totals?: { active: number; completed: number };
  meta?: { page: number; per_page: number; total: number; total_pages: number };
}

/** Credit Paper (Credit Deal Summary) — an uploaded document, not a form. */
export interface CreditPaperDoc {
  id: number;
  step_no: number | null;
  file_name: string;
  content_type: string | null;
  created_at: string;
}

export interface CreditPaperResponse {
  application_id: number;
  application_ref: string;
  case_id: number | null;
  step_no: number;
  step_status: string | null;
  editable: boolean;
  label: string;
  documents: CreditPaperDoc[];
}
