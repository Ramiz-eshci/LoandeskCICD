import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { API } from '../constants/api-endpoints';
import { ApiResponse } from '../models/api-response.model';
import { CryptoSessionStore } from './crypto-session.store';
import {
  Envelope,
  decryptValue,
  encryptValue,
  generateWrappedAesKey,
  importRsaPublicKey,
} from './crypto.util';

interface PublicKeyData {
  publicKey: string;
  enabled: boolean;
}
interface SessionData {
  sessionId: string;
  expiresAt: string;
}

/**
 * Orchestrates the transport-encryption handshake and exposes encrypt/decrypt
 * of wire envelopes. The interceptor is the only expected caller.
 *
 * Handshake (once per tab, mirrors server flow):
 *   1. GET  /crypto/public-key  -> RSA public key (+ whether encryption is ON)
 *   2. generate AES-256 locally, RSA-wrap it
 *   3. POST /crypto/session { encryptedKey } -> sessionId
 *   4. keep sessionId + non-extractable AES CryptoKey in memory
 */
@Injectable({ providedIn: 'root' })
export class CryptoService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(CryptoSessionStore);
  private readonly base = environment.apiBaseUrl;

  private handshakeInFlight: Promise<void> | null = null;

  get enabled(): boolean {
    return this.store.enabled();
  }

  /** Fetch the public key once to learn whether encryption is enabled server-side. */
  async probe(): Promise<boolean> {
    if (this.store.probed()) return this.store.enabled();
    const res = await firstValueFrom(
      this.http.get<ApiResponse<PublicKeyData>>(this.base + API.crypto.publicKey),
    );
    this.store.enabled.set(!!res.data?.enabled);
    this.store.probed.set(true);
    return this.store.enabled();
  }

  /** Ensure a usable session exists (no-op if encryption is off). Deduped. */
  async ensureSession(): Promise<void> {
    await this.probe();
    if (!this.store.enabled()) return;
    if (this.store.hasSession) return;
    if (this.handshakeInFlight) return this.handshakeInFlight;

    this.handshakeInFlight = this.doHandshake().finally(() => {
      this.handshakeInFlight = null;
    });
    return this.handshakeInFlight;
  }

  /** Force a brand-new session (used after the server reports an expired/invalid one). */
  async renew(): Promise<void> {
    this.store.clear();
    await this.ensureSession();
  }

  private async doHandshake(): Promise<void> {
    const pk = await firstValueFrom(
      this.http.get<ApiResponse<PublicKeyData>>(this.base + API.crypto.publicKey),
    );
    if (!pk.data?.publicKey) throw new Error('Public key unavailable');

    const rsaPub = await importRsaPublicKey(pk.data.publicKey);
    const { wrappedKeyB64, key } = await generateWrappedAesKey(rsaPub);

    const sess = await firstValueFrom(
      this.http.post<ApiResponse<SessionData>>(this.base + API.crypto.session, {
        encryptedKey: wrappedKeyB64,
      }),
    );
    if (!sess.data?.sessionId) throw new Error('Session handshake failed');

    this.store.set(sess.data.sessionId, key);
  }

  // ---- envelope helpers used by the interceptor ----

  get sessionId(): string | null {
    return this.store.sessionId;
  }

  async seal(value: unknown): Promise<{ encrypted: true; data: string; meta: Envelope & { timestamp: string } }> {
    const key = this.store.key;
    if (!key) throw new Error('No session key');
    const env = await encryptValue(key, value);
    return {
      encrypted: true,
      data: env.data,
      meta: { ...env, timestamp: new Date().toISOString() },
    };
  }

  async open<T = unknown>(body: { data: string; meta: { iv: string; tag: string } }): Promise<T> {
    const key = this.store.key;
    if (!key) throw new Error('No session key');
    return decryptValue<T>(key, { data: body.data, iv: body.meta.iv, tag: body.meta.tag });
  }
}
