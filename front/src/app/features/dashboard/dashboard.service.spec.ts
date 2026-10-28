import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let svc: DashboardService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(DashboardService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('summary() GETs /api/dashbord and unwraps data', () => {
    let out: unknown;
    svc.summary().subscribe((r) => (out = r));
    const req = http.expectOne('/api/dashbord');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: { tiles: [] } });
    expect(out).toEqual({ tiles: [] });
  });
});
