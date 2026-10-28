import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UnderwritingApi } from './underwriting.api';

describe('UnderwritingApi', () => {
  let svc: UnderwritingApi;
  let http: HttpTestingController;
  const base = '/api/underwriting';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(UnderwritingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('counts() GETs /meta/counts', () => {
    svc.counts().subscribe();
    http.expectOne(`${base}/meta/counts`).flush({ status: true, message: 'ok', data: {} });
  });

  it('meta() GETs /meta', () => {
    svc.meta().subscribe();
    http.expectOne(`${base}/meta`).flush({ status: true, message: 'ok', data: {} });
  });

  it('list() sends paging + filters and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list({ page: 2, status: 'open', step: 3, tab: 'mine' }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('status')).toBe('open');
    expect(req.request.params.get('step')).toBe('3');
    expect(req.request.params.get('tab')).toBe('mine');
    req.flush({ status: true, message: 'ok', data: [{ underwriting_case_id: 1 }], meta: null });
    expect(out?.rows).toEqual([{ underwriting_case_id: 1 }]);
  });

  it('get() GETs /:id', () => {
    svc.get(5).subscribe();
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('accept() POSTs /:id/accept', () => {
    svc.accept(5).subscribe();
    const req = http.expectOne(`${base}/5/accept`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('saveStep() PUTs /:id/steps/:no', () => {
    svc.saveStep(5, 3, { note: 'x' }).subscribe();
    const req = http.expectOne(`${base}/5/steps/3`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('completeStep() POSTs /:id/steps/:no/complete', () => {
    svc.completeStep(5, 3, {}).subscribe();
    const req = http.expectOne(`${base}/5/steps/3/complete`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('photoUrl() builds the download path without an HTTP call', () => {
    expect(svc.photoUrl(5, 2)).toBe(`${base}/5/photos/2/download`);
  });
});
