import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../constants/api-endpoints';
import { ApiResponse } from '../models/api-response.model';
import {
  AuthUser, LoginChallenge, LoginRequest, LoginResponse, MeResponse, ResendResponse, RoleOption, SelectRoleResponse,
} from '../models/auth.model';
import { Workspace } from '../session/workspace.model';
import { PermissionsStore } from '../session/permissions.store';
import { SessionStore } from '../session/session.store';
import { TokenStore } from './token.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokens = inject(TokenStore);
  private readonly perms = inject(PermissionsStore);
  private readonly session = inject(SessionStore);
  private readonly base = environment.apiBaseUrl;

  private _challengeId: string | null = null;
  private _devOtp: string | null = null;
  private _otpChannels: string[] = [];
  private _maskedEmail: string | null = null;
  private _maskedMobile: string | null = null;
  private _otpTtl = 0;
  get devOtp(): string | null { return this._devOtp; }
  get hasChallenge(): boolean { return this._challengeId !== null; }
  get otpChannels(): string[] { return this._otpChannels; }
  get maskedEmail(): string | null { return this._maskedEmail; }
  get maskedMobile(): string | null { return this._maskedMobile; }
  get otpTtlSeconds(): number { return this._otpTtl; }

  private captureChallenge(d: { challengeId?: string; devOtp?: string | null; channels?: string[]; maskedEmail?: string | null; maskedMobile?: string | null; expiresInSeconds?: number }): void {
    if (d.challengeId) this._challengeId = d.challengeId;
    this._devOtp = d.devOtp ?? null;
    this._otpChannels = d.channels ?? [];
    this._maskedEmail = d.maskedEmail ?? null;
    this._maskedMobile = d.maskedMobile ?? null;
    this._otpTtl = d.expiresInSeconds ?? this._otpTtl;
  }

  get isAuthenticated(): boolean {
    return this.tokens.isAuthenticated();
  }
  get user(): AuthUser | null {
    return this.tokens.user();
  }

  /** Map backend roles to the workspace cards shown on the Select Workspace screen. */
  private rolesToWorkspaces(roles: RoleOption[]): Workspace[] {
    return (roles ?? []).map((r) => ({
      id: `role-${r.roleId}`,
      roleId: r.roleId,
      branch: r.branchName || 'LoanDesk',
      role: r.roleName,
      scope: r.isPrimary ? 'Primary role' : 'Additional role',
      lastAccessed: this.formatLastAccessed(r.lastAccessedAt),
    }));
  }

  /**
   * Human-readable last-access stamp for a workspace card:
   *   Today, HH:mm  |  Yesterday  |  DD Mon YYYY  |  '' when never accessed.
   * Server sends a UTC timestamp; rendered in the user's local time.
   */
  private formatLastAccessed(iso?: string | null): string {
    if (!iso) return '';
    // Treat a bare (timezone-less) SQL timestamp as UTC.
    const norm = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z';
    const d = new Date(norm);
    if (isNaN(d.getTime())) return '';

    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
    const dayDiff = Math.round((startOf(now).getTime() - startOf(d).getTime()) / 86_400_000);
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    if (dayDiff === 0) return `Today, ${time}`;
    if (dayDiff === 1) return 'Yesterday';
    const day = d.getDate();
    const mon = d.toLocaleString('en-GB', { month: 'short' });
    return `${day} ${mon} ${d.getFullYear()}`;
  }

  /** Step 1: verify credentials -> receive an OTP challenge (no session yet). */
  login(payload: LoginRequest): Observable<LoginChallenge> {
    return this.http
      .post<ApiResponse<LoginChallenge>>(this.base + API.auth.login, payload, { withCredentials: true })
      .pipe(
        tap((res) => this.captureChallenge(res.data)),
        map((res) => res.data),
      );
  }

  /** Resend / regenerate the OTP for the pending challenge. */
  resendOtp(): Observable<ResendResponse> {
    return this.http
      .post<ApiResponse<ResendResponse>>(
        this.base + API.auth.resendOtp,
        { challengeId: this._challengeId },
        { withCredentials: true },
      )
      .pipe(
        tap((res) => this.captureChallenge(res.data)),
        map((res) => res.data),
      );
  }

  /** Step 2: verify the OTP for the pending challenge -> issue the session. */
  verifyOtp(otp: string): Observable<LoginResponse> {
    return this.http
      .post<ApiResponse<LoginResponse>>(
        this.base + API.auth.verifyOtp,
        { challengeId: this._challengeId, otp },
        { withCredentials: true },
      )
      .pipe(
        tap((res) => {
          const d = res.data;
          this.tokens.set(d.accessToken, d.user);
          this.perms.set(d.permissions, d.user.isSuperAdmin);
          const ws = this.rolesToWorkspaces(d.roles);
          if (ws.length) {
            const activeId = d.activeRoleId != null ? `role-${d.activeRoleId}` : ws[0].id;
            this.session.hydrate(d.user.fullName ?? '', ws, activeId, d.user.email, d.user.avatar);
          }
          this._challengeId = null;
          this._devOtp = null;
        }),
        map((res) => res.data),
      );
  }

  /** Switch active workspace/role — re-issues a scoped access token + permissions. */
  selectRole(roleId: number): Observable<SelectRoleResponse> {
    return this.http
      .post<ApiResponse<SelectRoleResponse>>(
        this.base + API.auth.selectRole,
        { roleId },
        { withCredentials: true },
      )
      .pipe(
        tap((res) => {
          this.tokens.set(res.data.accessToken);
          this.perms.set(res.data.permissions);
          this.session.selectWorkspace(`role-${res.data.activeRoleId}`);
        }),
        map((res) => res.data),
      );
  }

  /** Current user + roles + active-role permissions (used on boot after refresh). */
  loadMe(): Observable<MeResponse> {
    return this.http
      .get<ApiResponse<MeResponse>>(this.base + API.auth.me, { withCredentials: true })
      .pipe(
        tap((res) => {
          // Repopulate the in-memory user after a reload (refresh cookie path
          // mints a token but no user), so self-scoped UI (e.g. Assigned BDM)
          // can match the current user by id.
          this.tokens.setUser({
            userId: res.data.userId,
            email: res.data.email,
            roleId: res.data.activeRoleId ?? res.data.roleId,
            isSuperAdmin: res.data.isSuperAdmin,
            isCompanyAdmin: res.data.isCompanyAdmin,
          });
          this.perms.set(res.data.permissions, res.data.isSuperAdmin);
          const ws = this.rolesToWorkspaces(res.data.roles);
          if (ws.length) {
            const activeId = res.data.activeRoleId != null ? `role-${res.data.activeRoleId}` : ws[0].id;
            this.session.hydrate(res.data.fullName ?? '', ws, activeId, res.data.email, res.data.avatar);
          }
        }),
        map((res) => res.data),
      );
  }

  /** Forgot password: request a reset link by email (uniform response either way). */
  forgotPassword(email: string): Observable<ApiResponse<{ devResetLink?: string }>> {
    return this.http.post<ApiResponse<{ devResetLink?: string }>>(this.base + API.auth.forgotPassword, { email });
  }

  /** Check whether a reset link is still usable (not used, not expired). */
  validateResetToken(token: string): Observable<{ valid: boolean; maskedEmail?: string }> {
    return this.http
      .post<ApiResponse<{ valid: boolean; maskedEmail?: string }>>(this.base + API.auth.validateResetToken, { token })
      .pipe(map((res) => res.data));
  }

  /** Set a new password with a single-use reset link token. */
  resetPassword(token: string, password: string, confirmPassword: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(this.base + API.auth.resetPassword, { token, password, confirmPassword });
  }

  /** Mint a fresh access token from the httpOnly refresh cookie (double-submit CSRF). */
  refresh(): Observable<string> {
    const csrf = this.readCookie('ld_csrf');
    return this.http
      .post<ApiResponse<{ accessToken: string }>>(
        this.base + API.auth.refresh,
        {},
        { withCredentials: true, headers: csrf ? { 'X-CSRF-TOKEN': csrf } : {} },
      )
      .pipe(
        tap((res) => this.tokens.set(res.data.accessToken)),
        map((res) => res.data.accessToken),
      );
  }

  logout(): Observable<void> {
    // Pen-test 24-10-2026: POST (not GET) so a cross-site link/image can't log users out.
    // The local session is cleared even if the call fails (network / API down).
    return this.http
      .post<ApiResponse<unknown>>(this.base + API.auth.logout, {}, { withCredentials: true })
      .pipe(
        finalize(() => {
          this.tokens.clear();
          this.perms.clear();
        }),
        map(() => undefined),
      );
  }

  private readCookie(name: string): string | null {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
}
