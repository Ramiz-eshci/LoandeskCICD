import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';
import { Valuation } from './valuations-list/valuation.model';

/** One server page of valuations + counts over ALL valuations (KPIs / tab badges). */
export interface ValuationPage {
  rows: Valuation[];
  meta: { page: number; per_page: number; total: number; total_pages: number } | null;
  counts: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class ValuationsApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.valuations;

  list(q: { tab?: string; page?: number; per_page?: number } = {}): Observable<ValuationPage> {
    const params: Record<string, string> = { page: String(q.page ?? 1), per_page: String(q.per_page ?? 10) };
    if (q.tab) params['tab'] = q.tab;
    return this.http.get<ApiResponse<ValuationPage>>(this.base, { params })
      .pipe(map((r) => r.data ?? { rows: [], meta: null, counts: {} }));
  }
  decide(id: number, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/${id}/decision`, body);
  }
}
