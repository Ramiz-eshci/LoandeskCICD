import { TestBed } from '@angular/core/testing';
import { TokenStore } from './token.store';
import { AuthUser } from '../models/auth.model';

describe('TokenStore', () => {
  let store: TokenStore;
  const user = { id: 1, name: 'Ramiz' } as unknown as AuthUser;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(TokenStore);
  });

  it('starts unauthenticated with no token or user', () => {
    expect(store.accessToken).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });

  it('set() stores the token and flips isAuthenticated', () => {
    store.set('abc', user);
    expect(store.accessToken).toBe('abc');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()).toBe(user);
  });

  it('setUser() updates the user without touching the token', () => {
    store.set('abc');
    store.setUser(user);
    expect(store.accessToken).toBe('abc');
    expect(store.user()).toBe(user);
  });

  it('clear() wipes the token and user', () => {
    store.set('abc', user);
    store.clear();
    expect(store.accessToken).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });
});
