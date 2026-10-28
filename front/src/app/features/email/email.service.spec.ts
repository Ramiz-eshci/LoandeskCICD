import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { EmailService } from './email.service';

describe('EmailService', () => {
  let svc: EmailService;
  let http: HttpTestingController;
  const base = '/api/email-settings';
  const hist = '/api/email-history';
  const ok = (data: unknown, meta: unknown = null) => ({ status: true, message: 'ok', data, meta });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(EmailService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('list() defaults to [] and options()/get() unwrap data', () => {
    let rows: unknown;
    svc.list().subscribe((r) => (rows = r));
    http.expectOne(base).flush(ok(null));
    expect(rows).toEqual([]);

    svc.options().subscribe();
    http.expectOne(`${base}/options`).flush(ok({}));
    svc.get('ENQUIRY_OFFER').subscribe();
    http.expectOne(`${base}/ENQUIRY_OFFER`).flush(ok({}));
  });

  it('save() PUTs and preview() POSTs the templates', () => {
    svc.save('ENQUIRY_OFFER', { subject_template: 's', body_template: 'b' } as never).subscribe();
    const put = http.expectOne(`${base}/ENQUIRY_OFFER`);
    expect(put.request.method).toBe('PUT');
    put.flush(ok({}));

    svc.preview('ENQUIRY_OFFER', { subject_template: 's', body_template: '<p>b</p>' }).subscribe();
    const pv = http.expectOne(`${base}/ENQUIRY_OFFER/preview`);
    expect(pv.request.body).toEqual({ subject_template: 's', body_template: '<p>b</p>' });
    pv.flush(ok({ subject: 's', html: '', unknown: [] }));
  });

  it('attachments: add / remove / download', () => {
    svc.addAttachment('K', { file_name: 'a.pdf', content_base64: 'AA' }).subscribe();
    expect(http.expectOne(`${base}/K/attachments`).request.method).toBe('POST');
    svc.removeAttachment('K', 4).subscribe();
    expect(http.expectOne(`${base}/K/attachments/4`).request.method).toBe('DELETE');
    svc.downloadAttachment('K', 4).subscribe();
    expect(http.expectOne(`${base}/K/attachments/4/download`).request.responseType).toBe('blob');
  });

  it('history() sends only non-empty filters and returns rows, summary and meta', () => {
    let out: { rows: unknown[]; summary: unknown; meta: unknown } | undefined;
    svc.history({ module: 'ENQUIRY', status: '', search: undefined, page: 2, per_page: 25 }).subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === hist);
    expect(req.request.params.keys().sort()).toEqual(['module', 'page', 'per_page']);
    req.flush(ok({ rows: [{ id: 1 }], summary: { sent: 1 } }, { page: 2 }));
    expect(out).toEqual({ rows: [{ id: 1 }], summary: { sent: 1 }, meta: { page: 2 } });

    svc.historyItem(9).subscribe();
    http.expectOne(`${hist}/9`).flush(ok({ id: 9 }));
  });
});
