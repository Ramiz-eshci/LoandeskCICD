import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { LegalService } from './legal.service';

describe('LegalService', () => {
  let svc: LegalService;
  let http: HttpTestingController;
  const base = '/api/legal';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(LegalService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() sends paging + tab', () => {
    svc.list({ tab: 'open', page: 2, per_page: 20 }).subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('tab')).toBe('open');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ status: true, message: 'ok', data: { rows: [] } });
  });

  it('get() GETs /:id', () => {
    svc.get(5).subscribe();
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('conditions() reads the case and defaults its conditions to []', () => {
    let out: unknown;
    svc.conditions(5).subscribe((r) => (out = r));
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: { conditions: null } });
    expect(out).toEqual([]);
  });

  it('setStage() POSTs /:id/stage', () => {
    svc.setStage(5, 'completion').subscribe();
    const req = http.expectOne(`${base}/5/stage`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ stage: 'completion' });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('toggleCondition() POSTs /:id/conditions/:condId/toggle', () => {
    svc.toggleCondition(5, 7).subscribe();
    const req = http.expectOne(`${base}/5/conditions/7/toggle`);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('downloadCreditPaper() requests a blob', () => {
    svc.downloadCreditPaper(5, 2).subscribe();
    const req = http.expectOne(`${base}/5/credit-paper/documents/2/download`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });
});
