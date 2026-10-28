import { Routes } from '@angular/router';

export const COLLECTIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./collections-list/collections-list.component').then((m) => m.CollectionsListComponent),
  },
];
