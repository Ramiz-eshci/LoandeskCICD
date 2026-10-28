import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, debounceTime, skip } from 'rxjs';
import { PermissionsStore } from '../../../core/session/permissions.store';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import {
  FACILITY_COLUMNS,
  TODAY_FACILITY_COLUMNS,
  PORTFOLIO_CUSTOMER_COLUMNS,
} from './portfolio.data';
import { Facility, FacilityPrompt, PortfolioCustomer } from './facility.model';
import { PortfolioCustomerRow, PortfolioFacilityOption, PortfolioService, PortfolioSummary } from '../portfolio.service';

/** Portfolio — live book by facility or by customer, with maturity and arrears exposure. */
@Component({
  selector: 'app-portfolio-list',
  standalone: true,
  imports: [
    UiBadgeComponent,
    UiButtonDirective,
    UiCardComponent,
    UiCellDirective,
    UiDataTableComponent,
    UiKpiCardComponent,
    UiPageHeaderComponent,
    UiPaginationComponent,
    UiSearchInputComponent,
    UiTabFiltersComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './portfolio-list.component.html',
  styles: [`
    /* Seven compact KPI tiles on one line; they wrap only on narrow screens. */
    .kpi-strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 1199.98px) { .kpi-strip { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); } }
    .kpi-clickable { cursor: pointer; transition: transform 0.12s; }
    .kpi-clickable:hover { transform: translateY(-1px); }
    .kpi-clickable.kpi-picked > * { outline: 2px solid var(--accent, #eaab00); outline-offset: 0; border-radius: 10px; }
    .status-filter { width: 220px; }
    .mat-filter-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 12px; font-weight: 600; color: var(--accent-foreground, #0f2244); background: rgba(234,171,0,0.15); border-radius: 999px; }
    .prompt-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
    .prompt-chip { display: inline-flex; align-items: center; padding: 2px 8px; font-size: 11px; font-weight: 600; border-radius: 999px; white-space: nowrap; cursor: default; }
    .pc-payment { color: #0b4f8a; background: rgba(15,110,247,0.12); }
    .pc-contact { color: #8a5a00; background: rgba(234,171,0,0.18); }
    .pc-redemption { color: #7a1f1f; background: rgba(220,53,69,0.14); }
    .muted { color: var(--muted-foreground, #94a3b8); }
    .today-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
    .t-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; border-radius: 999px; white-space: nowrap; }
    .t-chip i { font-size: 12px; }
    .t-call { color: #0b4f8a; background: rgba(15,110,247,0.14); }
    .t-pay { color: #8a5a00; background: rgba(234,171,0,0.20); }
    .t-mat { color: #7a1f1f; background: rgba(220,53,69,0.16); }
    .row-maturity-today > td { background: rgba(220,53,69,0.08); }
    .row-today > td { background: rgba(234,171,0,0.07); }
  `],
})
export class PortfolioListComponent implements OnInit {
  private readonly api = inject(PortfolioService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly perms = inject(PermissionsStore);
  /** Portfolio RBAC (Roles matrix): admin bypass; before perms load, allow (API is the final gate). */
  pc(module: string, ...actions: string[]): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin()) return true;
    // No umbrella: each screen is its own module ('' = the top "Portfolio" row itself).
    return actions.some((a) => this.perms.can(module ? 'PORTFOLIO.' + module : 'PORTFOLIO', a));
  }

  readonly facilityRows = signal<Facility[]>([]);
  readonly customerRows = signal<PortfolioCustomer[]>([]);
  readonly facilityColumns = computed(() => this.activeTab() === 'today' ? TODAY_FACILITY_COLUMNS : FACILITY_COLUMNS);
  /** Highlight today's rows (Today tab only): maturity-today strongest, other action rows lighter. */
  readonly todayRowClass = (row: Facility): string => {
    if (this.activeTab() !== 'today') return '';
    if (row['maturityIsToday']) return 'row-maturity-today';
    if (row['todayCall'] || row['todayPayment'] || row['todayMaturity']) return 'row-today';
    return '';
  };
  readonly customerColumns = PORTFOLIO_CUSTOMER_COLUMNS;
  /** Facilities tab = Portfolio > VIEW (or any facility screen view). */
  readonly canFacilities = computed(() => ['', 'EXTENSION', 'FURTHER_ADVANCE',
    'FACILITY_OVERVIEW', 'FACILITY_LOAN_STRUCTURE', 'FACILITY_SCHEDULE', 'FACILITY_TRANSACTIONS', 'FACILITY_INTEREST', 'FACILITY_FEES', 'FACILITY_PAYMENTS', 'FACILITY_DRAWDOWNS', 'FACILITY_SECURITY', 'FACILITY_VALUATION', 'FACILITY_COVENANTS', 'FACILITY_DOCUMENTS', 'FACILITY_CONTACTS', 'FACILITY_STATEMENTS', 'FACILITY_AMENDMENTS', 'FACILITY_COLLECTIONS', 'FACILITY_REDEMPTION', 'FACILITY_AUDIT', 'FACILITY_BAD_DEBT', 'HEAD_OF_EXTENSION'].some((m) => this.pc(m, 'view')));
  // Client 30-09-2026: Live Facilities (active book) and All Facilities (bad debt, written off /
  // no hope, recovered and completed too, filterable by status).
  readonly tabs: TabFilter[] = [
    // Client 26-10-2026: Redeemed Facilities = redeemed loans (they leave Live Facilities).
    // Client 27-10-2026: Today first (opens on it), then Live / Redeemed / All.
    ...(this.canFacilities() ? [{ key: 'today', label: 'Today' }, { key: 'facilities', label: 'Live Facilities' }, { key: 'completed', label: 'Redeemed Facilities' }, { key: 'all', label: 'All Facilities' }] : []),
    // Customer Logs moved to the facility detail > Contacts tab (per-customer logs).
  ];
  readonly activeTab = signal(this.tabs[0]?.key || 'facilities');
  /** All Facilities status filter ('' = every status). */
  readonly statusFilter = signal('');
  readonly statusOptions = [
    { value: '', label: 'All statuses' },
    { value: 'Active', label: 'Active' },
    { value: 'Bad Debt', label: 'Bad Debt' },
    { value: 'Written Off', label: 'Written Off (no hope)' },
    { value: 'Recovered', label: 'Recovered' },
    { value: 'Redeemed', label: 'Completed / Redeemed' },
  ];
  setStatusFilter(v: string): void { this.statusFilter.set(v); this.page.set(1); this.load(); }
  readonly isFacilityTab = computed(() => ['facilities', 'all', 'today', 'completed'].includes(this.activeTab()));
  readonly query = signal('');
  /** Maturity window filter set by the Maturing cards (30/60/90), or null for all. */
  readonly maturityFilter = signal<number | null>(null);
  // Server-side pagination state (shared across tabs; resets on tab/search/filter change).
  readonly page = signal(1);
  readonly total = signal(0);
  // Client 19-10-2026: pagination off for now - every row loads on one page. Set true to bring it back.
  readonly paginate = true; // Client 20-10-2026: pagination back on (10 per page, server-side) - loading every row overloaded the API.
  readonly perPage = this.paginate ? 10 : 5000;
  readonly summary = signal<PortfolioSummary | null>(null);

  constructor() {
    // Debounced server-side search — reload the active tab 350ms after typing stops.
    toObservable(this.query)
      .pipe(skip(1), debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.load(); });
  }
  readonly portfolioLoading = signal(false);
  readonly searchPlaceholder = computed(() =>
    this.isFacilityTab()
      ? 'Search facilities…'
      : 'Search customers…',
  );

  // Rows now come pre-paged/pre-filtered from the server; the table renders them as-is.
  readonly facilities = computed<Facility[]>(() => this.facilityRows());

  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t}`;
  });
  readonly hasPrev = computed(() => this.page() > 1);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());

  /** Toggle the Maturing card filter (server param) and jump to the Facilities list. */
  filterByMaturity(days: number): void {
    this.maturityFilter.update((cur) => (cur === days ? null : days));
    this.activeTab.set('facilities');
    this.page.set(1);
    this.load();
  }
  clearMaturityFilter(): void { this.maturityFilter.set(null); this.page.set(1); this.load(); }

  onTab(key: string): void { this.activeTab.set(key); this.page.set(1); this.load(); }
  prev(): void { if (this.hasPrev()) { this.page.update((n) => n - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((n) => n + 1); this.load(); } }

  readonly customers = computed<PortfolioCustomer[]>(() => this.customerRows());

  readonly portfolioValue = computed(() => this.money(this.summary()?.portfolio_value ?? 0));
  readonly activeCount = computed(() => this.summary()?.active_count ?? 0);
  readonly arrearsCount = computed(() => this.summary()?.arrears_count ?? 0);
  readonly extensionsCount = computed(() => this.summary()?.extensions_count ?? 0);
  readonly arrearsCaption = computed(() => {
    const s = this.summary();
    if (!s || !s.portfolio_value) return '0% of book';
    return `${((s.arrears_amount / s.portfolio_value) * 100).toFixed(1)}% of book`;
  });
  readonly buckets = computed(() => {
    const list = this.summary()?.buckets ?? [{ days: 30, count: 0, value: 0 }, { days: 60, count: 0, value: 0 }, { days: 90, count: 0, value: 0 }];
    return list.map((b) => ({
      label: `Maturing ≤ ${b.days}d`, // short: fits the compact one-line tile (client 26-10-2026)
      days: b.days,
      value: this.money(b.value),
      count: `${b.count} facilities`,
      caption: `${b.count} ${b.count === 1 ? 'facility' : 'facilities'}`,
      tone: (b.days === 30 ? 'danger' : b.days === 60 ? 'warning' : 'default') as 'danger' | 'warning' | 'default',
    }));
  });
  readonly subtitle = computed(() => `Active loan portfolio · ${this.activeCount()} facilities`);

  ngOnInit(): void {
    this.loadAux();
    this.load();
  }

  /** Load the active tab's page from the server (paged + filtered). */
  private load(): void {
    const tab = this.activeTab();
    const search = this.query().trim() || undefined;
    const base = { page: this.page(), per_page: this.perPage, search };
    if (tab === 'customers') {
      this.portfolioLoading.set(true);
      this.api.customers(base)
        .pipe(catchError(() => of({ rows: [], meta: null })), takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          this.customerRows.set(res.rows.map((r) => this.toCustomer(r)));
          this.total.set(res.meta?.total ?? res.rows.length);
          this.portfolioLoading.set(false);
        });
    } else {
      this.portfolioLoading.set(true);
      const all = tab === 'all';
      const today = tab === 'today';
      const completed = tab === 'completed';
      this.api.facilities({
        ...base,
        scope: all ? 'all' : completed ? 'completed' : 'live',
        status: all ? (this.statusFilter() || undefined) : undefined,
        maturing_days: all || completed ? undefined : (this.maturityFilter() ?? undefined),
        due_today: today ? true : undefined,
      })
        .pipe(catchError(() => of({ rows: [], meta: null })), takeUntilDestroyed(this.destroyRef))
        .subscribe((res) => {
          this.facilityRows.set(res.rows.map((r) => this.toFacility(r)));
          this.total.set(res.meta?.total ?? res.rows.length);
          this.portfolioLoading.set(false);
        });
    }
  }

  /** Whole-book aggregates (KPI cards + maturity buckets). */
  private loadAux(): void {
    this.api.summary()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((sm) => { if (sm) this.summary.set(sm); });
  }

  openFacility(row: Facility): void {
    void this.router.navigate(['/portfolio/facilities', row.id]);
  }

  openCustomer360(row: PortfolioCustomer): void {
    void this.router.navigate(['/customers', row.applicantId]);
  }

  private money(v: number | null | undefined): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v || 0));
  }

  private toFacility(r: PortfolioFacilityOption): Facility {
    const arrears = Number(r.arrears_amount || 0);
    return {
      id: r.loan_number,
      customer: r.customer_name,
      product: r.product || 'Loan',
      balance: this.money(Number(r.outstanding_balance ?? r.principal ?? 0)),
      rate: `${Number(r.rate_pct || 0)}% pm`,
      maturity: r.maturity_date || '—',
      arrears: arrears ? this.money(arrears) : 'None',
      inArrears: arrears > 0,
      status: r.status === 'Redeemed' ? 'Completed' : r.status,
      statusTone: this.statusTone(r.status, arrears),
      prompts: this.buildPrompts(r),
      todayPayment: !!r['next_payment_due'],
      todayCall: !!r['next_contact_due'],
      todayMaturity: !!r['redemption_due'],
      maturityIsToday: !!r.maturity_date && r.maturity_date === new Date().toISOString().slice(0, 10),
      loan_id: r.loan_id,
    };
  }

  /** Dashboard prompts (client 12-10-2026): payment, contact check-in or redemption due today or overdue. */
  private buildPrompts(r: PortfolioFacilityOption): FacilityPrompt[] {
    const out: FacilityPrompt[] = [];
    const pay = r['next_payment_due'] as string | null;
    const contact = r['next_contact_due'] as string | null;
    const red = r['redemption_due'] as string | null;
    if (pay) out.push({ tone: 'payment', label: 'Payment', title: `Payment due ${this.formatDate(pay)}` });
    if (contact) out.push({ tone: 'contact', label: 'Check-in', title: `Contact check-in due ${this.formatDate(contact)}` });
    if (red) out.push({ tone: 'redemption', label: 'Redemption', title: `Redemption / maturity ${this.formatDate(red)}` });
    return out;
  }

  private statusTone(status: string, arrears: number): Facility['statusTone'] {
    switch (status) {
      case 'Bad Debt': return 'overdue';
      case 'Written Off': return 'declined';
      case 'Recovered': return 'completed';
      case 'Redeemed': return 'completed';
      default: return arrears > 0 ? 'overdue' : 'active';
    }
  }

  private toCustomer(r: PortfolioCustomerRow): PortfolioCustomer {
    const arrears = Number(r.arrears_amount || 0);
    return {
      id: `CUST-${String(r.applicant_id).padStart(6, '0')}`,
      applicantId: r.applicant_id,
      name: r.customer_name,
      type: String(r.applicant_type || (r.company_name ? 'Company' : 'Individual')),
      branch: String(r.branch_name || '—'),
      facilities: Number(r.facilities || 0),
      applications: Number(r.applications || 0),
      created: this.formatDate(r.created_at),
      exposure: this.money(Number(r.exposure || 0)),
      arrears: arrears ? this.money(arrears) : 'None',
      inArrears: arrears > 0,
    };
  }

  private formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

}
