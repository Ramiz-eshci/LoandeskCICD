import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { uploadProgressInterceptor } from './upload-progress.interceptor';
import { UploadProgressService } from './upload-progress.service';

describe('uploadProgressInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let uploads: UploadProgressService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([uploadProgressInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    uploads = TestBed.inject(UploadProgressService);
    jest.spyOn(uploads, 'start');
    jest.spyOn(uploads, 'finish');
  });
  afterEach(() => ctrl.verify());

  it('ignores requests without files', () => {
    http.post('/api/x', { name: 'a' }).subscribe();
    const req = ctrl.expectOne('/api/x');
    expect(req.request.reportProgress).toBe(false);
    req.flush({});
    expect(uploads.start).not.toHaveBeenCalled();
  });

  it('ignores GET / DELETE', () => {
    http.delete('/api/x', { body: { file_name: 'a.pdf', content_base64: 'AA' } }).subscribe();
    ctrl.expectOne('/api/x').flush({});
    expect(uploads.start).not.toHaveBeenCalled();
  });

  it('tracks a JSON base64 upload and reports success', () => {
    http.post('/api/docs', { notes: 'x', files: [{ file_name: 'offer.pdf', content_base64: 'AAAA' }] }).subscribe();
    const req = ctrl.expectOne('/api/docs');
    expect(req.request.reportProgress).toBe(true);
    expect(uploads.start).toHaveBeenCalledWith('offer.pdf');
    req.flush({ ok: true });
    expect(uploads.finish).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('labels multi-file uploads and reports failures', () => {
    http.post('/api/docs', { uploads: [1, 2, 3].map((i) => ({ file_name: `f${i}.pdf`, content_base64: 'A' })) }).subscribe({ error: () => undefined });
    expect(uploads.start).toHaveBeenCalledWith('3 files (f1.pdf, f2.pdf…)');
    ctrl.expectOne('/api/docs').flush('no', { status: 500, statusText: 'err' });
    expect(uploads.finish).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('detects FormData files', () => {
    const fd = new FormData();
    fd.append('file', new File(['x'], 'scan.png'));
    http.post('/api/up', fd).subscribe();
    expect(uploads.start).toHaveBeenCalledWith('scan.png');
    ctrl.expectOne('/api/up').flush({});
  });
});
