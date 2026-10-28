import { Routes } from '@angular/router';

export const LEGAL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./legal-list/legal-list.component').then((m) => m.LegalListComponent),
  },
];
