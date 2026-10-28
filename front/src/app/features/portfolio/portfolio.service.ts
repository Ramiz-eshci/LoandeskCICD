import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse, ApiMeta } from '../../core/models/api-response.model';
import { Extension } from '../extensions/extension.service';

export interface PortfolioFacilityOption extends Record<string, unknown> {
  loan_id: number;
  loan_number: string;
  application_id: number;
  application_ref: string;
  applicant_id: number;
  customer_name: string;
  principal: number;
  outstanding_balance: number | null;
  maturity_date: string | null;
  status: string;
  product: string | null;
  rate_pct: number;
  arrears_amount: number;
}

export interface PortfolioCustomerRow extends Record<string, unknown> {
  applicant_id: number;
  customer_name: string;
  applicant_type: string | null;
  company_name: string | null;
  branch_name: string | null;
  facilities: number;
  applications: number;
  exposure: number;
  arrears_amount: number;
  created_at: string | null;
}

export interface PortfolioContactLog extends Record<string, unknown> {
  log_id: number;
  loan_id: number;
  loan_number: string;
  application_id: number;
  application_ref: string;
  applicant_id: number;
  customer_name: string;
  contact_date: string;
  person: string;
  method: string;
  contact_notes: string | null;
  followup_date: string | null;
  outlook_reminder: boolean | number;
  outlook_event_id: string | null;
  followup_status: string;
  contact_outcome: string | null;
  milestone_month?: number | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface ContactScheduleMilestone {
  month: number;
  due_date: string | null;
  status: string;
  /** Contact log that satisfies this milestone (null = not contacted yet). */
  log_id: number | null;
  contact_date: string | null;
  person: string | null;
  method: string | null;
  outcome: string | null;
}
export interface ContactSchedule {
  loan_number: string;
  status: string;
  monthly: boolean;
  rag: string;
  overdue: number;
  due: number;
  milestones: ContactScheduleMilestone[];
}
export interface PortfolioNote extends Record<string, unknown> {
  note_id: number;
  note: string;
  created_at: string;
  created_by_name: string;
}

export interface PortfolioContactPayload {
  loan_id: number | null;
  application_id: number | null;
  applicant_id: number | null;
  contact_date: string;
  person: string;
  method: string;
  contact_notes: string;
  followup_date: string;
  outlook_reminder: boolean;
  followup_status: string;
  contact_outcome: string;
  /** Contact Schedule milestone (month no.) this log is recorded against. */
  milestone_month?: number | null;
}

export interface DrawdownPlanItem {
  index: number;
  month: number | null;
  months_left: number;
  gross: number;
  net: number;
  interest: number;
  sent: boolean;
  drawdown_id: number | null;
  drawn_on: string | null;
  document_id: number | null;
  notes: string | null;
}
export interface DrawdownSummary {
  is_drawdown_facility: boolean;
  interest_type: string | null;
  monthly_rate_pct: number;
  plan: DrawdownPlanItem[];
  base: { net: number; gross: number; interest: number };
  drawdowns: { net: number; gross: number; interest: number };
  drawdowns_agreed?: { net: number; gross: number; interest: number };
  totals: { net: number; gross: number; interest: number };
  exit_fee: number;
  amount_outstanding: number;
}

export interface PortfolioFacilityDetail {
  facility: PortfolioFacilityOption & {
    branch_name: string | null;
    term_months: number;
    start_date: string | null;
    days_overdue: number;
    enquiry_id?: number | null;
    underwriting_case_id?: number | null;
    net_advance?: number | null;
    rolled_interest?: number | null;
    /** Client 22-10-2026: shared facility position (api/services/facilityPosition.service.js). */
    position?: {
      day1_net: number; drawdown_net: number; drawdown_gross: number; drawdowns_released: number;
      net_loan: number; gross_drawn: number; amount_paid: number; outstanding: number; monthly_interest: number;
      /** Client 23-10-2026 */ net_loan_total?: number; redemption_due?: number | null; gross_outstanding?: number;
    } | null;
    customer_email?: string | null;
    customer_phone?: string | null;
    // Bad loans (client 30-09-2026)
    bad_debt_at?: string | null;
    bad_debt_by_name?: string | null;
    bad_debt_note?: string | null;
    bad_debt_note_at?: string | null;
    bad_debt_note_by_name?: string | null;
    written_off_at?: string | null;
    written_off_by_name?: string | null;
    write_off_amount?: number | null;
    write_off_reason?: string | null;
    recovered_amount?: number;
    remaining_balance?: number;
  };
  /** Extensions raised on this facility (Extension tab). */
  extensions?: Extension[];
  /** Money received on a bad debt (instalments). */
  recoveries?: PortfolioRecovery[];
  schedule: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  collections: Record<string, unknown>[];
  security: Record<string, unknown>[];
  valuations: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  contacts: PortfolioContactLog[];
  requests: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  fees: Record<string, unknown>[];
  drawdowns: Record<string, unknown>[];
  drawdowns_summary?: DrawdownSummary;
  covenants: Record<string, unknown>[];
  redemptions: Record<string, unknown>[];
  documentTypes: { id: number; name: string; category?: string | null }[];
}

export interface PortfolioCustomerDetail {
  profile: {
    applicant_id: number;
    customer_name: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    email: string | null;
    phone: string | null;
    applicant_type: string | null;
    created_at: string | null;
  };
  facilities: (PortfolioFacilityOption & { arrears_amount: number; net_amount?: number | null })[];
  applications: {
    application_id: number;
    application_ref: string;
    status: string | null;
    product: string | null;
    branch_name: string | null;
    amount_requested: number | null;
    created_at: string | null;
  }[];
  documents: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  contacts: PortfolioContactLog[];
  documentTypes: { id: number; name: string; category?: string | null }[];
  enquiries: Record<string, unknown>[];
  underwriting: Record<string, unknown>[];
  enquiryDocuments: Record<string, unknown>[];
  allDocuments: Record<string, unknown>[];
}

export interface PortfolioRecovery extends Record<string, unknown> {
  recovery_id: number;
  received_on: string;
  amount: number;
  method: string | null;
  reference: string | null;
  notes: string | null;
  created_by_name: string;
}

/** Further Advance request (Extension is its own workflow - see ExtensionService). Revised Rate removed 30-09-2026. */
export interface PortfolioFacilityRequestPayload {
  request_type: string;
  effective_date: string;
  current_maturity: string;
  proposed_maturity: string;
  new_amount: number | null;
  reason: string;
}

export interface FacilityRequestResult {
  id: number;
  enquiry_id?: number | null;
  enquiry_ref?: string | null;
  enquiry_error?: string | null;
  extension_id?: number | null;
  extension_ref?: string | null;
}

export interface RedemptionQuery { redemption_date: string; interest_basis?: string; min_interest_months?: number | null; document_fee?: number | null; broker_fee?: number | null; arrangement_fee?: number | null; exit_fee_type?: string | null; exit_fee_value?: number | null; exit_fee?: number | null }
export interface RedemptionSendPayload { to: string; cc: string; message: string }
/** Exit fee options (client 16-10-2026). */
export type RedExitType = 'amount' | 'months' | 'pct_gross' | 'pct_net';
export interface RedemptionFigures {
  redemption_date: string;
  interest_basis: 'daily' | 'monthly';
  min_interest_months: number;
  min_source: string;
  days_elapsed: number;
  months_charged: number;
  monthly_interest: number;
  daily_interest: number;
  principal_amount: number;
  net_principal?: number;
  amount_paid?: number;
  outstanding_amount?: number;
  principal_paid_off?: boolean;
  /** Client 27-10-2026: set once Redeem Facility has fixed the redemption (Completed statement). */
  fixed_redemption_id?: number;
  fixed_required?: number;
  exit_fee_basis?: number;
  gross_amount?: number;
  is_drawdown_facility?: boolean;
  drawdown_net?: number;
  drawdown_gross?: number;
  drawdown_accrued?: number;
  drawdowns_released?: number;
  day1_net?: number;
  accrued_interest: number;
  min_interest?: number;
  min_interest_applies?: boolean;
  min_interest_adj: number;
  exit_fee_rule?: string;
  exit_fee: number;
  exit_fee_calc?: number;
  exit_fee_edited?: boolean;
  exit_fee_type?: RedExitType | null;
  exit_fee_value?: number | null;
  min_interest_until?: string;
  document_fee?: number;
  broker_fee?: number;
  arrangement_fee?: number;
  other_fees: number;
  credits: number;
  total_amount: number;
  early: boolean;
}

export interface PortfolioPaymentPayload {
  paid_on: string;
  amount: number | null;
  method: string;
  reference: string;
  schedule_id?: number | null;
}

export interface PagedResult<T> {
  rows: T[];
  meta: ApiMeta | null;
}

export interface PortfolioListQuery {
  page?: number;
  per_page?: number;
  search?: string;
  maturing_days?: number;
  arrears?: string;
  method?: string;
  status?: string;
  outcome?: string;
  /** Facilities: 'live' (Active only, default) | 'all' (every status). */
  /** live = Active; completed = Redeemed (client 26-10-2026); all = every status. */
  scope?: 'live' | 'all' | 'completed';
  /** Today tab: only facilities with a payment / contact / redemption due today or overdue. */
  due_today?: boolean;
}

export interface PortfolioSummary {
  portfolio_value: number;
  active_count: number;
  extensions_count?: number;
  arrears_amount: number;
  arrears_count: number;
  buckets: { days: number; count: number; value: number }[];
}

@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.portfolio;

  private listParams(q: PortfolioListQuery): HttpParams {
    let params = new HttpParams()
      .set('page', String(q.page ?? 1))
      .set('per_page', String(q.per_page ?? 10));
    if (q.search) params = params.set('search', q.search);
    if (q.maturing_days) params = params.set('maturing_days', String(q.maturing_days));
    if (q.arrears) params = params.set('arrears', q.arrears);
    if (q.method) params = params.set('method', q.method);
    if (q.status) params = params.set('status', q.status);
    if (q.outcome) params = params.set('outcome', q.outcome);
    if (q.scope) params = params.set('scope', q.scope);
    if (q.due_today) params = params.set('due_today', '1');
    return params;
  }

  // ---- Bad loans (client 30-09-2026) ----
  markBadDebt(id: number | string, note: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/facilities/${id}/bad-debt`, { note }).pipe(map((r) => r.data));
  }
  updateBadDebtNote(id: number | string, note: string): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/facilities/${id}/bad-debt/note`, { note }).pipe(map((r) => r.data));
  }
  recordRecovery(id: number | string, payload: { received_on: string; amount: number | null; method: string; reference: string; notes: string }): Observable<{ remaining: number; closed: boolean }> {
    return this.http.post<ApiResponse<{ remaining: number; closed: boolean }>>(`${this.base}/facilities/${id}/recoveries`, payload).pipe(map((r) => r.data));
  }
  writeOff(id: number | string, reason: string): Observable<{ write_off_amount: number }> {
    return this.http.post<ApiResponse<{ write_off_amount: number }>>(`${this.base}/facilities/${id}/write-off`, { reason }).pipe(map((r) => r.data));
  }
  restoreBadDebt(id: number | string, reason: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/facilities/${id}/restore`, { reason }).pipe(map((r) => r.data));
  }

  /** Server-paged facilities for the Portfolio > Facilities table. */
  facilities(q: PortfolioListQuery = {}): Observable<PagedResult<PortfolioFacilityOption>> {
    return this.http
      .get<ApiResponse<PortfolioFacilityOption[]>>(`${this.base}/facilities`, { params: this.listParams(q) })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  /** All active facilities (slim) for the contact-log picker + KPI aggregates. */
  facilityOptions(): Observable<PortfolioFacilityOption[]> {
    return this.http
      .get<ApiResponse<PortfolioFacilityOption[]>>(`${this.base}/facility-options`)
      .pipe(map((r) => r.data ?? []));
  }

  /** Whole-book KPI summary (value, active, arrears, 30/60/90 maturity buckets). */
  summary(): Observable<PortfolioSummary> {
    return this.http
      .get<ApiResponse<PortfolioSummary>>(`${this.base}/summary`)
      .pipe(map((r) => r.data));
  }

  facility(id: number | string): Observable<PortfolioFacilityDetail> {
    return this.http
      .get<ApiResponse<PortfolioFacilityDetail>>(`${this.base}/facilities/${id}`)
      .pipe(map((r) => r.data));
  }

  createFacilityRequest(id: number | string, payload: PortfolioFacilityRequestPayload): Observable<FacilityRequestResult> {
    return this.http
      .post<ApiResponse<FacilityRequestResult>>(`${this.base}/facilities/${id}/requests`, payload)
      .pipe(map((r) => r.data));
  }

  recordPayment(id: number | string, payload: PortfolioPaymentPayload): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/payments`, payload)
      .pipe(map((r) => r.data));
  }

  uploadFacilityDocument(id: number | string, payload: { file_name: string; content_base64: string; document_type_id?: number | null }): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/documents`, payload)
      .pipe(map((r) => r.data));
  }

  recordFee(id: number | string, payload: { fee_type: string; amount: number | null; due_date: string; status: string; notes: string }): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/fees`, payload)
      .pipe(map((r) => r.data));
  }

  releaseDrawdown(id: number | string, payload: { amount: number | null; drawn_on: string; notes: string; agreed_month: number | null; document_id: number | null; status?: string }): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/drawdowns`, payload)
      .pipe(map((r) => r.data));
  }

  createCovenant(id: number | string, payload: { name: string; covenant_type: string; frequency: string; next_due: string; status: string; notes: string }): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/covenants`, payload)
      .pipe(map((r) => r.data));
  }

  /** Generate a redemption statement and e-mail it (client 30-09-2026 - not saved to Documents). */
  createRedemption(id: number | string, payload: RedemptionSendPayload & { redemption_date: string; interest_basis: string; min_interest_months: number | null; send_email: boolean; document_fee?: number | null; broker_fee?: number | null; arrangement_fee?: number | null; exit_fee_type?: string | null; exit_fee_value?: number | null; exit_fee?: number | null }): Observable<{ emailed: boolean; error?: string; id?: number }> {
    return this.http
      .post<ApiResponse<{ emailed: boolean; error?: string; id?: number }>>(`${this.base}/facilities/${id}/redemptions`, payload)
      .pipe(map((r) => r.data));
  }

  private redParams(q: RedemptionQuery): HttpParams {
    let p = new HttpParams().set('redemption_date', q.redemption_date);
    if (q.interest_basis) p = p.set('interest_basis', q.interest_basis);
    if (q.min_interest_months != null) p = p.set('min_interest_months', String(q.min_interest_months));
    if (q.document_fee != null) p = p.set('document_fee', String(q.document_fee));
    if (q.broker_fee != null) p = p.set('broker_fee', String(q.broker_fee));
    if (q.arrangement_fee != null) p = p.set('arrangement_fee', String(q.arrangement_fee));
    if (q.exit_fee_type) p = p.set('exit_fee_type', q.exit_fee_type).set('exit_fee_value', String(q.exit_fee_value ?? 0));
    if (q.exit_fee != null) p = p.set('exit_fee', String(q.exit_fee));
    return p;
  }
  redemptionPreview(id: number | string, q: RedemptionQuery): Observable<{ figures: RedemptionFigures; settings: { min_interest_months: number; interest_basis: 'daily' | 'monthly'; min_source: string } }> {
    return this.http.get<ApiResponse<{ figures: RedemptionFigures; settings: { min_interest_months: number; interest_basis: 'daily' | 'monthly'; min_source: string } }>>(`${this.base}/facilities/${id}/redemption/preview`, { params: this.redParams(q) }).pipe(map((r) => r.data));
  }
  redemptionStatementPdf(id: number | string, q: RedemptionQuery): Observable<Blob> {
    return this.http.get(`${this.base}/facilities/${id}/redemption/statement.pdf`, { params: this.redParams(q), responseType: 'blob' });
  }
  redemptionStoredPdf(id: number | string, rid: number): Observable<Blob> {
    return this.http.get(`${this.base}/facilities/${id}/redemptions/${rid}/statement.pdf`, { responseType: 'blob' });
  }
  redemptionRecipients(id: number | string): Observable<{ recipients: { key: string; label: string; email: string }[]; cc: { label: string; email: string }[] }> {
    return this.http.get<ApiResponse<{ recipients: { key: string; label: string; email: string }[]; cc: { label: string; email: string }[] }>>(`${this.base}/facilities/${id}/redemption/recipients`).pipe(map((r) => r.data));
  }
  redemptionSettings(id: number | string, payload: { interest_basis: string; min_interest_months: number; exit_fee_type?: string | null; exit_fee_value?: number | null; exit_fee?: number | null }): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/facilities/${id}/redemption/settings`, payload).pipe(map((r) => r.data));
  }
  redemptionResend(id: number | string, rid: number, payload: RedemptionSendPayload): Observable<{ emailed: boolean; error?: string }> {
    return this.http.post<ApiResponse<{ emailed: boolean; error?: string }>>(`${this.base}/facilities/${id}/redemptions/${rid}/send`, payload).pipe(map((r) => r.data));
  }

  /** Redeem Facility from a sent statement (client 26-10-2026): records the payment and closes it. */
  redeemFromStatement(id: number | string, redemptionId: number): Observable<Record<string, unknown>> {
    return this.http
      .post<ApiResponse<Record<string, unknown>>>(`${this.base}/facilities/${id}/redemptions/${redemptionId}/redeem`, {})
      .pipe(map((r) => r.data));
  }

  completeRedemption(id: number | string, redemptionId: number): Observable<Record<string, unknown>> {
    return this.http
      .post<ApiResponse<Record<string, unknown>>>(`${this.base}/facilities/${id}/redemptions/${redemptionId}/complete`, {})
      .pipe(map((r) => r.data));
  }

  deleteFacilityDocument(id: number | string, docId: number): Observable<boolean> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/facilities/${id}/documents/${docId}`).pipe(map((r) => r.status));
  }

  deleteCustomerDocument(id: number | string, docId: number, kind: 'application' | 'enquiry' = 'application'): Observable<boolean> {
    const seg = kind === 'enquiry' ? 'enquiry-documents' : 'documents';
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/customers/${id}/${seg}/${docId}`).pipe(map((r) => r.status));
  }

  updateFee(id: number | string, feeId: number, payload: { fee_type: string; amount: number | null; due_date: string; status: string; notes: string }): Observable<{ id: number }> {
    return this.http.patch<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/fees/${feeId}`, payload).pipe(map((r) => r.data));
  }

  deleteFee(id: number | string, feeId: number): Observable<boolean> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/facilities/${id}/fees/${feeId}`).pipe(map((r) => r.status));
  }

  downloadFacilityDocument(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/facilities/${id}/documents/${docId}/download`, { responseType: 'blob' });
  }

  uploadCustomerDocument(id: number | string, payload: { file_name: string; content_base64: string; document_type_id: number; application_id?: number }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/customers/${id}/documents`, payload).pipe(map((r) => r.data));
  }

  downloadCustomerDocument(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/customers/${id}/documents/${docId}/download`, { responseType: 'blob' });
  }

  downloadCustomerEnquiryDocument(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/customers/${id}/enquiry-documents/${docId}/download`, { responseType: 'blob' });
  }

  customers(q: PortfolioListQuery = {}): Observable<PagedResult<PortfolioCustomerRow>> {
    return this.http
      .get<ApiResponse<PortfolioCustomerRow[]>>(`${this.base}/customers`, { params: this.listParams(q) })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  /** Edit a customer's basic details (client 16-10-2026). */
  updateCustomer(id: number | string, payload: { first_name: string; last_name: string; company_name: string; email: string; phone: string }): Observable<{ changed: string[] }> {
    return this.http.put<ApiResponse<{ changed: string[] }>>(`${this.base}/customers/${id}`, payload).pipe(map((r) => r.data));
  }
  customerDetail(id: number | string): Observable<PortfolioCustomerDetail> {
    return this.http
      .get<ApiResponse<PortfolioCustomerDetail>>(`${this.base}/customers/${id}`)
      .pipe(map((r) => r.data));
  }

  contactSchedule(id: number | string): Observable<ContactSchedule> {
    return this.http.get<ApiResponse<ContactSchedule>>(`${this.base}/facilities/${id}/contact-schedule`).pipe(map((r) => r.data));
  }

  facilityNotes(id: number | string): Observable<PortfolioNote[]> {
    return this.http.get<ApiResponse<PortfolioNote[]>>(`${this.base}/facilities/${id}/notes`).pipe(map((r) => r.data ?? []));
  }

  addFacilityNote(id: number | string, note: string): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/facilities/${id}/notes`, { note }).pipe(map((r) => r.data));
  }

  contactLookups(): Observable<{ methods: string[]; followupStatuses: string[]; contactOutcomes: string[] }> {
    return this.http
      .get<ApiResponse<{ methods: string[]; followupStatuses: string[]; contactOutcomes: string[] }>>(`${this.base}/lookups`)
      .pipe(map((r) => r.data ?? { methods: [], followupStatuses: [], contactOutcomes: [] }));
  }

  contacts(q: PortfolioListQuery = {}): Observable<PagedResult<PortfolioContactLog>> {
    return this.http
      .get<ApiResponse<PortfolioContactLog[]>>(`${this.base}/contacts`, { params: this.listParams(q) })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  createContact(payload: PortfolioContactPayload): Observable<{ id: number }> {
    return this.http
      .post<ApiResponse<{ id: number }>>(`${this.base}/contacts`, payload)
      .pipe(map((r) => r.data));
  }

  updateContact(id: number, payload: PortfolioContactPayload): Observable<{ id: number }> {
    return this.http
      .patch<ApiResponse<{ id: number }>>(`${this.base}/contacts/${id}`, payload)
      .pipe(map((r) => r.data));
  }

  deleteContact(id: number): Observable<boolean> {
    return this.http
      .delete<ApiResponse<unknown>>(`${this.base}/contacts/${id}`)
      .pipe(map((r) => r.status));
  }
}
