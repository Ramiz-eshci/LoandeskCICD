import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { MastersService } from './masters.service';

describe('MastersService', () => {
  let svc: MastersService;
  let http: HttpTestingController;
  const base = '/api/masters';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(MastersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() builds page/per_page, search and active flags and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list('branches', { page: 3, perPage: 50, search: 'lon', activeOnly: true }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === `${base}/branches`);
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('per_page')).toBe('50');
    expect(req.request.params.get('search')).toBe('lon');
    expect(req.request.params.get('active')).toBe('1');
    req.flush({ status: true, message: 'ok', data: [{ id: 1 }], meta: { page: 3 } });
    expect(out?.rows).toEqual([{ id: 1 }]);
    expect(out?.meta).toEqual({ page: 3 });
  });

  it('get() GETs /:key/:id', () => {
    svc.get('branches', 9).subscribe();
    const req = http.expectOne(`${base}/branches/9`);
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('create() POSTs to /:key', () => {
    svc.create('branches', { name: 'HQ' }).subscribe();
    const req = http.expectOne(`${base}/branches`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'HQ' });
    req.flush({ status: true, message: 'ok', data: { id: 1 } });
  });

  it('update() PUTs /:key/:id', () => {
    svc.update('branches', 9, { name: 'HQ2' }).subscribe();
    const req = http.expectOne(`${base}/branches/9`);
    expect(req.request.method).toBe('PUT');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('deactivate() DELETEs /:key/:id with an is_active body', () => {
    svc.deactivate('branches', 9).subscribe();
    const req = http.expectOne(`${base}/branches/9`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ is_active: false });
    req.flush({ status: true, message: 'ok', data: {} });
  });
});
