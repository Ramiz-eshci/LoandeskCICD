import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, UrlTree } from '@angular/router';

import { permissionGuard } from './permission.guard';
import { PermissionsStore } from '../session/permissions.store';
import { TokenStore } from './token.store';

function route(permission?: { module: string; action?: string }): ActivatedRouteSnapshot {
  return { data: permission ? { permission } : {} } as unknown as ActivatedRouteSnapshot;
}

describe('permissionGuard', () => {
  let perms: PermissionsStore;
  let tokens: TokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), PermissionsStore, TokenStore] });
    perms = TestBed.inject(PermissionsStore);
    tokens = TestBed.inject(TokenStore);
    tokens.set('tok');
  });

  const run = (r: ActivatedRouteSnapshot) =>
    TestBed.runInInjectionContext(() => permissionGuard(r, {} as never));

  it('redirects to /login when not authenticated', () => {
    tokens.clear();
    const res = run(route({ module: 'APPLICATION', action: 'add' })) as UrlTree;
    expect(res instanceof UrlTree).toBe(true);
    expect(res.toString()).toContain('/login');
  });

  it('allows when the route declares no permission', () => {
    expect(run(route())).toBe(true);
  });

  it('allows while permissions have not loaded yet', () => {
    expect(run(route({ module: 'APPLICATION', action: 'add' }))).toBe(true);
  });

  it('allows a super admin regardless', () => {
    perms.set([], true);
    expect(run(route({ module: 'APPLICATION', action: 'add' }))).toBe(true);
  });

  it('allows an exact module.action match', () => {
    perms.set(['APPLICATION.add']);
    expect(run(route({ module: 'APPLICATION', action: 'add' }))).toBe(true);
  });

  it('denies to /access-denied when the exact action is missing', () => {
    perms.set(['APPLICATION.view']);
    const res = run(route({ module: 'APPLICATION', action: 'add' })) as UrlTree;
    expect(res instanceof UrlTree).toBe(true);
    expect(res.toString()).toContain('/access-denied');
  });

  it('with no action, any permission on the module is enough', () => {
    perms.set(['APPLICATION.view']);
    expect(run(route({ module: 'APPLICATION' }))).toBe(true);
  });
});
