import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';

import { TokenStore } from '../auth/token.store';

/**
 * Central HTTP error handling.
 *  - 401 -> clear session + bounce to /login (skips the auth handshakes themselves).
 *  - rethrows the ORIGINAL HttpErrorResponse so upstream interceptors (crypto)
 *    can still read the typed meta.code and re-handshake.
 */
export function errorInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const tokens = inject(TokenStore);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
      if (err.status === 401 && !isAuthCall) {
        tokens.clear();
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
}
