import { Routes } from '@angular/router';

export const UNDERWRITING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./underwriting-list/underwriting-list.component').then((m) => m.UnderwritingListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./underwriting-detail/underwriting-detail.component').then((m) => m.UnderwritingDetailComponent),
  },
];
