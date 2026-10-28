import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UsersService } from './users.service';

describe('UsersService', () => {
  let svc: UsersService;
  let http: HttpTestingController;
  const base = '/api/user';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(UsersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() sends page/per_page/search/role_id and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list({ page: 2, per_page: 15, search: 'a', role_id: 4 }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('search')).toBe('a');
    expect(req.request.params.get('role_id')).toBe('4');
    req.flush({ status: true, message: 'ok', data: [{ userId: 1 }], meta: null });
    expect(out?.rows).toEqual([{ userId: 1 }]);
  });

  it('get() GETs /user/:id', () => {
    svc.get(5).subscribe();
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('create() POSTs the body', () => {
    svc.create({ email: 'a@b.com' }).subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { userId: 9 } });
  });

  it('update() PUTs /user/:id', () => {
    svc.update(5, { email: 'c@d.com' }).subscribe();
    const req = http.expectOne(`${base}/5`);
    expect(req.request.method).toBe('PUT');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('deactivate() PUTs the is_active flag', () => {
    svc.deactivate(5, false).subscribe();
    const req = http.expectOne(`${base}/5`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('remove() DELETEs /user/:id (soft delete)', () => {
    svc.remove(5).subscribe();
    const req = http.expectOne(`${base}/5`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('listRoles() requests up to 100 roles and defaults to []', () => {
    let out: unknown;
    svc.listRoles().subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === '/api/roles');
    expect(req.request.params.get('per_page')).toBe('100');
    req.flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual([]);
  });
});
