import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { PermissionsStore } from '../session/permissions.store';
import { TokenStore } from './token.store';

/**
 * Route-level RBAC. Reads `route.data.permission = { module, action }`.
 *
 * - No `action` given: allowed if the role has ANY permission on the module
 *   (used for section/list routes — view is implied by module presence).
 * - `action` given: allowed only if the role has that EXACT module.action
 *   permission (used for add/edit/delete routes — a view-only role must NOT
 *   pass here even though it has SOME permission on the module).
 *
 * - designMode (dev only): always allowed, so screens are reviewable offline.
 * - permissions not yet loaded: allowed (avoid false lockout before /me lands).
 * - final authority is always the backend; this guard only hides UI.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const perms = inject(PermissionsStore);
  const tokens = inject(TokenStore);
  const router = inject(Router);

  if (!environment.production && environment.designMode) return true;
  if (!tokens.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  const need = route.data?.['permission'] as { module: string; action?: string } | undefined;
  if (!need || !perms.loaded()) return true;
  if (perms.isSuperAdmin()) return true;
  const allowed = need.action ? perms.can(need.module, need.action) : perms.hasModule(need.module);
  if (allowed) return true;

  return router.createUrlTree(['/access-denied']);
};

/** :key param can sit on this route or a parent route segment (e.g. masters/:key/new). */
function readKeyParam(route: ActivatedRouteSnapshot): string {
  let r: ActivatedRouteSnapshot | null = route;
  while (r) {
    const k = r.paramMap.get('key');
    if (k) return k;
    r = r.parent;
  }
  return '';
}

/**
 * Dynamic variant for `masters/:key` — the module key depends on the URL param
 * (see masters.config.ts masterModule()), so it can't be a static route.data
 * value like the other feature routes use. `action` is optional the same way
 * as permissionGuard (undefined = any permission on the module; given = exact
 * module.action match).
 */
export const masterPermissionGuard: CanActivateFn = async (route) => {
  const perms = inject(PermissionsStore);
  const tokens = inject(TokenStore);
  const router = inject(Router);

  if (!environment.production && environment.designMode) return true;
  if (!tokens.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  if (!perms.loaded()) return true;
  if (perms.isSuperAdmin()) return true;

  const key = readKeyParam(route);
  const action = route.data?.['action'] as string | undefined;
  const { masterModule } = await import('../../features/administration/masters/masters.config');
  const module = masterModule(key);
  const allowed = action ? perms.can(module, action) : perms.hasModule(module);
  if (allowed) return true;

  return router.createUrlTree(['/access-denied']);
};
