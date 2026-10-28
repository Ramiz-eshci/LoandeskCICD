import { MASTERS, HIDDEN_MASTERS, masterModule } from '../../../features/administration/masters/masters.config';

/** Sidebar navigation — mirrors the LoanDesk design system navigation. */
export interface NavItem {
  label: string;
  /** Route to navigate to. Omitted for parent groups that only expand children. */
  route?: string;
  /** Child items — renders this entry as an expandable group (e.g. Masters). */
  children?: NavItem[];
  /** bootstrap-icons class name. */
  icon: string;
  /**
   * Backend permission module key. When set, the item is shown only if the
   * active role has ANY permission on that module (role-scoped sidebar).
   * When omitted, the item is always visible.
   */
  module?: string;
  /**
   * When set alongside `module`, the item needs that EXACT `module.action`
   * permission (e.g. view), not merely any permission on the module. Used by the
   * report links so sidebar visibility matches the backend's view check exactly.
   */
  action?: string;
  /** Render a divider above this item. */
  dividerBefore?: boolean;
}


/** Masters submenu: Roles + Users + every configured master (generated). */
const MASTER_CHILDREN: NavItem[] = [
  // Users + Roles pinned to the top; every other master follows in A-Z order.
  { label: 'Users', route: '/administration/users', icon: 'bi-people', module: 'MASTERS.USER_MASTER' },
  { label: 'Roles', route: '/masters/roles', icon: 'bi-shield-lock', module: 'MASTERS.ROLES_MASTER' },
  // Client 17-10-2026: automatic e-mails - who is copied in, wording, extra files + history.
  { label: 'Email Settings', route: '/masters/email-settings', icon: 'bi-envelope-at', module: 'MASTERS.EMAIL_SETTINGS' },
  { label: 'Email History', route: '/masters/email-history', icon: 'bi-envelope-paper', module: 'MASTERS.EMAIL_HISTORY' },
  ...Object.entries(MASTERS)
    // Client 20-10-2026: Broker has its own "Brokers" menu below Customers.
    .filter(([key]) => !HIDDEN_MASTERS.has(key) && key !== 'broker')
    .map(([key, cfg]) => ({
      label: cfg.title,
      route: '/masters/' + key,
      icon: 'bi-table',
      module: masterModule(key),
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
];

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', route: '/dashboard', icon: 'bi-grid-1x2' },
  { label: 'Enquiries', route: '/enquiries', icon: 'bi-file-earmark-text', module: 'ENQUIRIES' },
  { label: 'Applications', route: '/applications', icon: 'bi-briefcase', module: 'APPLICATIONS' },
  { label: 'Underwriting', route: '/underwriting', icon: 'bi-clipboard-check', module: 'UNDERWRITING.CASE' },
  // Credit / Valuations / Legal & Completion removed from the menu and the Roles matrix (client 29-09-2026).
  // { label: 'Credit', route: '/credit', icon: 'bi-patch-check', module: 'CREDIT' },
  // { label: 'Valuations', route: '/valuations', icon: 'bi-building', module: 'VALUATION' },
  // { label: 'Legal & Completion', route: '/legal', icon: 'bi-book', module: 'LEGAL' },
  { label: 'Portfolio', route: '/portfolio', icon: 'bi-bar-chart', module: 'PORTFOLIO!|PORTFOLIO.CONTACT_LOG|PORTFOLIO.EXTENSION|PORTFOLIO.FURTHER_ADVANCE|PORTFOLIO.FACILITY_OVERVIEW|PORTFOLIO.FACILITY_LOAN_STRUCTURE|PORTFOLIO.FACILITY_SCHEDULE|PORTFOLIO.FACILITY_TRANSACTIONS|PORTFOLIO.FACILITY_INTEREST|PORTFOLIO.FACILITY_FEES|PORTFOLIO.FACILITY_PAYMENTS|PORTFOLIO.FACILITY_DRAWDOWNS|PORTFOLIO.FACILITY_SECURITY|PORTFOLIO.FACILITY_VALUATION|PORTFOLIO.FACILITY_COVENANTS|PORTFOLIO.FACILITY_DOCUMENTS|PORTFOLIO.FACILITY_CONTACTS|PORTFOLIO.FACILITY_STATEMENTS|PORTFOLIO.FACILITY_AMENDMENTS|PORTFOLIO.FACILITY_COLLECTIONS|PORTFOLIO.FACILITY_REDEMPTION|PORTFOLIO.FACILITY_AUDIT|PORTFOLIO.FACILITY_BAD_DEBT|PORTFOLIO.HEAD_OF_EXTENSION' },
  // Extensions workflow (client 30-09-2026): requests in progress until decided, then back in Portfolio.
  { label: 'Extensions', route: '/extensions', icon: 'bi-calendar-plus', module: 'PORTFOLIO.EXTENSION|PORTFOLIO.HEAD_OF_EXTENSION' },
  // { label: 'Collections', route: '/collections', icon: 'bi-exclamation-triangle', module: 'COLLECTION' },
  {
    label: 'Reports',
    icon: 'bi-bar-chart-line',
    module: 'REPORTS',
    children: [
      // Client 26-10-2026: each report shows only when the role has its own
      // Roles row (REPORTS.<X> view). Own vs all data is enforced by the API.
      // { label: 'Overview', route: '/reports', icon: 'bi-grid-1x2', module: 'REPORTS' },
      { label: 'Overall Summary', route: '/reports/summary', icon: 'bi-diagram-3', module: 'REPORTS.SUMMARY', action: 'view' },
      { label: 'Enquiry Report', route: '/reports/enquiry', icon: 'bi-file-earmark-text', module: 'REPORTS.ENQUIRY', action: 'view' },
      { label: 'Application Report', route: '/reports/application', icon: 'bi-briefcase', module: 'REPORTS.APPLICATION', action: 'view' },
      { label: 'Underwriting Report', route: '/reports/underwriting', icon: 'bi-clipboard-check', module: 'REPORTS.UNDERWRITING', action: 'view' },
      { label: 'Portfolio Report', route: '/reports/portfolio', icon: 'bi-bar-chart', module: 'REPORTS.PORTFOLIO', action: 'view' },
      { label: 'Income & Cashflow', route: '/reports/finance', icon: 'bi-cash-coin', module: 'REPORTS.FINANCE', action: 'view' },
    ],
  },
  { label: 'Customers', route: '/customers', icon: 'bi-person-check', module: 'CUSTOMERS', dividerBefore: true },
  // Client 20-10-2026: Brokers out of Masters - enquiries / completions / portfolio per introducer.
  { label: 'Brokers', route: '/brokers', icon: 'bi-person-badge', module: 'BROKERS' },
  // { label: 'Documents', route: '/documents', icon: 'bi-folder', module: 'APPLICATIONS.DOCUMENTS' },
  // { label: 'Tasks', route: '/tasks', icon: 'bi-list-check', module: 'TASK' },
  {
    label: 'Masters',
    icon: 'bi-sliders',
    module: 'ROLE',
    dividerBefore: true,
    children: MASTER_CHILDREN,
  },
  // { label: 'Administration', route: '/administration', icon: 'bi-gear', module: 'MASTERS.USER_MASTER' },
  // { label: 'Audit', route: '/audit', icon: 'bi-shield-lock', module: 'AUDIT' },
];
