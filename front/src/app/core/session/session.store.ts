import { Injectable, computed, signal } from '@angular/core';

import { Workspace } from './workspace.model';

/**
 * UI-facing view of the current session: display name, active workspace
 * (branch + role) and header badges. Design-stage defaults are supplied so the
 * shell renders without a live API; `hydrate()` overrides them once the real
 * profile call is wired in.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  readonly workspaces = signal<Workspace[]>([
    {
      id: 'london-sales',
      branch: 'London Branch',
      role: 'Sales / BDM',
      scope: 'London Branch',
      lastAccessed: 'Today, 08:42',
    },
    {
      id: 'ho-underwriter',
      branch: 'Head Office',
      role: 'Underwriter',
      scope: 'Whole Organisation',
      lastAccessed: 'Yesterday',
    },
    {
      id: 'ho-credit',
      branch: 'Head Office',
      role: 'Credit Manager',
      scope: 'Whole Organisation',
      lastAccessed: 'Today, 07:30',
    },
    {
      id: 'manchester-bm',
      branch: 'Manchester Branch',
      role: 'Branch Manager',
      scope: 'Manchester Branch + Sub-Branches',
      lastAccessed: '22 Aug 2026',
    },
  ]);

  readonly activeWorkspaceId = signal<string>('london-sales');
  readonly displayName = signal<string>('Sarah Mitchell');
  private readonly _email = signal<string>('sarah@esh.co.uk');
  readonly hasNotifications = signal(true);
  /** Profile picture (data URL) - null shows the initials. */
  readonly avatar = signal<string | null>(null);

  readonly activeWorkspace = computed(
    () => this.workspaces().find((w) => w.id === this.activeWorkspaceId()) ?? this.workspaces()[0],
  );

  readonly userEmail = computed(() => this._email());
  /**
   * Name shown in the header / sidebar / account menu. Falls back to the email's
   * local part (e.g. "admin.loandesk"), so a user with no full_name doesn't see
   * their full email repeated everywhere.
   */
  readonly userName = computed(
    () => this.displayName().trim() || this.userEmail().split('@')[0] || 'User',
  );
  readonly firstName = computed(() => {
    const full = this.displayName().trim();
    return full ? full.split(/\s+/)[0] : this.userName();
  });
  /** Show the email line under the name only when it adds information. */
  readonly showEmailLine = computed(() => !!this.userEmail() && this.userEmail() !== this.userName());
  readonly branchName = computed(() => this.activeWorkspace()?.branch ?? '');
  readonly roleName = computed(() => this.activeWorkspace()?.role ?? '');
  readonly scopeName = computed(() => this.activeWorkspace()?.scope ?? '');

  selectWorkspace(id: string): void {
    this.activeWorkspaceId.set(id);
  }

  /** Replace the design-stage defaults with values from the API. */
  hydrate(name: string, workspaces: Workspace[], activeId?: string, email?: string, avatar?: string | null): void {
    this.displayName.set(name ?? '');
    this.avatar.set(avatar ?? null);
    if (email) this._email.set(email);
    this.workspaces.set(workspaces);
    if (activeId) this.activeWorkspaceId.set(activeId);
  }
}
