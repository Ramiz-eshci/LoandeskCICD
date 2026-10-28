import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AuthService } from './auth.service';
import { TokenStore } from './token.store';
import { PermissionsStore } from '../session/permissions.store';
import { SessionStore } from '../session/session.store';

describe('AuthService', () => {
  let svc: AuthService;
  let http: HttpTestingController;
  let tokens: TokenStore;
  let perms: PermissionsStore;
  let session: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        AuthService, TokenStore, PermissionsStore, SessionStore,
      ],
    });
    svc = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
    perms = TestBed.inject(PermissionsStore);
    session = TestBed.inject(SessionStore);
  });

  afterEach(() => http.verify());

  it('login() POSTs with credentials and captures the OTP challenge', () => {
    svc.login({ email: 'a@b.com', password: 'pw' }).subscribe();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ status: true, message: 'ok', data: {
      challengeId: 'ch-1', otpRequired: true, defaultOtp: true, otpLength: 6,
      expiresInSeconds: 120, channels: ['email'], maskedEmail: 'a***@b.com', devOtp: '000000',
    } });
    expect(svc.hasChallenge).toBe(true);
    expect(svc.devOtp).toBe('000000');
    expect(svc.otpChannels).toEqual(['email']);
    expect(svc.maskedEmail).toBe('a***@b.com');
    expect(svc.otpTtlSeconds).toBe(120);
  });

  it('verifyOtp() stores token, permissions, hydrates session and clears the challenge', () => {
    svc.verifyOtp('000000').subscribe();
    const req = http.expectOne('/api/auth/verify-otp');
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: {
      accessToken: 'tok-1',
      user: { userId: 1, email: 'a@b.com', fullName: 'Ramiz Khan', roleId: 5, isSuperAdmin: false, isCompanyAdmin: false },
      requiresRoleSelection: false, activeRoleId: 5,
      roles: [{ roleId: 5, roleName: 'BDM', isPrimary: true, branchName: 'London' }],
      permissions: ['APPLICATION.view'],
    } });
    expect(tokens.accessToken).toBe('tok-1');
    expect(tokens.isAuthenticated()).toBe(true);
    expect(perms.permissions()).toEqual(['APPLICATION.view']);
    expect(session.activeWorkspace().id).toBe('role-5');
    expect(session.userName()).toBe('Ramiz Khan');
    expect(session.userEmail()).toBe('a@b.com');
    expect(svc.hasChallenge).toBe(false);
  });

  it('selectRole() re-issues token + permissions and switches workspace', () => {
    svc.selectRole(7).subscribe();
    const req = http.expectOne('/api/auth/select-role');
    req.flush({ status: true, message: 'ok', data: { accessToken: 'tok-2', activeRoleId: 7, permissions: ['CREDIT.view'] } });
    expect(tokens.accessToken).toBe('tok-2');
    expect(perms.permissions()).toEqual(['CREDIT.view']);
    expect(session.activeWorkspaceId()).toBe('role-7');
  });

  it('loadMe() repopulates the user and permissions after a reload', () => {
    svc.loadMe().subscribe();
    const req = http.expectOne('/api/auth/me');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: {
      userId: 1, email: 'a@b.com', roleId: 5, isSuperAdmin: true, isCompanyAdmin: false,
      activeRoleId: 5, roles: [{ roleId: 5, roleName: 'BDM', isPrimary: true }], permissions: ['X.view'],
    } });
    expect(tokens.user()?.email).toBe('a@b.com');
    expect(perms.isSuperAdmin()).toBe(true);
    expect(perms.permissions()).toEqual(['X.view']);
  });

  it('refresh() sends the CSRF cookie as a header and stores the new token', () => {
    document.cookie = 'ld_csrf=csrf-123';
    svc.refresh().subscribe();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.headers.get('X-CSRF-TOKEN')).toBe('csrf-123');
    req.flush({ status: true, message: 'ok', data: { accessToken: 'tok-3' } });
    expect(tokens.accessToken).toBe('tok-3');
  });

  it('logout() POSTs and clears token and permissions', () => {
    tokens.set('tok', { userId: 1, email: 'a@b.com', roleId: 1, isSuperAdmin: false, isCompanyAdmin: false });
    perms.set(['A.view']);
    svc.logout().subscribe();
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ status: true, message: 'bye', data: null });
    expect(tokens.isAuthenticated()).toBe(false);
    expect(perms.permissions()).toEqual([]);
  });

  it('logout() clears the local session even when the API call fails', () => {
    tokens.set('tok', { userId: 1, email: 'a@b.com', roleId: 1, isSuperAdmin: false, isCompanyAdmin: false });
    perms.set(['A.view']);
    svc.logout().subscribe({ error: () => undefined });
    http.expectOne('/api/auth/logout').flush('down', { status: 503, statusText: 'down' });
    expect(tokens.isAuthenticated()).toBe(false);
    expect(perms.permissions()).toEqual([]);
  });

  it('forgotPassword() POSTs the email', () => {
    svc.forgotPassword('a@b.com').subscribe();
    const req = http.expectOne('/api/auth/forgot-password');
    expect(req.request.body).toEqual({ email: 'a@b.com' });
    req.flush({ status: true, message: 'sent', data: {} });
  });
});
