import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { CryptoService } from './crypto.service';
import { CryptoSessionStore } from './crypto-session.store';

describe('CryptoService', () => {
  let svc: CryptoService;
  let http: HttpTestingController;
  let store: CryptoSessionStore;

  beforeEach(() => {
    try { sessionStorage.clear(); } catch { /* ignore */ }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), CryptoService, CryptoSessionStore],
    });
    svc = TestBed.inject(CryptoService);
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(CryptoSessionStore);
  });

  afterEach(() => http.verify());

  it('probe() reads public-key and records whether encryption is enabled', async () => {
    const p = svc.probe();
    http.expectOne('/api/crypto/public-key').flush({ status: true, message: 'ok', data: { publicKey: '', enabled: false } });
    expect(await p).toBe(false);
    expect(store.enabled()).toBe(false);
    expect(store.probed()).toBe(true);
  });

  it('probe() is cached after the first fetch', async () => {
    const p = svc.probe();
    http.expectOne('/api/crypto/public-key').flush({ status: true, message: 'ok', data: { publicKey: '', enabled: true } });
    await p;
    expect(await svc.probe()).toBe(true); // no second HTTP call -> http.verify() stays clean
  });

  it('ensureSession() is a no-op when encryption is off', async () => {
    const p = svc.ensureSession();
    http.expectOne('/api/crypto/public-key').flush({ status: true, message: 'ok', data: { publicKey: '', enabled: false } });
    await p;
    expect(store.hasSession).toBe(false);
  });

  it('seal() and open() throw without a session key', async () => {
    await expect(svc.seal({ a: 1 })).rejects.toThrow('No session key');
    await expect(svc.open({ data: 'x', meta: { iv: 'i', tag: 't' } })).rejects.toThrow('No session key');
  });

  it('exposes the current sessionId from the store', () => {
    expect(svc.sessionId).toBeNull();
    store.set('sid-9', {} as CryptoKey);
    expect(svc.sessionId).toBe('sid-9');
  });
});
