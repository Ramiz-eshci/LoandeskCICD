import { HttpEvent, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';

import { CryptoService } from './crypto.service';

/** Typed crypto session codes the server sends in meta.code (crypto.service.js CODES). */
const CRYPTO_ERROR_CODES = new Set([
  'NO_CRYPTO_SESSION',
  'CRYPTO_SESSION_EXPIRED',
  'CRYPTO_SESSION_INVALID',
  'CRYPTO_SESSION_REVOKED',
]);

function isHandshakeUrl(url: string): boolean {
  return url.includes('/crypto/');
}

function isResponseEnvelope(
  body: unknown,
): body is { encrypted: true; data: string; meta: { iv: string; tag: string } } {
  const b = body as { encrypted?: unknown; data?: unknown; meta?: { iv?: unknown; tag?: unknown } };
  return (
    !!b && b.encrypted === true && typeof b.data === 'string' && !!b.meta && !!b.meta.iv && !!b.meta.tag
  );
}

/**
 * Transport-encryption interceptor.
 *
 * When encryption is ON: handshakes on demand, attaches X-Session-Id, seals JSON
 * request bodies, opens enveloped success responses, and re-handshakes + retries
 * once on a typed session error. When OFF: requests pass straight through.
 *
 * IMPORTANT: this is written as ONE rxjs pipe (from + switchMap). We never call
 * firstValueFrom / subscribe() on next() ourselves — a detached manual
 * subscription makes Angular abort the outbound request ("(canceled)").
 */
export function cryptoInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  // Handshake routes are always plain and must not recurse through here.
  if (isHandshakeUrl(req.url)) return next(req);

  const crypto = inject(CryptoService);
  return runWithSession(req, next, crypto, true);
}

function runWithSession(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  crypto: CryptoService,
  allowRetry: boolean,
): Observable<HttpEvent<unknown>> {
  return from(prepare(req, crypto)).pipe(
    switchMap((outgoing) =>
      next(outgoing).pipe(
        // open enveloped success responses back into plain objects
        switchMap((event) => {
          if (event instanceof HttpResponse && crypto.enabled && isResponseEnvelope(event.body)) {
            return from(crypto.open(event.body)).pipe(map((plain) => event.clone({ body: plain })));
          }
          return of(event);
        }),
        // typed session error -> re-handshake and retry once
        catchError((err: { error?: { meta?: { code?: string } } }) => {
          const code = err?.error?.meta?.code;
          if (allowRetry && code && CRYPTO_ERROR_CODES.has(code)) {
            return from(crypto.renew()).pipe(
              switchMap(() => runWithSession(req, next, crypto, false)),
            );
          }
          return throwError(() => err);
        }),
      ),
    ),
  );
}

/** Ensure a session, attach the session header, and seal the body if needed. */
async function prepare(
  req: HttpRequest<unknown>,
  crypto: CryptoService,
): Promise<HttpRequest<unknown>> {
  await crypto.ensureSession();
  if (!crypto.enabled) return req;

  let outgoing = req;
  const sid = crypto.sessionId;
  if (sid) outgoing = outgoing.clone({ setHeaders: { 'X-Session-Id': sid } });

  const canSeal =
    outgoing.body != null &&
    !(outgoing.body instanceof FormData) &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(outgoing.method);

  if (canSeal) {
    const sealed = await crypto.seal(outgoing.body);
    outgoing = outgoing.clone({ body: sealed });
  }
  return outgoing;
}
