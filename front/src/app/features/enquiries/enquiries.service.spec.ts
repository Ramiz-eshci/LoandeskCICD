import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { EnquiriesService } from './enquiries.service';

describe('EnquiriesService', () => {
  let svc: EnquiriesService;
  let http: HttpTestingController;
  const base = '/api/enquiries';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(EnquiriesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() applies only the provided filters and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list({ page: 2, search: 'smith', status_code: 'NEW', dir: 'asc' }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('search')).toBe('smith');
    expect(req.request.params.get('status_code')).toBe('NEW');
    expect(req.request.params.get('dir')).toBe('asc');
    expect(req.request.params.has('branch_id')).toBe(false);
    req.flush({ status: true, message: 'ok', data: [{ id: 1 }], meta: { page: 2 } });
    expect(out?.rows).toEqual([{ id: 1 }]);
    expect(out?.meta).toEqual({ page: 2 });
  });

  it('assigned_to = 0 is still sent, but empty string is skipped', () => {
    svc.list({ assigned_to: 0 }).subscribe();
    const a = http.expectOne((r) => r.url === base);
    expect(a.request.params.get('assigned_to')).toBe('0');
    a.flush({ status: true, message: 'ok', data: [] });

    svc.list({ assigned_to: '' }).subscribe();
    const b = http.expectOne((r) => r.url === base);
    expect(b.request.params.has('assigned_to')).toBe(false);
    b.flush({ status: true, message: 'ok', data: [] });
  });

  it('get() GETs /:id', () => {
    svc.get(5).subscribe();
    http.expectOne(`${base}/5`).flush({ status: true, message: 'ok', data: {} });
  });

  it('create() POSTs the body', () => {
    svc.create({ email: 'a@b.com' }).subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { id: 9, enquiry_ref: 'ENQ-9' } });
  });

  it('previewIndicative() wraps inputs under { inputs }', () => {
    svc.previewIndicative(5, { ltv_pct: 70 }).subscribe();
    const req = http.expectOne(`${base}/5/indicative/preview`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ inputs: { ltv_pct: 70 } });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('convert() POSTs signed_offers + summary_notes (+ empty credit_notes by default)', () => {
    svc.convert(5, [{ file_name: 'a.pdf', content_base64: 'AAA' }], 'done').subscribe();
    const req = http.expectOne(`${base}/5/convert`);
    expect(req.request.body).toEqual({ signed_offers: [{ file_name: 'a.pdf', content_base64: 'AAA' }], summary_notes: 'done', credit_notes: {} });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('convert() forwards credit_notes when given', () => {
    svc.convert(5, [], '', { background: 'bg' } as any).subscribe();
    const req = http.expectOne(`${base}/5/convert`);
    expect(req.request.body.credit_notes).toEqual({ background: 'bg' });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('decline() POSTs reason_ids + notes', () => {
    svc.decline(5, [1, 2], 'nope').subscribe();
    const req = http.expectOne(`${base}/5/decline`);
    expect(req.request.body).toEqual({ reason_ids: [1, 2], notes: 'nope' });
    req.flush({ status: true, message: 'ok', data: {} });
  });

  it('counts() GETs /meta/counts', () => {
    svc.counts().subscribe();
    http.expectOne(`${base}/meta/counts`).flush({ status: true, message: 'ok', data: { total: 0, byCode: {} } });
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
    c.flush({ status: true, message: 'ok', data: { total: 0, byCode: {} } });
  });
});
