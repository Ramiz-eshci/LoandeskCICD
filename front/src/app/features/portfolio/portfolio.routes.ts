import { Routes } from '@angular/router';

export const PORTFOLIO_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./portfolio-list/portfolio-list.component').then((m) => m.PortfolioListComponent),
  },
  {
    path: 'facilities/:id',
    loadComponent: () =>
      import('./portfolio-detail/portfolio-detail.component').then((m) => m.PortfolioDetailComponent),
  },
  // Customer 360 now lives in the Customers module; keep old links working.
  { path: 'customers/:id', redirectTo: '/customers/:id' },
];
