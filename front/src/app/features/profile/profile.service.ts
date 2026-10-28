import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';

export interface MyProfile {
  userId: number;
  email: string;
  fullName: string | null;
  phone: string | null;
  branchName: string | null;
  avatar: string | null;
  roles: string[];
}

/** My Profile — the signed-in user's own account (real /api/auth/profile). */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  get(): Observable<MyProfile> {
    return this.http.get<ApiResponse<MyProfile>>(this.base + API.auth.profile).pipe(map((r) => r.data));
  }
  update(body: { full_name: string; phone: string }): Observable<MyProfile> {
    return this.http.put<ApiResponse<MyProfile>>(this.base + API.auth.profile, body).pipe(map((r) => r.data));
  }
  changePassword(body: { currentPassword: string; password: string; confirmPassword: string }): Observable<unknown> {
    return this.http.post<ApiResponse<unknown>>(this.base + API.auth.profilePassword, body).pipe(map((r) => r.data));
  }
  /** data URL (png / jpeg / webp) or null to go back to the initials. */
  setAvatar(avatar: string | null): Observable<{ avatar: string | null }> {
    return this.http.put<ApiResponse<{ avatar: string | null }>>(this.base + API.auth.profileAvatar, { avatar }).pipe(map((r) => r.data));
  }
}
