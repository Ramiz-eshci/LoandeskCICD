import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../core/models/api-response.model';

/** Portfolio Extensions workflow (client 30-09-2026). Mirrors api/services/extension.service.js. */
export type ExtensionStatus = 'Draft' | 'Agreement Sent' | 'Agreement Signed' | 'Pending Approval' | 'Approved' | 'Rejected' | 'Cancelled';
export type FeeType = 'PCT' | 'AMOUNT';
export type Timing = 'Upfront' | 'Retained';

export interface ExtensionPaper {
  case_owner?: string;
  funding_line?: string;
  borrower_name?: string;
  borrower_background?: string;
  security_address?: string;
  purchase_info?: string;
  title_number?: string;
  value_text?: string;
  valuation_type?: string;
  valuer?: string;
  site_visit?: string;
  deal_type?: string;
  property_description?: string;
  extension_request?: string;
  credit_recommendation?: string;
}

export interface ExtensionDoc {
  ext_doc_id: number;
  kind: 'AGREEMENT' | 'SIGNED_AGREEMENT' | 'REQUEST_PAPER' | 'EXIT_EVIDENCE' | 'OTHER';
  app_document_id: number;
  file_name: string;
  created_at: string;
  uploaded_by_name: string;
}

export interface Extension {
  extension_id: number;
  extension_ref: string;
  loan_id: number;
  loan_number: string;
  application_id: number;
  application_ref: string;
  applicant_id: number;
  customer_name: string;
  customer_email: string | null;
  broker_email: string | null;
  broker_name: string | null;
  loan_status: string;
  loan_start_date: string | null;
  loan_maturity_date: string | null;
  status: ExtensionStatus;
  current_maturity: string | null;
  extension_months: number;
  new_maturity: string | null;
  gross_amount: number | null;
  net_amount: number | null;
  monthly_rate_pct: number | null;
  ext_fee_type: FeeType;
  ext_fee_value: number | null;
  ext_fee_amount: number | null;
  ext_fee_timing: Timing;
  ext_fee_due_date: string | null;
  doc_fee_type: FeeType;
  doc_fee_value: number | null;
  doc_fee_amount: number | null;
  doc_fee_timing: Timing;
  doc_fee_due_date: string | null;
  interest_treatment: 'Serviced' | 'Retained';
  monthly_interest: number | null;
  /** Gross once the Retained fees are added (client 28-10-2026). */
  gross_after?: number | null;
  retained_fees?: number | null;
  completed_at?: string | null;
  /** Approved, upfront fee(s) still unpaid. */
  awaiting_fees?: boolean;
  payment_schedule?: ExtensionPaymentSchedule;
  first_payment_date: string | null;
  exit_plan: string | null;
  agreement_date: string | null;
  agreement_sent_to: string | null;
  agreement_sent_at: string | null;
  agreement_document_id: number | null;
  signed_document_id: number | null;
  request_document_id: number | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  decision: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  applied_at: string | null;
  created_at: string;
  created_by_name: string | null;
  editable: boolean;
  open: boolean;
  paper: ExtensionPaper;
  terms: { interest: string | null; extension_fee: string | null; document_fee: string | null };
  documents?: ExtensionDoc[];
}

export interface HeadUser { user_id: number; full_name: string; email: string; }

/** A fee the extension raised on the facility (client 28-10-2026). Capitalised = retained into the gross. */
export interface ExtensionFeeRow {
  fee_id: number;
  fee_type: string;
  amount: number;
  due_date: string | null;
  status: 'Due' | 'Paid' | 'Waived' | 'Capitalised' | string;
  notes: string | null;
  paid_on: string | null;
  paid_method: string | null;
  paid_reference: string | null;
  paid_at: string | null;
}
export interface ExtensionInstalment {
  schedule_id: number;
  installment_no: number;
  due_date: string | null;
  interest_due: number;
  total_due: number;
  status: string;
}
export interface ExtensionPaymentSchedule {
  fees: ExtensionFeeRow[];
  instalments: ExtensionInstalment[];
  upfront_total: number;
  upfront_paid: number;
  upfront_due: number;
}
export const PAY_METHODS = ['Bank Transfer', 'Card', 'Cheque', 'Cash', 'Other'];

export interface ExtensionCounts { open: number; pending: number; fees?: number; decided: number; cancelled: number; all: number; is_head: boolean }

export interface ExtensionSavePayload {
  extension_months: number;
  ext_fee_type: FeeType;
  ext_fee_value: number | null;
  ext_fee_timing: Timing;
  ext_fee_due_date: string | null;
  doc_fee_type: FeeType;
  doc_fee_value: number | null;
  doc_fee_timing: Timing;
  doc_fee_due_date: string | null;
  interest_treatment: 'Serviced' | 'Retained';
  monthly_rate_pct: number | null;
  monthly_interest: number | null;
  first_payment_date: string | null;
  agreement_date: string | null;
  exit_plan: string | null;
  paper: ExtensionPaper;
}

@Injectable({ providedIn: 'root' })
export class ExtensionService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.extensions;

  list(q: { view?: string; search?: string; page?: number; per_page?: number } = {}): Observable<{ rows: Extension[]; meta: ApiMeta | null }> {
    let params = new HttpParams().set('page', String(q.page ?? 1)).set('per_page', String(q.per_page ?? 10)).set('view', q.view || 'open');
    if (q.search) params = params.set('search', q.search);
    return this.http.get<ApiResponse<Extension[]>>(this.base, { params }).pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  counts(): Observable<ExtensionCounts> {
    return this.http.get<ApiResponse<ExtensionCounts>>(`${this.base}/counts`).pipe(map((r) => r.data));
  }

  get(id: number | string): Observable<Extension> {
    return this.http.get<ApiResponse<Extension>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }

  /** Raise an extension on a facility (loan_number or loan_id). */
  create(loanKey: string | number, payload: { extension_months: number; reason: string; exit_plan: string }): Observable<{ id: number; ref: string }> {
    return this.http.post<ApiResponse<{ id: number; ref: string }>>(`${this.base}/facilities/${loanKey}`, payload).pipe(map((r) => r.data));
  }

  save(id: number, payload: ExtensionSavePayload): Observable<Extension> {
    return this.http.put<ApiResponse<Extension>>(`${this.base}/${id}`, payload).pipe(map((r) => r.data));
  }

  agreementPdf(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/agreement.pdf`, { responseType: 'blob' });
  }

  requestPdf(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/request.pdf`, { responseType: 'blob' });
  }

  sendAgreement(id: number, payload: { to: string; cc: string; message: string; send_email: boolean; recipient?: 'broker' | 'borrower' }): Observable<{ emailed: boolean; error?: string }> {
    return this.http.post<ApiResponse<{ emailed: boolean; error?: string }>>(`${this.base}/${id}/send-agreement`, payload).pipe(map((r) => r.data));
  }

  upload(id: number, payload: { kind: string; file_name: string; content_base64: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/documents`, payload).pipe(map((r) => r.data));
  }

  download(id: number, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/documents/${docId}/download`, { responseType: 'blob' });
  }

  deleteDoc(id: number, docId: number): Observable<boolean> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${id}/documents/${docId}`).pipe(map((r) => r.status));
  }

  /** Head of Extension users - the Send popup's checkboxes (client 27-10-2026). */
  headUsers(): Observable<HeadUser[]> {
    return this.http.get<ApiResponse<HeadUser[]>>(`${this.base}/head-users`).pipe(map((r) => r.data ?? []));
  }

  submit(id: number, payload: { message: string; heads: number[]; to?: string; cc?: string }): Observable<{ sentTo: number; heads: number; error?: string }> {
    return this.http.post<ApiResponse<{ sentTo: number; heads: number; error?: string }>>(`${this.base}/${id}/submit`, payload).pipe(map((r) => r.data));
  }

  decide(id: number, decision: 'approve' | 'reject', notes: string): Observable<{ status: string }> {
    return this.http.post<ApiResponse<{ status: string }>>(`${this.base}/${id}/decision`, { decision, notes }).pipe(map((r) => r.data));
  }

  /** Payment schedule: mark an upfront fee Paid; returns the refreshed extension. */
  markFeePaid(id: number, feeId: number, payload: { paid_on: string; method: string; reference: string }): Observable<Extension> {
    return this.http.post<ApiResponse<Extension>>(`${this.base}/${id}/fees/${feeId}/paid`, payload).pipe(map((r) => r.data));
  }

  cancel(id: number, reason: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/cancel`, { reason }).pipe(map((r) => r.data));
  }
}

/** Status -> ui-badge tone. */
export function extensionTone(s: string): 'approved' | 'pending' | 'declined' | 'active' | 'review' | 'info' | 'closed' | 'completed' {
  switch (s) {
    case 'Awaiting Fees': return 'pending';
    case 'Approved': return 'approved';
    case 'Rejected': return 'declined';
    case 'Cancelled': return 'closed';
    case 'Pending Approval': return 'review';
    case 'Agreement Signed': return 'active';
    case 'Agreement Sent': return 'pending';
    default: return 'info';
  }
}
