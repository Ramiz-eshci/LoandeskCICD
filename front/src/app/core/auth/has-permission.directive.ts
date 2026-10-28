import { Directive, Input, TemplateRef, ViewContainerRef, effect, inject, signal } from '@angular/core';

import { PermissionsStore } from '../session/permissions.store';

/**
 * Structural directive to show/hide UI by backend permission (Module-1 point 5).
 * Permissions are NEVER hardcoded — they come from PermissionsStore (loaded via
 * /auth/login and /auth/me).
 *
 *   <button *appHasPermission="'APPLICATION.add'">New Application</button>
 *   <a *appHasPermission="'UNDERWRITING.approve'">Approve</a>
 *
 * While permissions are not yet loaded (design mode / pre-/me) content is shown,
 * so the shell stays reviewable offline. The backend remains the real authority.
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly perms = inject(PermissionsStore);

  private readonly required = signal<string | null>(null);
  private visible = false;

  @Input() set appHasPermission(key: string) {
    this.required.set(key);
  }

  constructor() {
    effect(() => {
      const key = this.required();
      const loaded = this.perms.loaded();
      const list = this.perms.permissions();
      const allow = !key || !loaded || list.includes(key);

      if (allow && !this.visible) {
        this.vcr.createEmbeddedView(this.tpl);
        this.visible = true;
      } else if (!allow && this.visible) {
        this.vcr.clear();
        this.visible = false;
      }
    });
  }
}
