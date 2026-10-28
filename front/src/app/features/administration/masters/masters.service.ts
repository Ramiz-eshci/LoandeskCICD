import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { API } from '../../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../../core/models/api-response.model';

export interface MasterPage {
  rows: Record<string, unknown>[];
  meta: ApiMeta | null;
}

/** Generic master CRUD client -> /api/masters/:key. */
@Injectable({ providedIn: 'root' })
export class MastersService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.masters;

  list(key: string, opts: { page?: number; search?: string; perPage?: number; activeOnly?: boolean } = {}): Observable<MasterPage> {
    let params = new HttpParams().set('page', String(opts.page ?? 1)).set('per_page', String(opts.perPage ?? 20));
    if (opts.search) params = params.set('search', opts.search);
    if (opts.activeOnly) params = params.set('active', '1'); // dropdowns: only active master rows
    return this.http
      .get<ApiResponse<Record<string, unknown>[]>>(`${this.base}/${key}`, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta })));
  }

  get(key: string, id: number | string): Observable<Record<string, unknown>> {
    return this.http.get<ApiResponse<Record<string, unknown>>>(`${this.base}/${key}/${id}`).pipe(map((r) => r.data));
  }

  create(key: string, body: Record<string, unknown>): Observable<{ id: number }> {
    return this.http.post<ApiResponse<{ id: number }>>(`${this.base}/${key}`, body).pipe(map((r) => r.data));
  }

  update(key: string, id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base}/${key}/${id}`, body).pipe(map((r) => r.data));
  }

  deactivate(key: string, id: number | string, active = false): Observable<unknown> {
    return this.http.request<ApiResponse<unknown>>('delete', `${this.base}/${key}/${id}`, { body: { is_active: active } }).pipe(map((r) => r.data));
  }

  /** Delete: gone from the list and dropdowns (cannot be reactivated). */
  remove(key: string, id: number | string): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base}/${key}/${id}/record`).pipe(map((r) => r.data));
  }
}
