import { Routes } from '@angular/router';

import { permissionGuard } from '../../core/auth/permission.guard';

const moduleReport = () =>
  import('./module-report/module-report.component').then((m) => m.ModuleReportComponent);

// Client 26-10-2026: each report has its own Roles row (REPORTS.<X> view); the
// parent /reports route opens on ANY of them. Keeps the UI and the backend
// (reports.service REPORT_PERM) in agreement.
export const REPORTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./reports-list/reports-list.component').then((m) => m.ReportsListComponent),
  },
  {
    path: 'showcase',
    loadComponent: () =>
      import('./report-showcase/report-showcase.component').then((m) => m.ReportShowcaseComponent),
  },
  { path: 'enquiry', loadComponent: moduleReport, data: { section: 'enquiry', permission: { module: 'REPORTS.ENQUIRY', action: 'view' } }, canActivate: [permissionGuard] },
  { path: 'application', loadComponent: moduleReport, data: { section: 'application', permission: { module: 'REPORTS.APPLICATION', action: 'view' } }, canActivate: [permissionGuard] },
  { path: 'underwriting', loadComponent: moduleReport, data: { section: 'underwriting', permission: { module: 'REPORTS.UNDERWRITING', action: 'view' } }, canActivate: [permissionGuard] },
  { path: 'portfolio', loadComponent: moduleReport, data: { section: 'portfolio', permission: { module: 'REPORTS.PORTFOLIO', action: 'view' } }, canActivate: [permissionGuard] },
  // Client 22-10-2026: whole-pipeline summary (Sankey) and income & cashflow.
  { path: 'summary', loadComponent: moduleReport, data: { section: 'summary', permission: { module: 'REPORTS.SUMMARY', action: 'view' } }, canActivate: [permissionGuard] },
  { path: 'finance', loadComponent: moduleReport, data: { section: 'finance', permission: { module: 'REPORTS.FINANCE', action: 'view' } }, canActivate: [permissionGuard] },
];
