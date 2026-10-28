import { Routes } from '@angular/router';

import { masterPermissionGuard } from '../../../core/auth/permission.guard';

export const MASTERS_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./master-list/master-list.component').then((m) => m.MasterListComponent) },
  {
    path: 'new',
    loadComponent: () => import('./master-form/master-form.component').then((m) => m.MasterFormComponent),
    canActivate: [masterPermissionGuard],
    data: { action: 'add' },
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./master-form/master-form.component').then((m) => m.MasterFormComponent),
    canActivate: [masterPermissionGuard],
    data: { action: 'edit' },
  },
];
