import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../core/models/api-response.model';
import {
  ConvertResult,
  Enquiry,
  EnquiryAuditRow,
  EnquiryFormOptions,
  SolicitorOption,
  CreditNotes,
  EnquiryListRow,
  EnquiryNote,
  IndicativeResult,
  IndicativeVersion,
  OfferVersion,
} from './enquiries-list/enquiry.model';

export interface EnquiryPage {
  rows: EnquiryListRow[];
  meta: ApiMeta | null;
}

export interface EnquiryListQuery {
  page?: number;
  per_page?: number;
  search?: string;
  status_code?: string;
  assigned_to?: number | string;
  branch_id?: number;
  product_id?: number;
  source_id?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  /** "My deals" toggle: only enquiries assigned to the current user. */
  mine?: boolean;
}

/** Enquiry Module (Module-4) — wired to /api/enquiries. */
@Injectable({ providedIn: 'root' })
export class EnquiriesService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.enquiries;

  list(q: EnquiryListQuery = {}): Observable<EnquiryPage> {
    let params = new HttpParams()
      .set('page', String(q.page ?? 1))
      .set('per_page', String(q.per_page ?? 10));
    if (q.search) params = params.set('search', q.search);
    if (q.status_code) params = params.set('status_code', q.status_code);
    if (q.assigned_to !== undefined && q.assigned_to !== '') params = params.set('assigned_to', String(q.assigned_to));
    if (q.branch_id) params = params.set('branch_id', String(q.branch_id));
    if (q.product_id) params = params.set('product_id', String(q.product_id));
    if (q.source_id) params = params.set('source_id', String(q.source_id));
    if (q.sort) params = params.set('sort', q.sort);
    if (q.dir) params = params.set('dir', q.dir);
    if (q.mine) params = params.set('mine', '1');
    return this.http
      .get<ApiResponse<EnquiryListRow[]>>(this.base, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  get(id: number | string): Observable<Enquiry> {
    return this.http.get<ApiResponse<Enquiry>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }

  create(body: Record<string, unknown>): Observable<{ id: number; enquiry_ref: string }> {
    return this.http.post<ApiResponse<{ id: number; enquiry_ref: string }>>(this.base, body).pipe(map((r) => r.data));
  }

  update(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${id}`, body).pipe(map((r) => r.data));
  }

  /** Email an information request to the BDM, broker or applicant. */
  requestInfo(id: number | string, body: {
    send_to: string; items: string[]; comments?: string; due_date?: string;
  }): Observable<{ sent_to: string; recipient: string }> {
    return this.http.post<ApiResponse<{ sent_to: string; recipient: string }>>(
      `${this.base}/${id}/request-info`, body,
    ).pipe(map((r) => r.data));
  }

  /** Full audit trail: edits, status changes, indicatives, offers, emails. */
  audit(id: number | string): Observable<EnquiryAuditRow[]> {
    return this.http.get<ApiResponse<EnquiryAuditRow[]>>(`${this.base}/${id}/audit`).pipe(map((r) => r.data ?? []));
  }
  assign(id: number | string, assigned_to: number, note?: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/assign`, { assigned_to, note }).pipe(map((r) => r.data));
  }

  changeStatus(id: number | string, status: string, reason?: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/status`, { status, reason }).pipe(map((r) => r.data));
  }

  /** Decline with master reasons (at least one) + optional notes. */
  decline(id: number | string, reason_ids: number[], notes?: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/decline`, { reason_ids, notes }).pipe(map((r) => r.data));
  }

  /** Delete an enquiry made by mistake (not allowed once converted). */
  remove(id: number | string): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }

  /** Bring a declined enquiry back alive (restores its pre-decline status). */
  reopen(id: number | string, note?: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/reopen`, { note }).pipe(map((r) => r.data));
  }

  addNote(id: number | string, note: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/notes`, { note }).pipe(map((r) => r.data));
  }

  convertCheck(id: number | string): Observable<{ ready: boolean; missing: { field: string; label: string }[] }> {
    return this.http
      .get<ApiResponse<{ ready: boolean; missing: { field: string; label: string }[] }>>(`${this.base}/${id}/convert-check`)
      .pipe(map((r) => r.data));
  }

  /** signedOffers: signed offer letter, completed application form, … (one or more files, required). */
  convert(id: number | string, signedOffers: { file_name: string; content_base64: string }[], summaryNotes = '', creditNotes: Partial<CreditNotes> = {}): Observable<ConvertResult> {
    return this.http.post<ApiResponse<ConvertResult>>(`${this.base}/${id}/convert`, { signed_offers: signedOffers, summary_notes: summaryNotes, credit_notes: creditNotes })
      .pipe(map((r) => r.data));
  }

  uploadDocument(id: number | string, body: { file_name: string; content_base64: string; document_type_id: number | null; document_type_name?: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/documents`, body).pipe(map((r) => r.data));
  }

  /** Client 16-10-2026: any indicative version as PDF (also ones never e-mailed). */
  indicativePdf(id: number | string, vid: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/indicative/${vid}/pdf`, { responseType: 'blob' });
  }

  downloadDocument(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/documents/${docId}/download`, { responseType: 'blob' });
  }

  updateDocument(id: number | string, docId: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.patch<ApiResponse<unknown>>(`${this.base}/${id}/documents/${docId}`, body).pipe(map((r) => r.data));
  }

  deleteDocument(id: number | string, docId: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${id}/documents/${docId}`).pipe(map((r) => r.data));
  }

  saveOffer(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/offer`, body).pipe(map((r) => r.data));
  }

  // ---- Indicatives ----
  previewIndicative(id: number | string, inputs: Record<string, unknown>): Observable<IndicativeResult> {
    return this.http.post<ApiResponse<IndicativeResult>>(`${this.base}/${id}/indicative/preview`, { inputs }).pipe(map((r) => r.data));
  }
  saveIndicative(id: number | string, inputs: Record<string, unknown>): Observable<{ id: number; version: number; data: IndicativeResult }> {
    return this.http.post<ApiResponse<{ id: number; version: number; data: IndicativeResult }>>(`${this.base}/${id}/indicative`, { inputs }).pipe(map((r) => r.data));
  }
  listIndicatives(id: number | string): Observable<IndicativeVersion[]> {
    return this.http.get<ApiResponse<IndicativeVersion[]>>(`${this.base}/${id}/indicative`).pipe(map((r) => r.data));
  }
  sendIndicative(id: number | string, vid: number, notes?: string | null): Observable<{ emailed: boolean; error?: string }> {
    return this.http.post<ApiResponse<{ emailed: boolean; error?: string }>>(`${this.base}/${id}/indicative/${vid}/send`, { notes: (notes || '').trim() || null }).pipe(map((r) => r.data));
  }

  // ---- Offers (versioned + emailed) ----
  saveOfferVersion(id: number | string, offerBody: Record<string, unknown>): Observable<{ id: number; version: number; offer: Record<string, unknown> }> {
    return this.http.post<ApiResponse<{ id: number; version: number; offer: Record<string, unknown> }>>(`${this.base}/${id}/offer-version`, { offer: offerBody }).pipe(map((r) => r.data));
  }
  listOffers(id: number | string): Observable<OfferVersion[]> {
    return this.http.get<ApiResponse<OfferVersion[]>>(`${this.base}/${id}/offers`).pipe(map((r) => r.data));
  }
  sendOfferVersion(id: number | string, vid: number): Observable<{ emailed: boolean; error?: string }> {
    return this.http.post<ApiResponse<{ emailed: boolean; error?: string }>>(`${this.base}/${id}/offer/${vid}/send`, {}).pipe(map((r) => r.data));
  }
  resendOffer(id: number | string, vid: number): Observable<{ emailed: boolean; error?: string }> {
    return this.http.post<ApiResponse<{ emailed: boolean; error?: string }>>(`${this.base}/${id}/offer/${vid}/resend`, {}).pipe(map((r) => r.data));
  }
  acceptOffer(id: number | string, vid: number): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/offer/${vid}/accept`, {}).pipe(map((r) => r.data));
  }

  formOptions(): Observable<EnquiryFormOptions> {
    return this.http.get<ApiResponse<EnquiryFormOptions>>(`${this.base}/meta/form-options`).pipe(map((r) => r.data));
  }

  createBroker(payload: { name: string; email?: string; phone?: string; company?: string; address?: string; fca_number?: string }): Observable<{ id: number; name: string; company?: string }> {
    return this.http.post<ApiResponse<{ id: number; name: string; company?: string }>>(`${this.base}/brokers`, payload).pipe(map((r) => r.data));
  }

  /** Borrower's solicitor master quick add / edit (client 15-10-2026). */
  createSolicitor(payload: Omit<SolicitorOption, 'id'>): Observable<SolicitorOption> {
    return this.http.post<ApiResponse<SolicitorOption>>(`${this.base}/solicitors`, payload).pipe(map((r) => r.data));
  }
  updateSolicitor(id: number, payload: Omit<SolicitorOption, 'id'>): Observable<SolicitorOption> {
    return this.http.put<ApiResponse<SolicitorOption>>(`${this.base}/solicitors/${id}`, payload).pipe(map((r) => r.data));
  }

  /** Update an existing broker in place (edit icon on the broker dropdown). */
  updateBroker(id: number, payload: { name: string; email?: string; phone?: string; company?: string; address?: string; fca_number?: string }):
    Observable<{ id: number; name: string; company?: string; email?: string; phone?: string }> {
    return this.http.put<ApiResponse<{ id: number; name: string; company?: string; email?: string; phone?: string }>>(`${this.base}/brokers/${id}`, payload).pipe(map((r) => r.data));
  }

  counts(mine = false): Observable<{ total: number; byCode: Record<string, number> }> {
    const params = mine ? new HttpParams().set('mine', '1') : undefined;
    return this.http
      .get<ApiResponse<{ total: number; byCode: Record<string, number> }>>(`${this.base}/meta/counts`, { params })
      .pipe(map((r) => r.data));
  }
}

export type { EnquiryNote };
