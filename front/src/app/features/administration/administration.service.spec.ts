import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { AdministrationService } from './administration.service';

describe('AdministrationService', () => {
  let svc: AdministrationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(AdministrationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getUsers() GETs /api/user and defaults to []', () => {
    let out: unknown;
    svc.getUsers().subscribe((r) => (out = r));
    http.expectOne('/api/user').flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual([]);
  });

  it('getRoles() GETs /api/roles', () => {
    svc.getRoles().subscribe();
    const req = http.expectOne('/api/roles');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: [] });
  });
});
