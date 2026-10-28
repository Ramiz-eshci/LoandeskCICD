import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { API } from '../../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../../core/models/api-response.model';
import { AdminUser, RoleOption } from './users-list/user.model';

/** Server-paged user list — same envelope/query shape as the Masters module. */
export interface UserPage {
  rows: AdminUser[];
  meta: ApiMeta | null;
}

/** User Master — wired to real /api/user (+ /api/roles for assignment). */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Paginated list (page / per_page / search) — mirrors MastersService.list(). */
  list(opts: { page?: number; per_page?: number; search?: string; role_id?: number | null } = {}): Observable<UserPage> {
    let params = new HttpParams().set('page', String(opts.page ?? 1)).set('per_page', String(opts.per_page ?? 20));
    if (opts.search) params = params.set('search', opts.search);
    if (opts.role_id) params = params.set('role_id', String(opts.role_id));
    return this.http
      .get<ApiResponse<AdminUser[]>>(this.base + API.user, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }
  get(id: number | string): Observable<AdminUser> {
    return this.http.get<ApiResponse<AdminUser>>(`${this.base + API.user}/${id}`).pipe(map((r) => r.data));
  }
  create(body: Record<string, unknown>): Observable<{ userId: number }> {
    return this.http.post<ApiResponse<{ userId: number }>>(this.base + API.user, body).pipe(map((r) => r.data));
  }
  update(id: number | string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base + API.user}/${id}`, body).pipe(map((r) => r.data));
  }
  deactivate(id: number | string, active: boolean): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base + API.user}/${id}`, { is_active: active }).pipe(map((r) => r.data));
  }
  /** Admin sets a new password for the user (signs them out of other sessions). */
  changePassword(id: number | string, password: string, confirmPassword: string): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(`${this.base + API.user}/${id}/password`, { password, confirmPassword }).pipe(map((r) => r.data));
  }
  /** Soft delete (server sets flag_deleted = 1; user disappears from list and cannot sign in). */
  remove(id: number | string): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base + API.user}/${id}`).pipe(map((r) => r.data));
  }
  /** Roles for the assignment dropdown — fetch the full set (per_page capped server-side). */
  listRoles(): Observable<RoleOption[]> {
    const params = new HttpParams().set('per_page', '100');
    return this.http.get<ApiResponse<RoleOption[]>>(this.base + API.roles, { params }).pipe(map((r) => r.data ?? []));
  }
}
