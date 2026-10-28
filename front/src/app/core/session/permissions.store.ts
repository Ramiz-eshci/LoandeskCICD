import { Injectable, computed, signal } from '@angular/core';

/**
 * Backend-controlled permissions for the ACTIVE role, as flat "MODULE.action"
 * keys (e.g. "APPLICATION.view"). Populated on login / select-role / me.
 * The sidebar and the permission guard read this — the UI never hardcodes
 * permissions (Doc-03 Section 3 / Doc-04 Section 27).
 */
@Injectable({ providedIn: 'root' })
export class PermissionsStore {
  private readonly _perms = signal<string[]>([]);
  private readonly _loaded = signal(false);
  private readonly _isSuper = signal(false);

  readonly permissions = this._perms.asReadonly();
  /** false until the first real permission payload lands (design mode stays false). */
  readonly loaded = this._loaded.asReadonly();
  readonly isSuperAdmin = this._isSuper.asReadonly();
  readonly count = computed(() => this._perms().length);

  set(perms: string[] | null | undefined, isSuper?: boolean): void {
    this._perms.set(Array.isArray(perms) ? perms : []);
    if (isSuper !== undefined) this._isSuper.set(!!isSuper);
    this._loaded.set(true);
  }

  clear(): void {
    this._perms.set([]);
    this._isSuper.set(false);
    this._loaded.set(false);
  }

  /** True if the active role has MODULE.action. */
  can(module: string, action: string): boolean {
    return this._perms().includes(`${module}.${action}`);
  }

  /** True if the active role has ANY permission on MODULE (drives nav visibility). */
  hasModule(module: string): boolean {
    // "A|B|C" = any of several modules (e.g. Portfolio work screens).
    // A trailing "!" = that exact module only, not its sub-screens
    // ("PORTFOLIO!" matches PORTFOLIO.view but not PORTFOLIO.CUSTOMER_360.view).
    const tokens = String(module).split('|').map((m) => m.trim()).filter(Boolean);
    return this._perms().some((k) => tokens.some((t) => {
      if (t.endsWith('!')) {
        const base = t.slice(0, -1) + '.';
        return k.startsWith(base) && !k.slice(base.length).includes('.');
      }
      return k.startsWith(t + '.');
    }));
  }
}
