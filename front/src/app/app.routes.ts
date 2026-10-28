import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { masterPermissionGuard, permissionGuard } from './core/auth/permission.guard';

/**
 * Top-level routing.
 *  - /login, /mfa, /workspace   public sign-in journey (each screen owns its layout)
 *  - everything else            behind authGuard, inside the main shell layout
 * Every feature is lazy-loaded to keep the initial bundle small.
 */
export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'mfa',
    loadComponent: () => import('./features/auth/mfa/mfa.component').then((m) => m.MfaComponent),
  },
  {
    path: 'workspace',
    loadComponent: () =>
      import('./features/auth/workspace/workspace.component').then((m) => m.WorkspaceComponent),
  },
  {
    path: 'access-denied',
    loadComponent: () =>
      import('./features/access-denied/access-denied.component').then((m) => m.AccessDeniedComponent),
  },
  {
    path: '',
    loadComponent: () => import('./layouts/main/main.component').then((m) => m.MainComponent),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        // Client 26-10-2026: header menu "Profile & preferences" - every signed-in user, own account only.
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
      },
      {
        path: 'enquiries',
        loadChildren: () =>
          import('./features/enquiries/enquiries.routes').then((m) => m.ENQUIRIES_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'ENQUIRIES' } },
      },
      {
        path: 'applications',
        loadChildren: () =>
          import('./features/applications/applications.routes').then((m) => m.APPLICATIONS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'APPLICATIONS' } },
      },
      {
        path: 'valuations',
        loadChildren: () =>
          import('./features/valuations/valuations.routes').then((m) => m.VALUATIONS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'VALUATION' } },
      },
      {
        path: 'legal',
        loadChildren: () => import('./features/legal/legal.routes').then((m) => m.LEGAL_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'LEGAL' } },
      },
      {
        path: 'portfolio',
        loadChildren: () =>
          import('./features/portfolio/portfolio.routes').then((m) => m.PORTFOLIO_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'PORTFOLIO!|PORTFOLIO.CONTACT_LOG|PORTFOLIO.EXTENSION|PORTFOLIO.FURTHER_ADVANCE|PORTFOLIO.FACILITY_OVERVIEW|PORTFOLIO.FACILITY_LOAN_STRUCTURE|PORTFOLIO.FACILITY_SCHEDULE|PORTFOLIO.FACILITY_TRANSACTIONS|PORTFOLIO.FACILITY_INTEREST|PORTFOLIO.FACILITY_FEES|PORTFOLIO.FACILITY_PAYMENTS|PORTFOLIO.FACILITY_DRAWDOWNS|PORTFOLIO.FACILITY_SECURITY|PORTFOLIO.FACILITY_VALUATION|PORTFOLIO.FACILITY_COVENANTS|PORTFOLIO.FACILITY_DOCUMENTS|PORTFOLIO.FACILITY_CONTACTS|PORTFOLIO.FACILITY_STATEMENTS|PORTFOLIO.FACILITY_AMENDMENTS|PORTFOLIO.FACILITY_COLLECTIONS|PORTFOLIO.FACILITY_REDEMPTION|PORTFOLIO.FACILITY_AUDIT|PORTFOLIO.FACILITY_BAD_DEBT|PORTFOLIO.HEAD_OF_EXTENSION' } },
      },
      {
        path: 'extensions',
        loadChildren: () =>
          import('./features/extensions/extensions.routes').then((m) => m.EXTENSIONS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'PORTFOLIO.EXTENSION|PORTFOLIO.HEAD_OF_EXTENSION' } },
      },
      {
        path: 'reports',
        loadChildren: () => import('./features/reports/reports.routes').then((m) => m.REPORTS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'REPORTS' } },
      },
      {
        path: 'customers',
        loadChildren: () =>
          import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'CUSTOMERS' } },
      },
      {
        // Client 20-10-2026: Brokers menu (moved out of Masters) - performance by introducer.
        path: 'brokers',
        loadChildren: () =>
          import('./features/brokers/brokers.routes').then((m) => m.BROKERS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'BROKERS' } },
      },
      {
        path: 'documents',
        loadChildren: () =>
          import('./features/documents/documents.routes').then((m) => m.DOCUMENTS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'APPLICATIONS.APPLICATION_LIST' } },
      },
      {
        path: 'tasks',
        loadChildren: () => import('./features/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'TASK' } },
      },
      {
        path: 'underwriting',
        loadChildren: () =>
          import('./features/underwriting/underwriting.routes').then((m) => m.UNDERWRITING_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'UNDERWRITING.CASE' } },
      },
      {
        path: 'credit',
        loadChildren: () => import('./features/credit/credit.routes').then((m) => m.CREDIT_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'CREDIT' } },
      },
      {
        path: 'collections',
        loadChildren: () =>
          import('./features/collections/collections.routes').then((m) => m.COLLECTIONS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'COLLECTION' } },
      },
      {
        path: 'administration',
        loadChildren: () =>
          import('./features/administration/administration.routes').then((m) => m.ADMINISTRATION_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.USER_MASTER' } },
      },
      {
        path: 'administration/users',
        loadChildren: () =>
          import('./features/administration/users/users.routes').then((m) => m.USERS_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.USER_MASTER' } },
      },
      {
        path: 'audit',
        loadChildren: () => import('./features/audit/audit.routes').then((m) => m.AUDIT_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'AUDIT' } },
      },
      {
        path: 'masters',
        pathMatch: 'full',
        redirectTo: 'masters/roles',
      },
      {
        path: 'masters/roles',
        loadChildren: () => import('./features/roles/roles.routes').then((m) => m.ROLES_ROUTES),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.ROLES_MASTER' } },
      },
      // Masters > Email Settings / Email History (client 17-10-2026) - before masters/:key.
      {
        path: 'masters/email-settings',
        loadComponent: () =>
          import('./features/email/email-settings-list/email-settings-list.component').then((m) => m.EmailSettingsListComponent),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.EMAIL_SETTINGS' } },
      },
      {
        path: 'masters/email-settings/:eventKey',
        loadComponent: () =>
          import('./features/email/email-settings-edit/email-settings-edit.component').then((m) => m.EmailSettingsEditComponent),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.EMAIL_SETTINGS' } },
      },
      {
        path: 'masters/email-history',
        loadComponent: () =>
          import('./features/email/email-history/email-history.component').then((m) => m.EmailHistoryComponent),
        canActivate: [permissionGuard],
        data: { permission: { module: 'MASTERS.EMAIL_HISTORY' } },
      },
      // Client 20-10-2026: the Broker master list now lives under the Brokers menu (add / edit
      // forms below still use masters/broker/new and masters/broker/:id/edit).
      { path: 'masters/broker', pathMatch: 'full', redirectTo: 'brokers' },
      {
        path: 'masters/:key',
        loadChildren: () =>
          import('./features/administration/masters/masters.routes').then((m) => m.MASTERS_ROUTES),
        canActivate: [masterPermissionGuard],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
