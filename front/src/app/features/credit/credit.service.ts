import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';
import { CreditPaper, CreditQueueResponse, CreditDecisionValue } from './credit-list/credit.model';

/** Credit Approval module — wired to /api/credit. */
@Injectable({ providedIn: 'root' })
export class CreditService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.credit;

  list(q: { tab?: string; page?: number; per_page?: number } = {}): Observable<CreditQueueResponse> {
    const params: Record<string, string> = { page: String(q.page ?? 1), per_page: String(q.per_page ?? 10) };
    if (q.tab) params['tab'] = q.tab;
    return this.http.get<ApiResponse<CreditQueueResponse>>(this.base, { params }).pipe(map((r) => r.data));
  }
  paper(id: number): Observable<CreditPaper> {
    return this.http.get<ApiResponse<CreditPaper>>(`${this.base}/${id}/paper`).pipe(map((r) => r.data));
  }
  decide(id: number, body: { decision: CreditDecisionValue; comments: string; conditions?: string }): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base}/${id}/decide`, body).pipe(map((r) => r.data));
  }
}
