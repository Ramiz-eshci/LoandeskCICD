import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CreditService } from './credit.service';

describe('CreditService', () => {
  let svc: CreditService;
  let http: HttpTestingController;
  const base = '/api/credit';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(CreditService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() sends default page/per_page and the tab when given', () => {
    svc.list({ tab: 'pending', page: 2, per_page: 25 }).subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('per_page')).toBe('25');
    expect(req.request.params.get('tab')).toBe('pending');
    req.flush({ status: true, message: 'ok', data: { rows: [] } });
  });

  it('paper() GETs /:id/paper', () => {
    svc.paper(5).subscribe();
    const req = http.expectOne(`${base}/5/paper`);
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('decide() POSTs the decision body', () => {
    svc.decide(5, { decision: 'APPROVE' as never, comments: 'ok' }).subscribe();
    const req = http.expectOne(`${base}/5/decide`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ decision: 'APPROVE', comments: 'ok' });
    req.flush({ status: true, message: 'ok', data: {} });
  });
});
