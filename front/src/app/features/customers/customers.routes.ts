import { Routes } from '@angular/router';

/** Customers module: listing + Customer 360 (moved here from the Portfolio tabs). */
export const CUSTOMERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./customers-list/customers-list.component').then((m) => m.CustomersListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('../portfolio/customer-360/customer-360.component').then((m) => m.Customer360Component),
  },
];
