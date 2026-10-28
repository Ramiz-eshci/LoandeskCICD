import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PortfolioService } from './portfolio.service';

describe('PortfolioService', () => {
  let svc: PortfolioService;
  let http: HttpTestingController;
  const base = '/api/portfolio';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(PortfolioService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('facilities() sends paging + filters and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.facilities({ page: 2, search: 'acme', arrears: '30', scope: 'all' }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === `${base}/facilities`);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('search')).toBe('acme');
    expect(req.request.params.get('arrears')).toBe('30');
    expect(req.request.params.get('scope')).toBe('all');
    req.flush({ status: true, message: 'ok', data: [{ loan_id: 1 }], meta: null });
    expect(out?.rows).toEqual([{ loan_id: 1 }]);
  });

  it('facilityOptions() defaults to []', () => {
    let out: unknown;
    svc.facilityOptions().subscribe((r) => (out = r));
    http.expectOne(`${base}/facility-options`).flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual([]);
  });

  it('summary() GETs /summary', () => {
    svc.summary().subscribe();
    http.expectOne(`${base}/summary`).flush({ status: true, message: 'ok', data: {} });
  });

  it('facility() GETs /facilities/:id', () => {
    svc.facility(5).subscribe();
    http.expectOne(`${base}/facilities/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('markBadDebt() POSTs /facilities/:id/bad-debt with the note', () => {
    svc.markBadDebt(5, 'defaulted').subscribe();
    const req = http.expectOne(`${base}/facilities/5/bad-debt`);
    expect(req.request.body).toEqual({ note: 'defaulted' });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('recordRecovery() POSTs /facilities/:id/recoveries', () => {
    svc.recordRecovery(5, { received_on: '2026-10-01', amount: 100, method: 'BACS', reference: 'R1', notes: '' }).subscribe();
    const req = http.expectOne(`${base}/facilities/5/recoveries`);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { remaining: 0, closed: true } });
  });

  it('redemptionPreview() GETs with redemption params', () => {
    svc.redemptionPreview(5, { redemption_date: '2026-10-01', interest_basis: 'daily', min_interest_months: 3 }).subscribe();
    const req = http.expectOne((r) => r.url === `${base}/facilities/5/redemption/preview`);
    expect(req.request.params.get('redemption_date')).toBe('2026-10-01');
    expect(req.request.params.get('interest_basis')).toBe('daily');
    expect(req.request.params.get('min_interest_months')).toBe('3');
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('deleteContact() DELETEs and returns the status flag', () => {
    let ok: boolean | undefined;
    svc.deleteContact(7).subscribe((r) => (ok = r));
    http.expectOne(`${base}/contacts/7`).flush({ status: true, message: 'ok', data: null });
    expect(ok).toBe(true);
  });

  it('contactLookups() falls back to empty arrays', () => {
    let out: unknown;
    svc.contactLookups().subscribe((r) => (out = r));
    http.expectOne(`${base}/lookups`).flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual({ methods: [], followupStatuses: [], contactOutcomes: [] });
  });
});
