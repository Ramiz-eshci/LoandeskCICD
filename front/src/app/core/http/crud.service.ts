import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';

/**
 * Generic REST resource client. Every LoanDesk CRUD domain exposes the same
 * five routes (see api/routes/*.routes.js), so feature services just extend
 * this with their base path:
 *
 *   GET    /            -> list
 *   GET    /:id         -> getById
 *   POST   /            -> create
 *   PUT    /:id         -> update
 *   DELETE /:id         -> remove
 *
 * Bodies/responses are unwrapped from the uniform ApiResponse envelope. When
 * transport encryption is on, the crypto interceptor has already sealed the
 * request and opened the response by the time we get here.
 */
export abstract class CrudService<T> {
  protected readonly http = inject(HttpClient);
  private readonly url = environment.apiBaseUrl + this.resourcePath();

  /** e.g. '/category' — implemented by each feature service. */
  protected abstract resourcePath(): string;

  list(): Observable<T[]> {
    return this.http.get<ApiResponse<T[]>>(this.url).pipe(map((r) => r.data ?? []));
  }

  getById(id: string | number): Observable<T> {
    return this.http.get<ApiResponse<T>>(`${this.url}/${id}`).pipe(map((r) => r.data));
  }

  create(payload: Partial<T>): Observable<T> {
    return this.http.post<ApiResponse<T>>(this.url, payload).pipe(map((r) => r.data));
  }

  update(id: string | number, payload: Partial<T>): Observable<T> {
    return this.http.put<ApiResponse<T>>(`${this.url}/${id}`, payload).pipe(map((r) => r.data));
  }

  remove(id: string | number): Observable<boolean> {
    return this.http.delete<ApiResponse<unknown>>(`${this.url}/${id}`).pipe(map((r) => r.status));
  }
}
