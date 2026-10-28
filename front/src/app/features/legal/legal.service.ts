import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';
import { CreditPaperResponse, LegalCaseDetail, LegalCondition, LegalPipelineResponse } from './legal-list/legal-case.model';

/** Legal & Completion module — wired to /api/legal. */
@Injectable({ providedIn: 'root' })
export class LegalService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.legal;

  list(q: { tab?: string; page?: number; per_page?: number } = {}): Observable<LegalPipelineResponse> {
    const params: Record<string, string> = { page: String(q.page ?? 1), per_page: String(q.per_page ?? 10) };
    if (q.tab) params['tab'] = q.tab;
    return this.http.get<ApiResponse<LegalPipelineResponse>>(this.base, { params }).pipe(map((r) => r.data));
  }
  get(id: number): Observable<LegalCaseDetail> {
    return this.http.get<ApiResponse<LegalCaseDetail>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }
  conditions(id: number): Observable<LegalCondition[]> {
    return this.http.get<ApiResponse<LegalCaseDetail>>(`${this.base}/${id}`).pipe(map((r) => r.data.conditions ?? []));
  }
  setStage(id: number, stage: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/stage`, { stage }).pipe(map((r) => r.data));
  }
  addCondition(id: number, name: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/conditions`, { name }).pipe(map((r) => r.data));
  }
  toggleCondition(id: number, condId: number): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/conditions/${condId}/toggle`, {}).pipe(map((r) => r.data));
  }
  complete(id: number): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/complete`, {}).pipe(map((r) => r.data));
  }
  /** Credit Paper — an uploaded document held on underwriting step 8. */
  creditPaper(id: number): Observable<CreditPaperResponse> {
    return this.http.get<ApiResponse<CreditPaperResponse>>(`${this.base}/${id}/credit-paper`).pipe(map((r) => r.data));
  }
  uploadCreditPaper(id: number, body: { file_name: string; content_base64: string; content_type?: string }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/credit-paper/documents`, body).pipe(map((r) => r.data));
  }
  downloadCreditPaper(id: number, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/credit-paper/documents/${docId}/download`, { responseType: 'blob' });
  }
  deleteCreditPaper(id: number, docId: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${id}/credit-paper/documents/${docId}`).pipe(map((r) => r.data));
  }
}
