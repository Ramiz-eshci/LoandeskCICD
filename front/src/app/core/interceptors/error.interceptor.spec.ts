import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';

import { errorInterceptor } from './error.interceptor';
import { TokenStore } from '../auth/token.store';

describe('errorInterceptor', () => {
  let tokens: TokenStore;
  let navigate: jest.Mock;

  beforeEach(() => {
    navigate = jest.fn();
    TestBed.configureTestingModule({
      providers: [TokenStore, { provide: Router, useValue: { navigate } }],
    });
    tokens = TestBed.inject(TokenStore);
  });

  function run(url: string, status: number): HttpErrorResponse {
    const next: HttpHandlerFn = () => throwError(() => new HttpErrorResponse({ status }));
    let errored: HttpErrorResponse | undefined;
    TestBed.runInInjectionContext(() =>
      errorInterceptor(new HttpRequest('GET', url), next).subscribe({ error: (e) => (errored = e) }));
    return errored as HttpErrorResponse;
  }

  it('401 on a normal call clears the session, routes to /login, and rethrows', () => {
    tokens.set('abc');
    const err = run('/api/enquiries', 401);
    expect(tokens.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(err.status).toBe(401);
  });

  it('401 on the login/refresh calls does NOT clear or redirect', () => {
    tokens.set('abc');
    run('/api/auth/login', 401);
    run('/api/auth/refresh', 401);
    expect(tokens.isAuthenticated()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rethrows other errors untouched', () => {
    const err = run('/api/enquiries', 500);
    expect(err.status).toBe(500);
    expect(navigate).not.toHaveBeenCalled();
  });
});
