import { Injectable, computed, signal } from '@angular/core';
import { AuthUser } from '../models/auth.model';

/**
 * Holds the access token + current user IN MEMORY ONLY.
 *
 * SECURITY: the access token is deliberately NOT persisted to localStorage /
 * sessionStorage (XSS-exfiltration risk). Session continuity across reloads is
 * provided by the httpOnly refresh cookie set by the server — on boot the app
 * calls /auth/refresh to mint a fresh access token.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<AuthUser | null>(null);

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => !!this._accessToken());

  get accessToken(): string | null {
    return this._accessToken();
  }

  set(accessToken: string, user?: AuthUser): void {
    this._accessToken.set(accessToken);
    if (user) this._user.set(user);
  }

  /** Set/refresh the current user without touching the access token (boot /me). */
  setUser(user: AuthUser): void {
    this._user.set(user);
  }

  clear(): void {
    this._accessToken.set(null);
    this._user.set(null);
  }
}
