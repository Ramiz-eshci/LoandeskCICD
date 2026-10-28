import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse, ApiMeta } from '../../core/models/api-response.model';

export interface UwField { key: string; label: string; type: 'text' | 'date' | 'number' | 'textarea' | 'select'; source?: string; options?: string[]; }
export interface UwStepDef {
  no: number; key: string; name: string; hint: string; roles: string[];
  checklist?: string[]; fields?: UwField[]; decisions?: string[]; photos?: boolean;
  filesLabel?: string; creditPaper?: boolean; filledBy?: string;
  recommendations?: string[]; recLabel?: string; formLabel?: string; cta: string;
}
export interface UwMeta {
  steps: UwStepDef[];
  caseStatus: Record<string, string>;
  stepStatus: Record<string, string>;
  slaDays: number;
  options?: Record<string, { id: number; name: string; applicant_type?: string; sort_order?: number; firm?: string; email?: string; phone?: string }[]>;
}
export interface UwCaseRow {
  underwriting_case_id: number; application_id: number; enquiry_id?: number | null; status: string; current_step: number;
  decision: string | null; underwriter_id: number | null; sla_due_date: string | null;
  application_ref: string | null; amount_requested: number | null; ltv_pct: number | null;
  /** Basis CHOSEN on the source enquiry: 'Gross' | 'Net' - which figure to headline (client 15-10-2026). */
  loan_basis?: string | null;
  /** Basis of amount_requested itself ('Net' only while no offer / indicative gross exists). */
  amount_basis?: string | null;
  /** Actual net: net advance, else the offer / indicative net (client 15-10-2026). */
  net_loan?: number | null;
  /** LTV incl. other charges on the securities (null when none); ltv_pct is OUR loan's LTV. */
  total_ltv_pct?: number | null;
  /** Client 17-10-2026: (gross + other charges) ÷ all security values - Case Summary only. */
  summary_total_ltv_pct?: number | null;
  first_name: string | null; last_name: string | null; company_name: string | null;
  product_name: string | null; underwriter_name: string | null; bdm_name: string | null;
  branch_name: string | null; initial_offer_note: string | null; val_status: string | null; kyc_status: string | null;
  [key: string]: unknown;
}
export interface UwStep {
  underwriting_step_id: number; step_no: number; step_key: string; status: string;
  assigned_to: number | null; assigned_role: string | null; data: string | null;
  decision: string | null; notes: string | null; started_at: string | null; completed_at: string | null;
  /** Server-computed: can the active role work this step (Roles matrix checklist permission). */
  can_act?: boolean;
  /** Server-computed: can the active role view this stage (its data is withheld when false). */
  can_view?: boolean;
}
export interface UwQuery {
  underwriting_query_id: number; step_no: number | null; description: string; status: string;
  target_role: string | null; response: string | null; responded_at: string | null; created_at: string;
}
export interface UwAudit {
  /** Optional: rows merged in from audit_logs (enquiry / application) carry audit_id instead. */
  underwriting_audit_id?: number; audit_id?: number;
  step_no: number | null; action: string; from_status: string | null;
  to_status: string | null; role_name: string | null; reason: string | null; created_at: string;
  /** Joined from users - the trail stored a user_id but never showed who. */
  user_name?: string | null;
  /** Enquiry / Application / Underwriting — where in the case this happened. */
  module?: string | null;
  details?: Record<string, unknown> | string | null;
}
export interface UwSecurity {
  security_id: number; property_address: string | null; postcode?: string | null; charge_type: string | null;
  estimated_value: number | null; gdv: number | null;
}
export interface UwCaseDetail extends UwCaseRow {
  term_months: number | null; irr_pct: number | null; branch_name: string | null; bdm_name: string | null;
  accepted_at: string | null; closed_reason: string | null;
  applicant_email: string | null; applicant_phone: string | null; applicant_type: string | null;
  property_address: string | null; estimated_value: number | null; gdv: number | null; net_advance: number | null;
  /** Every security on the application (main + other securities) — client 07-10-2026. */
  securities?: UwSecurity[];
  /** Deal-level underwriter notes scratchpad (client 07-10-2026). */
  underwriter_notes?: string | null;
  /** Signed offer letter + application form uploaded at convert (28-09-2026). */
  signed_offer_doc_id?: number | null; signed_offer_file_name?: string | null;
  /** All signed documents uploaded at convert (28-09-2026: one or more). */
  signed_offer_docs?: { id: number; file_name: string }[];
  broker_id: number | null; broker_name: string | null; broker_email: string | null; broker_company: string | null;
  /** Portfolio facility created at handoff — drives the "Go to Portfolio" button. */
  portfolio_loan_id: number | null; portfolio_loan_number: string | null;
  /** Default CC of the revised-offer e-mail (client 16-10-2026). */
  underwriter_email?: string | null; bdm_email?: string | null;
  /** "Edit loan" e-mailed a revised offer; waiting for the signed copy (client 16-10-2026). */
  revised_offer_pending?: boolean | number | null; revised_offer_id?: number | null; revised_offer_sent_at?: string | null;
  /** From the agreed terms - Funds to Broker / Funds Drawn Down (client 16-10-2026). */
  broker_fee?: number | null; broker_arrangement_share?: number | null; broker_payee_name?: string | null;
  drawdowns?: { seq?: number; month?: number | null; gross?: number | null; net?: number | null; amount?: number | null }[];
  steps: UwStep[]; queries: UwQuery[]; audit: UwAudit[];
}

/** Result of the underwriting "Edit loan" (client 16-10-2026). */
export interface UwLoanEditResult {
  id: number; version: number; emailed: boolean; email_error?: string | null; email_to?: string | null;
  offer_id?: number; offer_version?: number;
  figures?: { grossAmount: number | null; term: number | null; ratePct: number | null; net: number | null; ltvPct: number | null };
}
/** A document the Final Credit Committee e-mail can attach (client 16-10-2026). */
export interface UwCaseDocument { source: 'application' | 'underwriting' | 'enquiry'; id: number; file_name: string; label: string; step_no?: number | null; created_at?: string | null; }
export interface UwBorrowerSolicitorInput { firm: string; contact_name?: string | null; address?: string | null; telephone?: string | null; email?: string | null; sra_no?: string | null; }
export interface UwBorrowerSolicitor { id: number; name: string; firm: string; firm_name?: string; contact_name?: string | null; address?: string | null; telephone?: string | null; email?: string | null; sra_no?: string | null; sra_partners?: number | null; }
export interface UwSolicitorChecks {
  checks: Record<string, { done: boolean; notes: string; updated_at: string | null; updated_by_name: string | null }>;
  docs: { id: number; check_id: number | null; file_name: string; content_type: string | null; created_at: string }[];
}

@Injectable({ providedIn: 'root' })
export class UnderwritingApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.underwriting;

  counts(): Observable<{ byStep: Record<string, number>; credit: number; awaiting: number; total: number; portfolio?: number; closed?: number; returned?: number; onhold?: number }> {
    return this.http.get<ApiResponse<{ byStep: Record<string, number>; credit: number; awaiting: number; total: number; portfolio?: number; closed?: number; returned?: number; onhold?: number }>>(`${this.base}/meta/counts`).pipe(map((r) => r.data));
  }
  meta(): Observable<UwMeta> {
    return this.http.get<ApiResponse<UwMeta>>(`${this.base}/meta`).pipe(map((r) => r.data));
  }
  list(q: { page?: number; per_page?: number; status?: string; step?: number; assigned_to?: number; tab?: string; search?: string; mine?: boolean } = {}):
    Observable<{ rows: UwCaseRow[]; meta: ApiMeta | null }> {
    let params = new HttpParams().set('page', String(q.page ?? 1)).set('per_page', String(q.per_page ?? 50));
    if (q.status) params = params.set('status', q.status);
    if (q.step) params = params.set('step', String(q.step));
    if (q.assigned_to) params = params.set('assigned_to', String(q.assigned_to));
    if (q.tab) params = params.set('tab', q.tab);
    if (q.search) params = params.set('search', q.search);
    if (q.mine) params = params.set('mine', '1');
    return this.http.get<ApiResponse<UwCaseRow[]>>(this.base, { params }).pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }
  get(id: number | string): Observable<UwCaseDetail> {
    return this.http.get<ApiResponse<UwCaseDetail>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }
  accept(id: number | string): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/accept`, {});
  }
  rejectCase(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/reject`, body);
  }
  returnToBdm(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/return-bdm`, body);
  }
  reopenCase(id: number | string): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/reopen`, {});
  }
  holdCase(id: number | string): Observable<unknown> { return this.http.post(`${this.base}/${id}/hold`, {}); }
  resumeCase(id: number | string): Observable<unknown> { return this.http.post(`${this.base}/${id}/unhold`, {}); }
  completeMergedStep(id: number | string, body: Record<string, unknown>): Observable<{ next?: number }> {
    return this.http.post<{ data: { next?: number } }>(`${this.base}/${id}/merged-complete`, body).pipe(map((r) => r.data));
  }
  referToCredit(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/refer-to-credit`, body);
  }
  saveStep(id: number | string, stepNo: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put(`${this.base}/${id}/steps/${stepNo}`, body);
  }
  /** Deal-level underwriter notes scratchpad (client 07-10-2026). */
  saveNotes(id: number | string, body: { notes: string }): Observable<unknown> {
    return this.http.put(`${this.base}/${id}/notes`, body);
  }
  /** Client 12-10-2026: underwriter changes the Gross Loan / Net Advance; LTV is recomputed server-side. */
  updateLoan(id: number | string, body: { gross: number; net?: number | null }): Observable<{ amount_requested?: number; net_advance?: number | null; ltv_pct?: number | null }> {
    return this.http.put<ApiResponse<{ amount_requested?: number; net_advance?: number | null; ltv_pct?: number | null }>>(`${this.base}/${id}/loan`, body).pipe(map((r) => r.data));
  }
  /** Client 12-10-2026: underwriter edited the full indicative — save a new version, email the
   *  borrower, push the figures onto the application + loan, and audit. */
  /** Client 16-10-2026: saves the new terms and e-mails ONLY a revised offer letter to the
   *  broker (cc = underwriter + BDM by default) - nothing in underwriting is reset. */
  saveIndicativeEdit(id: number | string, inputs: Record<string, unknown>, cc?: string[]): Observable<UwLoanEditResult> {
    return this.http.post<ApiResponse<UwLoanEditResult>>(`${this.base}/${id}/indicative`, { inputs, cc }).pipe(map((r) => r.data));
  }
  /** Upload the signed revised offer - saved as the next Signed Offer version (client 16-10-2026). */
  uploadRevisedSignedOffer(id: number | string, files: { file_name: string; content_base64: string }[]): Observable<{ ids: number[]; version: string }> {
    return this.http.post<ApiResponse<{ ids: number[]; version: string }>>(`${this.base}/${id}/revised-offer/signed`, { files }).pipe(map((r) => r.data));
  }
  /** Step 6: e-mail the final credit paper to the Head of Application users.
   *  Client 16-10-2026: + case documents to attach, extra uploaded files and e-mail notes. */
  sendFinalCreditPaper(id: number | string, emails?: string[], extra: { documents?: { source: string; id: number }[]; uploads?: { file_name: string; content_base64: string; content_type?: string }[]; notes?: string } = {}): Observable<{ sentTo?: number; to?: string; attachments?: number }> {
    return this.http.post<ApiResponse<{ sentTo?: number; to?: string; attachments?: number }>>(`${this.base}/${id}/send-credit-paper`, { emails: emails || [], ...extra }).pipe(map((r) => r.data));
  }
  /** Every document on the case (application + underwriting uploads) — committee picker. */
  caseDocuments(id: number | string): Observable<UwCaseDocument[]> {
    return this.http.get<ApiResponse<UwCaseDocument[]>>(`${this.base}/${id}/documents`).pipe(map((r) => r.data ?? []));
  }
  /** Borrower's Solicitor master add / edit from the Solicitor Quote step (client 16-10-2026). */
  createBorrowerSolicitor(payload: UwBorrowerSolicitorInput): Observable<UwBorrowerSolicitor> {
    return this.http.post<ApiResponse<UwBorrowerSolicitor>>(`${this.base}/borrower-solicitors`, payload).pipe(map((r) => r.data));
  }
  updateBorrowerSolicitor(solId: number, payload: UwBorrowerSolicitorInput): Observable<UwBorrowerSolicitor> {
    return this.http.put<ApiResponse<UwBorrowerSolicitor>>(`${this.base}/borrower-solicitors/${solId}`, payload).pipe(map((r) => r.data));
  }
  /** Checks + evidence saved for a solicitor across every case. */
  borrowerSolicitorChecks(solId: number): Observable<UwSolicitorChecks> {
    return this.http.get<ApiResponse<UwSolicitorChecks>>(`${this.base}/borrower-solicitors/${solId}/checks`).pipe(map((r) => r.data));
  }
  saveBorrowerSolicitorCheck(solId: number, checkId: number, body: { done: boolean; notes?: string | null; case_id?: number }): Observable<unknown> {
    return this.http.put(`${this.base}/borrower-solicitors/${solId}/checks/${checkId}`, body);
  }
  uploadBorrowerSolicitorDoc(solId: number, checkId: number, body: { file_name: string; content_base64: string; content_type?: string; case_id?: number }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/borrower-solicitors/${solId}/checks/${checkId}/docs`, body).pipe(map((r) => r.data));
  }
  downloadBorrowerSolicitorDoc(solId: number, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/borrower-solicitors/${solId}/docs/${docId}/download`, { responseType: 'blob' });
  }
  deleteBorrowerSolicitorDoc(solId: number, docId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/borrower-solicitors/${solId}/docs/${docId}`);
  }
  /** Solicitor Quote "Additional costs" names (Masters > Solicitor Cost Types). */
  createSolicitorCostType(name: string): Observable<{ id: number; name: string }> {
    return this.http.post<ApiResponse<{ id: number; name: string }>>(`${this.base}/solicitor-cost-types`, { name }).pipe(map((r) => r.data));
  }
  updateSolicitorCostType(typeId: number, name: string): Observable<{ id: number; name: string }> {
    return this.http.put<ApiResponse<{ id: number; name: string }>>(`${this.base}/solicitor-cost-types/${typeId}`, { name }).pipe(map((r) => r.data));
  }
  /** Step 5: upload an updated Credit Deal Summary (stored as a DEAL_SUMMARY doc). */
  uploadCreditSummary(id: number | string, body: { file_name: string; content_base64: string; content_type?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/credit-summary`, body);
  }
  /** Quick-add a Surveyor / Valuer firm from the Valuation Instruction step. */
  createValuerFirm(payload: { name: string; firm?: string; email?: string; phone?: string }): Observable<{ id: number; name: string }> {
    return this.http.post<ApiResponse<{ id: number; name: string }>>(`${this.base}/valuer-firms`, payload).pipe(map((r) => r.data));
  }
  /** Edit an existing Surveyor / Valuer firm in place (Valuation Instruction step). */
  updateValuerFirm(id: number, payload: { name: string; firm?: string; email?: string; phone?: string }): Observable<{ id: number; name: string; firm?: string; email?: string; phone?: string }> {
    return this.http.put<ApiResponse<{ id: number; name: string; firm?: string; email?: string; phone?: string }>>(`${this.base}/valuer-firms/${id}`, payload).pipe(map((r) => r.data));
  }
  createSolicitor(payload: { name: string; firm?: string; email?: string; phone?: string }): Observable<{ id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }> {
    return this.http.post<ApiResponse<{ id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }>>(`${this.base}/solicitors`, payload).pipe(map((r) => r.data));
  }
  updateSolicitor(id: number, payload: { name: string; firm?: string; email?: string; phone?: string }): Observable<{ id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }> {
    return this.http.put<ApiResponse<{ id: number; name: string; sol_name?: string; firm?: string; email?: string; phone?: string }>>(`${this.base}/solicitors/${id}`, payload).pipe(map((r) => r.data));
  }
  /** Send the requirements pack (broker when set, otherwise the applicant(s)). */
  sendBroker(id: number | string): Observable<{ to: string; broker?: boolean | string; recipients?: number }> {
    return this.http.post<ApiResponse<{ to: string; broker?: boolean | string; recipients?: number }>>(`${this.base}/${id}/send-broker`, {}).pipe(map((r) => r.data));
  }
  completeStep(id: number | string, stepNo: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/steps/${stepNo}/complete`, body);
  }
  decide(id: number | string, stepNo: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/steps/${stepNo}/decide`, body);
  }
  listPhotos(id: number | string, step?: number): Observable<{ id: number; step_no: number | null; file_name: string; content_type: string | null; doc_tag: string | null; created_at: string }[]> {
    let params = new HttpParams();
    if (step != null) params = params.set('step', String(step));
    return this.http.get<ApiResponse<{ id: number; step_no: number | null; file_name: string; content_type: string | null; doc_tag: string | null; created_at: string }[]>>(`${this.base}/${id}/photos`, { params }).pipe(map((r) => r.data ?? []));
  }
  uploadPhoto(id: number | string, body: { step_no: number; file_name: string; content_base64: string; content_type?: string; doc_tag?: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/photos`, body).pipe(map((r) => r.data));
  }
  photoUrl(id: number | string, docId: number): string { return `${this.base}/${id}/photos/${docId}/download`; }
  /** Signed offer + application form (one file) uploaded when the enquiry was converted. */
  signedOffer(id: number | string, docId?: number | null): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/signed-offer${docId ? '/' + docId : ''}`, { responseType: 'blob' });
  }
  /** Generate + download the Credit Paper (.docx) with numbers pre-filled (client 09-10-2026). */
  downloadCreditPaper(id: number | string): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/credit-paper.docx`, { responseType: 'blob' });
  }
  downloadPhoto(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/photos/${docId}/download`, { responseType: 'blob' });
  }
  deletePhoto(id: number | string, docId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/${id}/photos/${docId}`);
  }

  raiseQuery(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/queries`, body);
  }
  respondQuery(id: number | string, queryId: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/queries/${queryId}/respond`, body);
  }
}
