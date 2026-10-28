import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { PermissionsStore } from '../../../core/session/permissions.store';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { CreditService } from '../credit.service';
import { CreditDecisionRow, CreditDecisionValue, CreditPaper, CreditRow } from './credit.model';
import { formatDate } from '../../../core/util/date.util';

/** Credit Approval — Credit Committee decisions on applications at CREDIT_REVIEW. */
@Component({
  selector: 'app-credit-list',
  standalone: true,
  imports: [
    FormsModule, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiKpiCardComponent, UiPageHeaderComponent, UiTabFiltersComponent, UiTagComponent, UiModalComponent,
    UiPaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credit-list.component.html',
  styleUrl: './credit-list.component.scss',
})
export class CreditListComponent implements OnInit {
  private readonly api = inject(CreditService);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly perms = inject(PermissionsStore);
  private p(m: string, a: string): boolean { return !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can(m, a); }
  /** Credit module is its own permission (CREDIT.*), separate from underwriting. */
  readonly canDecide = computed(() => this.p('CREDIT', 'approve') || this.p('CREDIT', 'reject'));
  /** "View" opens Application Detail, which needs the Applications permission. */
  readonly canOpenApp = computed(() => this.p('APPLICATIONS.APPLICATION_LIST', 'view'));

  readonly queue = signal<CreditRow[]>([]);
  readonly decisions = signal<CreditDecisionRow[]>([]);
  readonly kpiData = signal({ pending_decision: 0, total_exposure: 0, avg_ltv: 0, policy_exceptions: 0 });
  readonly loading = signal(true);
  readonly activeTab = signal('queue');
  readonly totals = signal({ queue: 0, decisions: 0 });
  // ---- Server-side paging (same pattern as Enquiries / Applications) ----
  readonly page = signal(1);
  readonly perPage = 10;
  readonly total = signal(0);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t} records`;
  });
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }
  onTab(key: string): void { this.activeTab.set(key); this.page.set(1); this.load(); }


  // Decision modal
  readonly decideOpen = signal(false);
  readonly decideRow = signal<CreditRow | null>(null);
  readonly decision = signal<CreditDecisionValue | ''>('');
  decideComments = '';
  decideConditions = '';
  readonly saving = signal(false);

  // Credit paper modal
  readonly paperOpen = signal(false);
  readonly paper = signal<CreditPaper | null>(null);

  readonly queueColumns: TableColumn<CreditRow & Record<string, unknown>>[] = [
    { key: 'application_ref', header: 'Application ID', width: '130px', mono: true, bold: true },
    { key: 'applicant_name', header: 'Applicant', width: '180px' },
    { key: 'product_name', header: 'Product', width: '150px' },
    { key: 'amount_requested', header: 'Gross Loan', width: '130px', mono: true, bold: true },
    { key: 'ltv_pct', header: 'LTV', width: '70px', mono: true },
    { key: 'irr', header: 'IRR', width: '80px', mono: true },
    { key: 'uw_recommendation', header: 'UW Recommendation', width: '180px' },
    { key: 'policy_exceptions', header: 'Policy Exceptions', width: '140px', align: 'center' },
    { key: 'initial_offer_status', header: 'Initial Offer', width: '130px' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'actions', header: 'Actions', width: '230px' },
  ];

  readonly decisionColumns: TableColumn<CreditDecisionRow & Record<string, unknown>>[] = [
    { key: 'application_ref', header: 'Application ID', width: '130px', mono: true, bold: true },
    { key: 'applicant_name', header: 'Applicant', width: '200px' },
    { key: 'amount_requested', header: 'Gross Loan', width: '140px', mono: true, bold: true },
    { key: 'ltv_pct', header: 'LTV', width: '80px', mono: true },
    { key: 'decision', header: 'Decision', width: '180px' },
    { key: 'decided_by_name', header: 'Decided By', width: '160px' },
    { key: 'decided_at', header: 'Date', width: '150px', mono: true },
  ];

  readonly kpis = computed(() => {
    const k = this.kpiData();
    return [
      { label: 'Pending Decision', value: k.pending_decision, caption: 'In credit review', icon: 'bi-hourglass-split', tone: 'default' as const },
      { label: 'Total Exposure', value: this.money(k.total_exposure), caption: 'Queue value', icon: 'bi-cash-stack', tone: 'accent' as const },
      { label: 'Avg LTV', value: k.avg_ltv + '%', caption: 'Queue average', icon: 'bi-graph-up', tone: 'default' as const },
      { label: 'Policy Exceptions', value: k.policy_exceptions, caption: 'Flagged items', icon: 'bi-flag', tone: k.policy_exceptions ? 'warning' as const : 'default' as const },
    ];
  });

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'queue', label: 'Queue', count: this.totals().queue },
    { key: 'decisions', label: 'All Decisions', count: this.totals().decisions },
  ]);

  readonly subtitle = computed(() => `${this.totals().queue} application${this.totals().queue === 1 ? '' : 's'} awaiting credit decision`);

  /** Method (not computed): comments/conditions are plain ngModel props, so this must
   *  re-evaluate on every change-detection tick as the user types. */
  decideValid(): boolean {
    const d = this.decision();
    if (!d || !this.decideComments.trim()) return false;
    if (d === 'approve_conditions' && !this.decideConditions.trim()) return false;
    return true;
  }

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.api.list({ tab: this.activeTab(), page: this.page(), per_page: this.perPage }).pipe(catchError(() => { this.toastr.error('Could not load the credit queue.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loading.set(false);
        if (!r) return;
        this.queue.set(r.queue || []);
        this.decisions.set(r.decisions || []);
        this.kpiData.set(r.kpis || this.kpiData());
        if (r.totals) this.totals.set(r.totals);
        this.total.set(r.meta?.total ?? (this.activeTab() === 'decisions' ? (r.decisions || []).length : (r.queue || []).length));
      });
  }
  view(row: CreditRow): void { void this.router.navigate(['/applications', row.application_id]); }

  openPaper(row: CreditRow): void {
    this.paper.set(null); this.paperOpen.set(true);
    this.api.paper(row.application_id).pipe(catchError(() => { this.toastr.error('Could not load the credit paper.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((p) => { if (p) this.paper.set(p); });
  }

  openDecide(row: CreditRow): void {
    this.decideRow.set(row); this.decision.set(''); this.decideComments = ''; this.decideConditions = '';
    this.paperOpen.set(false); this.decideOpen.set(true);
  }
  paperToDecide(): void {
    const p = this.paper();
    if (!p) return;
    const row = this.queue().find((r) => r.application_id === p.application_id);
    if (row) this.openDecide(row);
  }

  confirmDecision(): void {
    const row = this.decideRow(); const d = this.decision();
    if (!row || !d || !this.decideValid()) return;
    this.saving.set(true);
    this.api.decide(row.application_id, { decision: d, comments: this.decideComments.trim(), conditions: this.decideConditions.trim() })
      .pipe(catchError((e: { error?: { message?: string } }) => { this.saving.set(false); this.toastr.error(e?.error?.message || 'Decision failed.'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.saving.set(false);
        if (r === null) return;
        this.toastr.success('Credit decision recorded.');
        this.decideOpen.set(false);
        this.load();
      });
  }

  money(v: number | null | undefined): string {
    if (v == null) return '—';
    return '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
  dt(v: string | null): string { return formatDate(v); }
  ltv(v: number | null): string { return v == null ? '—' : v + '%'; }

  decisionLabel(d: string): string {
    return ({ approve: 'Approved', approve_conditions: 'Approved with Conditions', decline: 'Declined', refer: 'Referred' } as Record<string, string>)[d] || d;
  }
  decisionTone(d: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
    if (d === 'approve') return 'success';
    if (d === 'approve_conditions') return 'warning';
    if (d === 'decline') return 'danger';
    return 'info';
  }
}
