import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';

import { TokenStore } from './token.store';

/** Attaches the Bearer access token to API calls (skips the auth/crypto handshakes). */
export function authInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const tokens = inject(TokenStore);
  const token = tokens.accessToken;

  const skip = req.url.includes('/auth/login') || req.url.includes('/auth/refresh') || req.url.includes('/crypto/');
  if (!token || skip) return next(req);

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
}
