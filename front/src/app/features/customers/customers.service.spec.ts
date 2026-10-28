import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let svc: CustomersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(CustomersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() targets /api/client (the client resource)', () => {
    svc.list().subscribe();
    const req = http.expectOne('/api/client');
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: [] });
  });
});
