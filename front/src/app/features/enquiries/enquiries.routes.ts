import { Routes } from '@angular/router';

export const ENQUIRIES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./enquiries-list/enquiries-list.component').then((m) => m.EnquiriesListComponent),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./enquiry-detail/enquiry-detail.component').then((m) => m.EnquiryDetailComponent),
  },
];
