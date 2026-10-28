import { Routes } from '@angular/router';

export const CREDIT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./credit-list/credit-list.component').then((m) => m.CreditListComponent),
  },
];
