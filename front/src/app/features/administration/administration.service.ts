import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';
import { AdminRole, AdminUser } from './administration-list/administration.model';

/** Administration data — wired to the REAL Doc-03 APIs (/user, /roles). */
@Injectable({ providedIn: 'root' })
export class AdministrationService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  getUsers(): Observable<AdminUser[]> {
    return this.http
      .get<ApiResponse<AdminUser[]>>(this.base + API.user)
      .pipe(map((r) => r.data ?? []));
  }

  getRoles(): Observable<AdminRole[]> {
    return this.http
      .get<ApiResponse<AdminRole[]>>(this.base + API.roles)
      .pipe(map((r) => r.data ?? []));
  }
}
