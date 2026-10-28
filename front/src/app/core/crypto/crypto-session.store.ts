import { Injectable, signal } from '@angular/core';

/**
 * Holds the live transport-encryption session.
 *
 * SECURITY:
 *  - The AES-256 session key lives ONLY as a non-extractable CryptoKey in
 *    memory. It is never written to storage, never serialised, never logged.
 *  - Only the opaque sessionId (a UUID) is kept in sessionStorage so a page
 *    refresh can be detected; it is NOT a secret on its own (the server also
 *    needs the matching AES key which it stores at rest).
 */
const SESSION_ID_KEY = 'ld_crypto_session_id';

@Injectable({ providedIn: 'root' })
export class CryptoSessionStore {
  /** Whether the server has transport encryption switched on. */
  readonly enabled = signal<boolean>(false);
  /** True once the public key has been fetched at least once. */
  readonly probed = signal<boolean>(false);

  private aesKey: CryptoKey | null = null;
  private _sessionId: string | null = null;

  constructor() {
    try {
      this._sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    } catch {
      this._sessionId = null;
    }
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get key(): CryptoKey | null {
    return this.aesKey;
  }

  get hasSession(): boolean {
    return !!this.aesKey && !!this._sessionId;
  }

  set(sessionId: string, key: CryptoKey): void {
    this._sessionId = sessionId;
    this.aesKey = key;
    try {
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      /* private mode / storage disabled — session still works in-memory */
    }
  }

  clear(): void {
    this._sessionId = null;
    this.aesKey = null;
    try {
      sessionStorage.removeItem(SESSION_ID_KEY);
    } catch {
      /* ignore */
    }
  }
}
