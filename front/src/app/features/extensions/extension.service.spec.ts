import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ExtensionService, extensionTone } from './extension.service';

describe('ExtensionService', () => {
  let svc: ExtensionService;
  let http: HttpTestingController;
  const base = '/api/extensions';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ExtensionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() defaults the view to "open" and unwraps rows+meta', () => {
    let out: { rows: unknown[]; meta: unknown } | undefined;
    svc.list().subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('view')).toBe('open');
    req.flush({ status: true, message: 'ok', data: [{ extension_id: 1 }], meta: null });
    expect(out?.rows).toEqual([{ extension_id: 1 }]);
  });

  it('counts() GETs /counts', () => {
    svc.counts().subscribe();
    http.expectOne(`${base}/counts`).flush({ status: true, message: 'ok', data: {} });
  });

  it('create() POSTs to /facilities/:loanKey', () => {
    svc.create('LN-1', { extension_months: 3, reason: 'x', exit_plan: 'sale' }).subscribe();
    const req = http.expectOne(`${base}/facilities/LN-1`);
    expect(req.request.method).toBe('POST');
    req.flush({ status: true, message: 'ok', data: { id: 9, ref: 'EXT-9' } });
  });

  it('decide() POSTs /:id/decision', () => {
    svc.decide(5, 'approve', 'ok').subscribe();
    const req = http.expectOne(`${base}/5/decision`);
    expect(req.request.body).toEqual({ decision: 'approve', notes: 'ok' });
    req.flush({ status: true, message: 'ok', data: { status: 'Approved' } });
  });

  it('deleteDoc() DELETEs and returns the status flag', () => {
    let ok: boolean | undefined;
    svc.deleteDoc(5, 2).subscribe((r) => (ok = r));
    http.expectOne(`${base}/5/documents/2`).flush({ status: true, message: 'ok', data: null });
    expect(ok).toBe(true);
  });

  it('agreementPdf() requests a blob', () => {
    svc.agreementPdf(5).subscribe();
    const req = http.expectOne(`${base}/5/agreement.pdf`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });
});

describe('extensionTone', () => {
  it('maps statuses to badge tones', () => {
    expect(extensionTone('Approved')).toBe('approved');
    expect(extensionTone('Rejected')).toBe('declined');
    expect(extensionTone('Cancelled')).toBe('closed');
    expect(extensionTone('Pending Approval')).toBe('review');
    expect(extensionTone('Agreement Signed')).toBe('active');
    expect(extensionTone('Agreement Sent')).toBe('pending');
    expect(extensionTone('Draft')).toBe('info');
  });
});
