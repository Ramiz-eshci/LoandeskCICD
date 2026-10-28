/** Credit Approval module — types mirror /api/credit. */

export interface CreditRow {
  application_id: number;
  application_ref: string;
  applicant_name: string | null;
  product_name: string | null;
  amount_requested: number | null;
  term_months: number | null;
  ltv_pct: number | null;
  irr: number | null;
  uw_recommendation: string | null;
  initial_offer_status: string | null;
  policy_exceptions: number;
  property_address: string | null;
  estimated_value: number | null;
  status_code: string | null;
  status_name: string | null;
  [key: string]: unknown;
}

export interface CreditDecisionRow {
  credit_decision_id: number;
  application_id: number;
  application_ref: string;
  applicant_name: string | null;
  amount_requested: number | null;
  ltv_pct: number | null;
  decision: string;
  notes: string | null;
  conditions: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  [key: string]: unknown;
}

export interface CreditKpis {
  pending_decision: number;
  total_exposure: number;
  avg_ltv: number;
  policy_exceptions: number;
}

export interface CreditQueueResponse {
  queue: CreditRow[];
  decisions: CreditDecisionRow[];
  kpis: CreditKpis;
  /** Unfiltered size of each tab (tab badges). */
  totals?: { queue: number; decisions: number };
  /** Paging of the requested tab. */
  meta?: { page: number; per_page: number; total: number; total_pages: number };
}

export interface CreditPaperItem { label: string; pass: boolean; }

export interface CreditPaper {
  application_id: number;
  application_ref: string;
  applicant_name: string | null;
  property_address: string | null;
  amount_requested: number | null;
  ltv_pct: number | null;
  irr: number | null;
  product_name: string | null;
  term_months: number | null;
  uw_recommendation: string | null;
  checklist: CreditPaperItem[];
  policy_exceptions: number;
}

export type CreditDecisionValue = 'approve' | 'approve_conditions' | 'decline' | 'refer';
