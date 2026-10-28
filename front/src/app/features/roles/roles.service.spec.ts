import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { RolesService } from './roles.service';

describe('RolesService', () => {
  let svc: RolesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(RolesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listRoles() sends page/per_page/search and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.listRoles({ page: 2, per_page: 15, search: 'admin' }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === '/api/roles');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('per_page')).toBe('15');
    expect(req.request.params.get('search')).toBe('admin');
    req.flush({ status: true, message: 'ok', data: [{ roleId: 1 }], meta: null });
    expect(out?.rows).toEqual([{ roleId: 1 }]);
  });

  it('createRole() POSTs the payload', () => {
    svc.createRole({ roleName: 'BDM' }).subscribe();
    const req = http.expectOne('/api/roles');
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { roleId: 9 } });
  });

  it('updateRole() PUTs /roles/:id', () => {
    svc.updateRole(9, { roleName: 'BDM2' }).subscribe();
    const req = http.expectOne('/api/roles/9');
    expect(req.request.method).toBe('PUT');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('deleteRole() DELETEs /roles/:id', () => {
    svc.deleteRole(9).subscribe();
    const req = http.expectOne('/api/roles/9');
    expect(req.request.method).toBe('DELETE');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('listModules() and listPermissions() default to []', () => {
    let mods: unknown; let perms: unknown;
    svc.listModules().subscribe((r) => (mods = r));
    http.expectOne('/api/modules').flush({ status: true, message: 'ok', data: null });
    svc.listPermissions().subscribe((r) => (perms = r));
    http.expectOne('/api/permissions').flush({ status: true, message: 'ok', data: null });
    expect(mods).toEqual([]);
    expect(perms).toEqual([]);
  });

  it('getRolePermissions() GETs /roles/:id/permissions', () => {
    svc.getRolePermissions(9).subscribe();
    const req = http.expectOne('/api/roles/9/permissions');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: [] });
  });

  it('setRolePermissions() PUTs the permissionIds', () => {
    svc.setRolePermissions(9, [1, 2, 3]).subscribe();
    const req = http.expectOne('/api/roles/9/permissions');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ permissionIds: [1, 2, 3] });
    req.flush({ status: true, message: 'ok', data: {} });
  });
});
