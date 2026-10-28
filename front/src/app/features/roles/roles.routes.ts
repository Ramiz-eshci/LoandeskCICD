import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';

export const ROLES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./roles-list/roles-list.component').then((m) => m.RolesListComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./role-form/role-form.component').then((m) => m.RoleFormComponent),
    canActivate: [permissionGuard],
    data: { permission: { module: 'MASTERS.ROLES_MASTER', action: 'add' } },
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./role-form/role-form.component').then((m) => m.RoleFormComponent),
    canActivate: [permissionGuard],
    data: { permission: { module: 'MASTERS.ROLES_MASTER', action: 'edit' } },
  },
];
