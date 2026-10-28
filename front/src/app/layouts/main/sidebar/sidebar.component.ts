import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { PermissionsStore } from '../../../core/session/permissions.store';
import { UiAvatarComponent } from '../../../shared/ui/ui-avatar/ui-avatar.component';
import { NAV_ITEMS, NavItem } from './nav-data';

/** Fixed 220px navy rail: brand plate, role-scoped nav (with expandable groups), user card. */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, UiAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly session = inject(SessionStore);
  private readonly perms = inject(PermissionsStore);
  logoFailed = false;

  /** Groups collapsed by default; click to expand. */
  private readonly expanded = signal<Set<string>>(new Set());

  /**
   * Role-scoped nav: an item (or child) with a \`module\` is shown only when the
   * active role has a permission on it. Before real permissions load (design
   * mode / pre-/me) everything is shown, so the shell stays reviewable.
   */
  readonly visibleNav = computed<NavItem[]>(() => {
    const loaded = this.perms.loaded();
    const isSuper = this.perms.isSuperAdmin();
    const show = (mod?: string, action?: string) =>
      !mod || !loaded || isSuper || (action ? this.perms.can(mod, action) : this.perms.hasModule(mod));
    const out = [];
    for (const item of NAV_ITEMS) {
      if (item.children?.length) {
        const kids = item.children.filter((c) => show(c.module, c.action));
        if (kids.length) out.push({ ...item, children: kids });
      } else if (show(item.module, item.action)) {
        out.push(item);
      }
    }
    return out;
  });

  isOpen(label: string): boolean {
    return this.expanded().has(label);
  }

  toggle(label: string): void {
    const s = new Set(this.expanded());
    if (s.has(label)) s.delete(label);
    else s.add(label);
    this.expanded.set(s);
  }
}
