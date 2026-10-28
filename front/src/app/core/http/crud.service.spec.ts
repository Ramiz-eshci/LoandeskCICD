import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injectable } from '@angular/core';

import { CrudService } from './crud.service';

interface Cat { id: number; name: string; }

@Injectable({ providedIn: 'root' })
class CatService extends CrudService<Cat> {
  protected resourcePath(): string { return '/category'; }
}

describe('CrudService (via a concrete CatService)', () => {
  let svc: CatService;
  let http: HttpTestingController;
  const base = '/api/category';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), CatService],
    });
    svc = TestBed.inject(CatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() GETs the base and unwraps data (defaults to [])', () => {
    let out: Cat[] | undefined;
    svc.list().subscribe((r) => (out = r));
    const req = http.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: [{ id: 1, name: 'A' }] });
    expect(out).toEqual([{ id: 1, name: 'A' }]);

    svc.list().subscribe((r) => (out = r));
    http.expectOne(base).flush({ status: true, message: 'ok', data: null });
    expect(out).toEqual([]);
  });

  it('getById() GETs /:id', () => {
    let out: Cat | undefined;
    svc.getById(7).subscribe((r) => (out = r));
    const req = http.expectOne(`${base}/7`);
    expect(req.request.method).toBe('GET');
    req.flush({ status: true, message: 'ok', data: { id: 7, name: 'G' } });
    expect(out).toEqual({ id: 7, name: 'G' });
  });

  it('create() POSTs the payload', () => {
    svc.create({ name: 'New' }).subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'New' });
    req.flush({ status: true, message: 'ok', data: { id: 9, name: 'New' } });
  });

  it('update() PUTs /:id', () => {
    svc.update(9, { name: 'Edit' }).subscribe();
    const req = http.expectOne(`${base}/9`);
    expect(req.request.method).toBe('PUT');
    req.flush({ status: true, message: 'ok', data: { id: 9, name: 'Edit' } });
  });

  it('remove() DELETEs /:id and returns the status flag', () => {
    let ok: boolean | undefined;
    svc.remove(9).subscribe((r) => (ok = r));
    const req = http.expectOne(`${base}/9`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ status: true, message: 'deleted', data: null });
    expect(ok).toBe(true);
  });
});
