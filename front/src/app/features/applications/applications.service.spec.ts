import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ApplicationsService } from './applications.service';

describe('ApplicationsService', () => {
  let svc: ApplicationsService;
  let http: HttpTestingController;
  const base = '/api/applications';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ApplicationsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() applies paging + filters and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list({ page: 3, stage: 'underwriting', product_id: 2 }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('stage')).toBe('underwriting');
    expect(req.request.params.get('product_id')).toBe('2');
    req.flush({ status: true, message: 'ok', data: [{ id: 1 }], meta: null });
    expect(out?.rows).toEqual([{ id: 1 }]);
  });

  it('get() GETs /:id', () => {
    svc.get(5).subscribe();
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('create() POSTs the body', () => {
    svc.create({ enquiry_id: 1 }).subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { id: 9, application_ref: 'APP-9' } });
  });

  it('updateApplicant() PUTs /:id/applicant/:applicantId', () => {
    svc.updateApplicant(5, 7, { phone: '07700 900000' }).subscribe();
    const req = http.expectOne(`${base}/5/applicant/7`);
    expect(req.request.method).toBe('PUT');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('changeStatus() POSTs status + reason', () => {
    svc.changeStatus(5, 'APPROVED', 'ok').subscribe();
    const req = http.expectOne(`${base}/5/status`);
    expect(req.request.body).toEqual({ status: 'APPROVED', reason: 'ok' });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('counts() GETs /meta/counts', () => {
    svc.counts().subscribe();
    http.expectOne(`${base}/meta/counts`).flush({ status: true, message: 'ok', data: { total: 0, byStage: {} } });
  });

  it('"My deals": list() and counts() send mine=1 only when on', () => {
    svc.list({ mine: true }).subscribe();
    const a = http.expectOne((r) => r.url === base);
    expect(a.request.params.get('mine')).toBe('1');
    a.flush({ status: true, message: 'ok', data: [] });

    svc.list({}).subscribe();
    const b = http.expectOne((r) => r.url === base);
    expect(b.request.params.has('mine')).toBe(false);
    b.flush({ status: true, message: 'ok', data: [] });

    svc.counts(true).subscribe();
    const c = http.expectOne((r) => r.url === `${base}/meta/counts`);
    expect(c.request.params.get('mine')).toBe('1');
    c.flush({ status: true, message: 'ok', data: { total: 0, byStage: {} } });
  });
});
