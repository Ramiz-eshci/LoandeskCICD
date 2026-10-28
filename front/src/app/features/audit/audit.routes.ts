import { Routes } from '@angular/router';

export const AUDIT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./audit-list/audit-list.component').then((m) => m.AuditListComponent),
  },
];
