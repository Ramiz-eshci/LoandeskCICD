import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../core/models/api-response.model';
import {
  ApplicationDetail,
  ApplicationFormOptions,
  ApplicationListRow,
} from './applications-list/application.model';

export interface ApplicationPage {
  rows: ApplicationListRow[];
  meta: ApiMeta | null;
}

export interface ApplicationListQuery {
  page?: number;
  per_page?: number;
  search?: string;
  stage?: string;
  status_code?: string;
  assigned_to?: number;
  underwriter_id?: number;
  branch_id?: number;
  product_id?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
  /** "My deals" toggle: only applications where the current user is the BDM. */
  mine?: boolean;
}

/** Application Module (Module-5) — wired to /api/applications. */
@Injectable({ providedIn: 'root' })
export class ApplicationsService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.applications;

  list(q: ApplicationListQuery = {}): Observable<ApplicationPage> {
    let params = new HttpParams()
      .set('page', String(q.page ?? 1))
      .set('per_page', String(q.per_page ?? 10));
    if (q.search) params = params.set('search', q.search);
    if (q.stage) params = params.set('stage', q.stage);
    if (q.status_code) params = params.set('status_code', q.status_code);
    if (q.assigned_to) params = params.set('assigned_to', String(q.assigned_to));
    if (q.underwriter_id) params = params.set('underwriter_id', String(q.underwriter_id));
    if (q.branch_id) params = params.set('branch_id', String(q.branch_id));
    if (q.product_id) params = params.set('product_id', String(q.product_id));
    if (q.sort) params = params.set('sort', q.sort);
    if (q.dir) params = params.set('dir', q.dir);
    if (q.mine) params = params.set('mine', '1');
    return this.http
      .get<ApiResponse<ApplicationListRow[]>>(this.base, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  get(id: number | string): Observable<ApplicationDetail> {
    return this.http.get<ApiResponse<ApplicationDetail>>(`${this.base}/${id}`).pipe(map((r) => r.data));
  }

  create(body: Record<string, unknown>): Observable<{ id: number; application_ref: string }> {
    return this.http.post<ApiResponse<{ id: number; application_ref: string }>>(this.base, body).pipe(map((r) => r.data));
  }

  update(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${id}`, body).pipe(map((r) => r.data));
  }

  updateApplicant(id: number | string, applicantId: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${id}/applicant/${applicantId}`, body).pipe(map((r) => r.data));
  }

  updateSecurity(id: number | string, securityId: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${id}/security/${securityId}`, body).pipe(map((r) => r.data));
  }

  updateDirector(id: number | string, directorId: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${id}/directors/${directorId}`, body).pipe(map((r) => r.data));
  }

  downloadOfferDoc(id: number | string, docId: number): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/offer-document/${docId}`, { responseType: 'blob' });
  }

  changeStatus(id: number | string, status: string, reason?: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/status`, { status, reason }).pipe(map((r) => r.data));
  }

  addTask(id: number | string, body: Record<string, unknown>): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/tasks`, body).pipe(map((r) => r.data));
  }

  updateTask(id: number | string, taskId: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.patch<ApiResponse<unknown>>(`${this.base}/${id}/tasks/${taskId}`, body).pipe(map((r) => r.data));
  }

  addCommunication(id: number | string, body: Record<string, unknown>): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/communications`, body).pipe(map((r) => r.data));
  }

  addNote(id: number | string, note: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/notes`, { note }).pipe(map((r) => r.data));
  }
  requestInfo(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/request-info`, body).pipe(map((r) => r.data));
  }

  uploadDocument(id: number | string, body: { file_name: string; content_base64: string; document_type_id: number | null }): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${id}/documents`, body).pipe(map((r) => r.data));
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

  formOptions(): Observable<ApplicationFormOptions> {
    return this.http.get<ApiResponse<ApplicationFormOptions>>(`${this.base}/meta/form-options`).pipe(map((r) => r.data));
  }

  counts(mine = false): Observable<{ total: number; byStage: Record<string, number> }> {
    const params = mine ? new HttpParams().set('mine', '1') : undefined;
    return this.http
      .get<ApiResponse<{ total: number; byStage: Record<string, number> }>>(`${this.base}/meta/counts`, { params })
      .pipe(map((r) => r.data));
  }
}
