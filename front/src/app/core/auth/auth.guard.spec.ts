import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { authGuard } from './auth.guard';
import { TokenStore } from './token.store';

describe('authGuard', () => {
  let tokens: TokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), TokenStore] });
    tokens = TestBed.inject(TokenStore);
  });

  const run = (url = '/x') =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));

  it('allows the route when authenticated', () => {
    tokens.set('tok');
    expect(run()).toBe(true);
  });

  it('redirects to /login carrying the returnUrl when not authenticated', () => {
    const res = run('/enquiries');
    expect(res instanceof UrlTree).toBe(true);
    const tree = res as UrlTree;
    expect(tree.toString()).toContain('/login');
    expect(tree.queryParams['returnUrl']).toBe('/enquiries');
  });
});
