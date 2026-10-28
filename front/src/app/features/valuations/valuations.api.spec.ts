import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ValuationsApi } from './valuations.api';

describe('ValuationsApi', () => {
  let svc: ValuationsApi;
  let http: HttpTestingController;
  const base = '/api/valuations';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ValuationsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() sends params and falls back to an empty page shape', () => {
    let out: { rows: unknown[]; meta: unknown; counts: unknown } | undefined;
    svc.list({ tab: 'instructed', page: 2 }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('tab')).toBe('instructed');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual({ rows: [], meta: null, counts: {} });
  });

  it('decide() POSTs /:id/decision', () => {
    svc.decide(7, { outcome: 'accept' }).subscribe();
    const req = http.expectOne(`${base}/7/decision`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ outcome: 'accept' });
    req.flush({});
  });
});
