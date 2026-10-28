import { Routes } from '@angular/router';

export const ADMINISTRATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./administration-list/administration-list.component').then((m) => m.AdministrationListComponent),
  },
];
