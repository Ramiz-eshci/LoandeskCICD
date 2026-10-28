import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiMeta, ApiResponse } from '../../core/models/api-response.model';
import { ModuleDef, PermissionDef, Role } from './roles-list/role.model';

/** Server-paged role list — same envelope/query shape as the Masters module. */
export interface RolesPage {
  rows: Role[];
  meta: ApiMeta | null;
}

/** Roles & Permissions master — wired to the real Doc-03 APIs (/roles, /permissions). */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Paginated role list (page / per_page / search) — mirrors MastersService.list(). */
  listRoles(opts: { page?: number; per_page?: number; search?: string } = {}): Observable<RolesPage> {
    let params = new HttpParams().set('page', String(opts.page ?? 1)).set('per_page', String(opts.per_page ?? 20));
    if (opts.search) params = params.set('search', opts.search);
    return this.http
      .get<ApiResponse<Role[]>>(this.base + API.roles, { params })
      .pipe(map((r) => ({ rows: r.data ?? [], meta: r.meta ?? null })));
  }

  createRole(payload: { roleName: string; description?: string }): Observable<{ roleId: number }> {
    return this.http.post<ApiResponse<{ roleId: number }>>(this.base + API.roles, payload).pipe(map((r) => r.data));
  }

  updateRole(id: number, payload: { roleName?: string; description?: string; is_active?: boolean }): Observable<unknown> {
    return this.http.put<ApiResponse<unknown>>(`${this.base + API.roles}/${id}`, payload).pipe(map((r) => r.data));
  }

  deleteRole(id: number): Observable<unknown> {
    return this.http.delete<ApiResponse<unknown>>(`${this.base + API.roles}/${id}`).pipe(map((r) => r.data));
  }

  /** Dynamic module/screen catalog (sheet-driven) for grouping the matrix. */
  listModules(): Observable<ModuleDef[]> {
    return this.http.get<ApiResponse<ModuleDef[]>>(this.base + API.modules).pipe(map((r) => r.data ?? []));
  }

  /** All permissions in the system (module_key.permission_key), for the matrix. */
  listPermissions(): Observable<PermissionDef[]> {
    return this.http
      .get<ApiResponse<PermissionDef[]>>(this.base + API.permissions)
      .pipe(map((r) => r.data ?? []));
  }

  /** Permissions currently granted to a role. */
  getRolePermissions(id: number): Observable<PermissionDef[]> {
    return this.http
      .get<ApiResponse<PermissionDef[]>>(`${this.base + API.roles}/${id}/permissions`)
      .pipe(map((r) => r.data ?? []));
  }

  /** Full replace of a role's permissions (module-wise add/edit). */
  setRolePermissions(id: number, permissionIds: number[]): Observable<unknown> {
    return this.http
      .put<ApiResponse<unknown>>(`${this.base + API.roles}/${id}/permissions`, { permissionIds })
      .pipe(map((r) => r.data));
  }
}
