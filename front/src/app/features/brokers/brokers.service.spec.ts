import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { BrokersService } from './brokers.service';

describe('BrokersService', () => {
  let svc: BrokersService;
  let http: HttpTestingController;
  const base = '/api/brokers';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(BrokersService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('stats() sends the search only when given and unwraps data', () => {
    let out: unknown;
    svc.stats('acme').subscribe((r) => (out = r));
    const req = http.expectOne((r) => r.url === `${base}/stats`);
    expect(req.request.params.get('search')).toBe('acme');
    req.flush({ status: true, message: 'ok', data: { rows: [{ broker_id: 1 }], totals: { brokers: 1 } } });
    expect(out).toEqual({ rows: [{ broker_id: 1 }], totals: { brokers: 1 } });

    svc.stats().subscribe();
    const r2 = http.expectOne((r) => r.url === `${base}/stats`);
    expect(r2.request.params.has('search')).toBe(false);
    r2.flush({ status: true, message: 'ok', data: { rows: [], totals: {} } });
  });

  it('detail() GETs one broker', () => {
    let out: unknown;
    svc.detail(7).subscribe((r) => (out = r));
    http.expectOne(`${base}/7`).flush({ status: true, message: 'ok', data: { profile: { broker_id: 7 } } });
    expect(out).toEqual({ profile: { broker_id: 7 } });
  });

  it('documents: upload POST, download blob, delete', () => {
    const body = { file_name: 'a.pdf', content_base64: 'AA', document_type: 'Agreement' };
    svc.uploadDocument(7, body).subscribe();
    const up = http.expectOne(`${base}/7/documents`);
    expect(up.request.method).toBe('POST');
    expect(up.request.body).toEqual(body);
    up.flush({ status: true, message: 'ok', data: { id: 3 } });

    svc.downloadDocument(7, 3).subscribe();
    const dl = http.expectOne(`${base}/7/documents/3/download`);
    expect(dl.request.responseType).toBe('blob');
    dl.flush(new Blob(['x']));

    svc.deleteDocument(7, 3).subscribe();
    expect(http.expectOne(`${base}/7/documents/3`).request.method).toBe('DELETE');
  });
});
