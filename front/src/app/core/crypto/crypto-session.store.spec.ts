import { TestBed } from '@angular/core/testing';

import { CryptoSessionStore } from './crypto-session.store';

const KEY = 'ld_crypto_session_id';
const fakeKey = {} as CryptoKey;

describe('CryptoSessionStore', () => {
  beforeEach(() => {
    try { sessionStorage.clear(); } catch { /* ignore */ }
    TestBed.configureTestingModule({});
  });

  it('starts with no session and default flags', () => {
    const store = TestBed.inject(CryptoSessionStore);
    expect(store.sessionId).toBeNull();
    expect(store.key).toBeNull();
    expect(store.hasSession).toBe(false);
    expect(store.enabled()).toBe(false);
    expect(store.probed()).toBe(false);
  });

  it('set() stores id + key and persists only the id to sessionStorage', () => {
    const store = TestBed.inject(CryptoSessionStore);
    store.set('sid-1', fakeKey);
    expect(store.sessionId).toBe('sid-1');
    expect(store.key).toBe(fakeKey);
    expect(store.hasSession).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('sid-1');
  });

  it('clear() wipes the key, id and storage', () => {
    const store = TestBed.inject(CryptoSessionStore);
    store.set('sid-1', fakeKey);
    store.clear();
    expect(store.sessionId).toBeNull();
    expect(store.key).toBeNull();
    expect(store.hasSession).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('rehydrates the session id (not the key) from sessionStorage on construction', () => {
    sessionStorage.setItem(KEY, 'sid-boot');
    const store = TestBed.inject(CryptoSessionStore);
    expect(store.sessionId).toBe('sid-boot');
    expect(store.key).toBeNull();
    expect(store.hasSession).toBe(false); // id alone is not a usable session
  });
});
