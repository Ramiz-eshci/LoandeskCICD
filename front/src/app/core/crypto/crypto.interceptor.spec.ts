import { TestBed } from '@angular/core/testing';
import { HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';

import { cryptoInterceptor } from './crypto.interceptor';
import { CryptoService } from './crypto.service';

describe('cryptoInterceptor', () => {
  let cryptoMock: {
    enabled: boolean;
    sessionId: string | null;
    ensureSession: jest.Mock;
    seal: jest.Mock;
    open: jest.Mock;
    renew: jest.Mock;
  };

  beforeEach(() => {
    cryptoMock = {
      enabled: false,
      sessionId: null,
      ensureSession: jest.fn().mockResolvedValue(undefined),
      seal: jest.fn(),
      open: jest.fn(),
      renew: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: CryptoService, useValue: cryptoMock }],
    });
  });

  function capture() {
    let seen: HttpRequest<unknown> | undefined;
    const next: HttpHandlerFn = (r) => {
      seen = r;
      return of(new HttpResponse({ status: 200, body: { ok: true } }));
    };
    return { next, seen: () => seen as HttpRequest<unknown> };
  }

  it('passes crypto handshake routes straight through (no ensureSession)', async () => {
    const { next, seen } = capture();
    const req = new HttpRequest('GET', '/api/crypto/session');
    await firstValueFrom(TestBed.runInInjectionContext(() => cryptoInterceptor(req, next)));
    expect(seen()).toBe(req);
    expect(cryptoMock.ensureSession).not.toHaveBeenCalled();
  });

  it('passes requests through unchanged when encryption is off', async () => {
    const { next, seen } = capture();
    const req = new HttpRequest('POST', '/api/enquiries', { a: 1 });
    await firstValueFrom(TestBed.runInInjectionContext(() => cryptoInterceptor(req, next)));
    expect(cryptoMock.ensureSession).toHaveBeenCalled();
    expect(seen().body).toEqual({ a: 1 });
    expect(seen().headers.has('X-Session-Id')).toBe(false);
  });

  it('seals a POST body and attaches X-Session-Id when encryption is on', async () => {
    cryptoMock.enabled = true;
    cryptoMock.sessionId = 'sid-1';
    const sealed = { encrypted: true, data: 'CIPHER', meta: { iv: 'i', tag: 't', timestamp: 'ts' } };
    cryptoMock.seal.mockResolvedValue(sealed);

    const { next, seen } = capture();
    const req = new HttpRequest('POST', '/api/enquiries', { a: 1 });
    await firstValueFrom(TestBed.runInInjectionContext(() => cryptoInterceptor(req, next)));

    expect(cryptoMock.seal).toHaveBeenCalledWith({ a: 1 });
    expect(seen().headers.get('X-Session-Id')).toBe('sid-1');
    expect(seen().body).toEqual(sealed);
  });
});
