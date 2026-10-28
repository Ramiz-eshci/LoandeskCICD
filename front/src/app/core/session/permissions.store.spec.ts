import { TestBed } from '@angular/core/testing';
import { PermissionsStore } from './permissions.store';

describe('PermissionsStore', () => {
  let store: PermissionsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(PermissionsStore);
  });

  it('starts empty and not loaded', () => {
    expect(store.permissions()).toEqual([]);
    expect(store.loaded()).toBe(false);
    expect(store.isSuperAdmin()).toBe(false);
    expect(store.count()).toBe(0);
  });

  it('set stores perms, flips loaded and count', () => {
    store.set(['APPLICATION.view', 'APPLICATION.add'], false);
    expect(store.loaded()).toBe(true);
    expect(store.count()).toBe(2);
  });

  it('coerces a null payload to an empty array', () => {
    store.set(null);
    expect(store.permissions()).toEqual([]);
    expect(store.loaded()).toBe(true);
  });

  it('can() matches an exact MODULE.action', () => {
    store.set(['APPLICATION.view']);
    expect(store.can('APPLICATION', 'view')).toBe(true);
    expect(store.can('APPLICATION', 'add')).toBe(false);
  });

  describe('hasModule', () => {
    it('true when any permission on the module exists', () => {
      store.set(['APPLICATION.view']);
      expect(store.hasModule('APPLICATION')).toBe(true);
      expect(store.hasModule('ENQUIRY')).toBe(false);
    });

    it('A|B matches any of several modules', () => {
      store.set(['CREDIT.view']);
      expect(store.hasModule('PORTFOLIO|CREDIT|LEGAL')).toBe(true);
    });

    it('trailing ! matches the exact module only, not sub-screens', () => {
      store.set(['PORTFOLIO.CUSTOMER_360.view']);
      expect(store.hasModule('PORTFOLIO!')).toBe(false);
      store.set(['PORTFOLIO.view']);
      expect(store.hasModule('PORTFOLIO!')).toBe(true);
    });
  });

  it('clear resets everything', () => {
    store.set(['APPLICATION.view'], true);
    store.clear();
    expect(store.permissions()).toEqual([]);
    expect(store.isSuperAdmin()).toBe(false);
    expect(store.loaded()).toBe(false);
  });
});
