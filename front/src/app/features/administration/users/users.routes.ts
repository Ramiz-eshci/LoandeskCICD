import { Routes } from '@angular/router';

import { permissionGuard } from '../../../core/auth/permission.guard';

export const USERS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./users-list/users-list.component').then((m) => m.UsersListComponent) },
  {
    path: 'new',
    loadComponent: () => import('./user-form/user-form.component').then((m) => m.UserFormComponent),
    canActivate: [permissionGuard],
    data: { permission: { module: 'MASTERS.USER_MASTER', action: 'add' } },
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./user-form/user-form.component').then((m) => m.UserFormComponent),
    canActivate: [permissionGuard],
    data: { permission: { module: 'MASTERS.USER_MASTER', action: 'edit' } },
  },
];
