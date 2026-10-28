import { TestBed } from '@angular/core/testing';
import { HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { TokenStore } from './token.store';

describe('authInterceptor', () => {
  let tokens: TokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TokenStore] });
    tokens = TestBed.inject(TokenStore);
  });

  function sentRequest(url: string): HttpRequest<unknown> {
    let seen: HttpRequest<unknown> | undefined;
    const next: HttpHandlerFn = (r) => {
      seen = r;
      return of(new HttpResponse({ status: 200 }));
    };
    TestBed.runInInjectionContext(() =>
      authInterceptor(new HttpRequest('GET', url), next).subscribe());
    return seen as HttpRequest<unknown>;
  }

  it('adds the Bearer header when a token is present', () => {
    tokens.set('abc');
    expect(sentRequest('/api/enquiries').headers.get('Authorization')).toBe('Bearer abc');
  });

  it('passes through untouched when there is no token', () => {
    expect(sentRequest('/api/enquiries').headers.has('Authorization')).toBe(false);
  });

  it('skips the auth and crypto handshake routes', () => {
    tokens.set('abc');
    expect(sentRequest('/api/auth/login').headers.has('Authorization')).toBe(false);
    expect(sentRequest('/api/auth/refresh').headers.has('Authorization')).toBe(false);
    expect(sentRequest('/api/crypto/session').headers.has('Authorization')).toBe(false);
  });
});
