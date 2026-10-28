import { TestBed } from '@angular/core/testing';
import { SessionStore } from './session.store';
import { Workspace } from './workspace.model';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(SessionStore);
  });

  it('exposes the design-stage defaults', () => {
    expect(store.displayName()).toBe('Sarah Mitchell');
    expect(store.firstName()).toBe('Sarah');
    expect(store.activeWorkspace().id).toBe('london-sales');
    expect(store.branchName()).toBe('London Branch');
    expect(store.roleName()).toBe('Sales / BDM');
  });

  it('selectWorkspace switches the active workspace computeds', () => {
    store.selectWorkspace('ho-underwriter');
    expect(store.roleName()).toBe('Underwriter');
    expect(store.scopeName()).toBe('Whole Organisation');
  });

  it('falls back to the first workspace for an unknown id', () => {
    store.selectWorkspace('does-not-exist');
    expect(store.activeWorkspace().id).toBe('london-sales');
  });

  it('hydrate replaces defaults with API values', () => {
    const ws: Workspace[] = [
      { id: 'role-5', branch: 'HQ', role: 'Credit', scope: 'Primary role', lastAccessed: '' },
    ];
    store.hydrate('Ramiz Khan', ws, 'role-5', 'ramiz@eshci.com');
    expect(store.userName()).toBe('Ramiz Khan');
    expect(store.firstName()).toBe('Ramiz');
    expect(store.userEmail()).toBe('ramiz@eshci.com');
    expect(store.activeWorkspace().id).toBe('role-5');
    expect(store.branchName()).toBe('HQ');
  });

  it('falls back to the email local part when the user has no full name', () => {
    store.hydrate('', store.workspaces(), undefined, 'admin.loandesk@yopmail.com');
    expect(store.userName()).toBe('admin.loandesk');
    expect(store.firstName()).toBe('admin.loandesk');
    expect(store.showEmailLine()).toBe(true);
  });
});
