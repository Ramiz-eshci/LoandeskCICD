import { Routes } from '@angular/router';

/** Brokers module (client 20-10-2026): broker performance listing. */
export const BROKERS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./brokers-list/brokers-list.component').then((m) => m.BrokersListComponent),
  },
  // Client 22-10-2026: broker dashboard (same layout as Customer 360).
  {
    path: ':id',
    loadComponent: () => import('./broker-detail/broker-detail.component').then((m) => m.BrokerDetailComponent),
  },
];
