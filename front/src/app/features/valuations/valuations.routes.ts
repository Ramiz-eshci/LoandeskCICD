import { Routes } from '@angular/router';

export const VALUATIONS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./valuations-list/valuations-list.component').then((m) => m.ValuationsListComponent),
  },
];
