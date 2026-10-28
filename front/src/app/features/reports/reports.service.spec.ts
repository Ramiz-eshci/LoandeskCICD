import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let svc: ReportsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(ReportsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() targets /api/reports', () => {
    svc.list().subscribe();
    const req = http.expectOne('/api/reports');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: [] });
  });
});
