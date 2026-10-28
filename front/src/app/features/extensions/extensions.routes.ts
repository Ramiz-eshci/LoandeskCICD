import { Routes } from '@angular/router';

/** Extensions menu (Portfolio team) - client 30-09-2026. */
export const EXTENSIONS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./extension-list/extension-list.component').then((m) => m.ExtensionListComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./extension-detail/extension-detail.component').then((m) => m.ExtensionDetailComponent),
  },
];
