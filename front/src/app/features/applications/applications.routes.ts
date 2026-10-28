import { Routes } from '@angular/router';

export const APPLICATIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./applications-list/applications-list.component').then((m) => m.ApplicationsListComponent),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./application-form/new-application.component').then((m) => m.NewApplicationComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./application-detail/application-detail.component').then((m) => m.ApplicationDetailComponent),
  },
];
