import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { PermissionsStore } from '../../../core/session/permissions.store';

import { TabFilter, UiTabFiltersComponent } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { InstructValuationDrawerComponent } from '../valuation-form/instruct-valuation-drawer.component';
import { VALUATION_COLUMNS } from './valuations.data';
import { Valuation } from './valuation.model';
import { ValuationsApi } from '../valuations.api';

/** Valuations — instruction pipeline, returned reports and their outcomes. */
@Component({
  selector: 'app-valuations-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    UiPaginationComponent,
    UiTabFiltersComponent,
    UiBadgeComponent,
    UiCardComponent,
    UiKpiCardComponent,
    UiPageHeaderComponent,
    UiModalComponent,
    UiCellDirective,
    UiDataTableComponent,
    InstructValuationDrawerComponent,
  ],
  templateUrl: './valuations-list.component.html',
  styleUrl: './valuations-list.component.scss',
})
export class ValuationsListComponent implements OnInit {
  private readonly api = inject(ValuationsApi);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly perms = inject(PermissionsStore);
  /** Valuation module is its own permission (VALUATION.*), separate from underwriting. */
  readonly canEdit = computed(() => !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('VALUATION', 'edit'));

  readonly rows = signal<Valuation[]>([]);
  readonly columns = VALUATION_COLUMNS;
  readonly activeTab = signal('active');
  readonly counts = signal<Record<string, number>>({});
  // ---- Server-side paging (same pattern as Enquiries / Applications) ----
  readonly page = signal(1);
  readonly perPage = 10;
  readonly total = signal(0);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t} valuations`;
  });
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }
  onTab(key: string): void { this.activeTab.set(key); this.page.set(1); this.load(); }

  readonly instructing = signal(false);
  readonly acting = signal(false);

  readonly report = signal<Valuation | null>(null);
  repMarket = '';
  repGdv = '';
  repCondition: number | null = null;
  repAssumptions = '';
  repRec = '';

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.api.list({ tab: this.activeTab(), page: this.page(), per_page: this.perPage })
      .pipe(catchError(() => of({ rows: [] as Valuation[], meta: null, counts: {} as Record<string, number> })), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.rows.set(res.rows);
        this.counts.set(res.counts || {});
        this.total.set(res.meta?.total ?? res.rows.length);
      });
  }

  readonly kpis = computed(() => [
    { label: 'Instructed', value: this.count('instructed'), caption: 'Awaiting report' },
    { label: 'Report Received', value: this.count('report-received'), caption: 'Received, not reviewed' },
    { label: 'Rejected', value: this.count('rejected'), caption: 'Not supportable' },
    { label: 'Accepted', value: this.count('accepted'), caption: 'Confirmed valuations' },
  ]);

  readonly tabs = computed<TabFilter[]>(() => [
    { key: 'active', label: 'Active (' + (this.counts()['active'] ?? 0) + ')' },
    { key: 'completed', label: 'Completed (' + (this.counts()['completed'] ?? 0) + ')' },
  ]);

  /** Rows already come filtered to the active tab and paged by the server. */
  readonly filtered = computed<Valuation[]>(() => this.rows());

  private count(key: string): number {
    return this.counts()[key] ?? 0;
  }

  fmtMoney(v: number | string | null | undefined): string {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? '£' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : '';
  }
  private numMoney(v: number | string | null): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  openReport(row: Valuation): void {
    this.repMarket = this.fmtMoney(row.market_value);
    this.repGdv = this.fmtMoney(row.gdv_value);
    this.repCondition = row.condition_rating != null ? Number(row.condition_rating) : null;
    this.repAssumptions = row.special_assumptions || '';
    this.repRec = row.recommendation || '';
    this.report.set(row);
  }

  decide(row: Valuation, result: 'accepted' | 'rejected'): void {
    if (!row.id) return;
    this.acting.set(true);
    this.api.decide(row.id, {
      result,
      market_value: this.numMoney(this.repMarket),
      gdv_value: this.numMoney(this.repGdv),
      condition_rating: this.repCondition,
      special_assumptions: this.repAssumptions || null,
      recommendation: this.repRec || null,
    }).pipe(catchError(() => { this.toastr.error('Could not save valuation decision'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Valuation ' + result); this.report.set(null); this.load(); } });
  }

  markReceived(row: Valuation): void {
    if (!row.id) return;
    this.acting.set(true);
    this.api.decide(row.id, { result: 'received' })
      .pipe(catchError(() => { this.toastr.error('Could not update valuation'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Report marked received'); this.load(); } });
  }
  quickDecide(row: Valuation, result: 'accepted' | 'rejected'): void {
    if (!row.id) return;
    this.acting.set(true);
    this.api.decide(row.id, { result })
      .pipe(catchError(() => { this.toastr.error('Could not save valuation decision'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { this.acting.set(false); if (r !== null) { this.toastr.success('Valuation ' + result); this.load(); } });
  }
}
