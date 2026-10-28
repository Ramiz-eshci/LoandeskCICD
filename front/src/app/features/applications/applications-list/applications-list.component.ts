import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { FilterChip, UiFilterChipsComponent } from '../../../shared/ui/ui-filter-chips/ui-filter-chips.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTagComponent, TagTone } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { ApplicationsService } from '../applications.service';
import { ApplicationListRow, applicationTone } from './application.model';
import { loadErrorMessage } from '../../../core/util/load-error.util';

/** Applications list — stage chips, search and the server-paged pipeline table (real /api/applications). */
@Component({
  selector: 'app-applications-list',
  standalone: true,
  imports: [
    UiBadgeComponent, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiFilterChipsComponent, UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './applications-list.component.html',
  styleUrl: './applications-list.component.scss',
})
export class ApplicationsListComponent implements OnInit {
  private readonly api = inject(ApplicationsService);
  private readonly perms = inject(PermissionsStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<ApplicationListRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  // Client 19-10-2026: pagination off for now - every row loads on one page. Set true to bring it back.
  readonly paginate = false; // Client 21-10-2026: pagination removed - every row loads on one page.
  readonly perPage = this.paginate ? 10 : 5000;
  readonly query = signal('');
  readonly activeChip = signal('live');
  readonly error = signal<string | null>(null);
  readonly counts = signal<{ total: number; byStage: Record<string, number> }>({ total: 0, byStage: {} });

  readonly columns: TableColumn<ApplicationListRow>[] = [
    { key: 'application_ref', header: 'APPLICATION', width: '120px', mono: true, bold: true },
    { key: 'applicant_name', header: 'APPLICANT', width: '160px' },
    { key: 'product_name', header: 'PRODUCT', width: '150px' },
    { key: 'amount_requested', header: 'LOAN AMOUNT', width: '130px', mono: true, bold: true },
    { key: 'term_months', header: 'TERM', width: '65px' },
    { key: 'total_ltv_pct', header: 'Total LTV', width: '80px' },
    { key: 'bdm_name', header: 'BDM', width: '95px' },
    { key: 'status_name', header: 'STATUS', width: '125px' },
    { key: 'actions', header: 'ACTIONS', width: '90px' },
  ];

  private readonly chipDefs: { key: string; label: string }[] = [
    // Client 06-10-2026: default to live work only; 'All' still shows everything.
    { key: 'live', label: 'Live' },
    { key: 'all', label: 'All' },
    // Client 15-10-2026: DRAFT ("Awaiting Initial Review") has its own chip, apart from Submitted.
    { key: 'awaiting-review', label: 'Awaiting Initial Review' },
    { key: 'underwriting', label: 'Underwriting' },
    // Client 15-10-2026: Credit Review + Legal stages retired (committee is part of underwriting).
    { key: 'approved', label: 'Approved' },
    { key: 'completed', label: 'Completed' },
    { key: 'declined', label: 'Declined' },
  ];
  readonly chips = computed<FilterChip[]>(() => {
    const cnt = this.counts();
    return this.chipDefs.map((c) => ({
      key: c.key,
      label: c.label,
      count: c.key === 'all' ? cnt.total
        // Client 16-10-2026: Live = Awaiting Initial Review + Underwriting + Approved.
        : c.key === 'live' ? (cnt.byStage['awaiting-review'] ?? 0) + (cnt.byStage['underwriting'] ?? 0) + (cnt.byStage['approved'] ?? 0)
        : (cnt.byStage[c.key] ?? 0),
    }));
  });

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly subtitle = computed(() => `${this.total()} application${this.total() === 1 ? '' : 's'} · ${this.activeChip() === 'all' ? 'All stages' : this.chipDefs.find((c) => c.key === this.activeChip())?.label}`);
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, this.total());
    return `Showing ${from}–${to} of ${this.total()} applications`;
  });

  /** Temp master switch to hide New Application until the create flow is ready. */
  readonly showNewApplication = false;

  readonly canAdd = computed(
    () => !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('APPLICATIONS.APPLICATION_LIST', 'add'),
  );

  /** Scoped roles (no ALL_APPLICATIONS view) only see their own applications — backend-enforced. */
  readonly assignedOnly = computed(
    () => this.perms.loaded() && !this.perms.isSuperAdmin() && !this.perms.can('APPLICATIONS.ALL_APPLICATIONS', 'view'),
  );
  /** "My deals" toggle (same as Underwriting): false = all BDMs, true = only where I am the BDM. */
  readonly ownOnly = signal(false);
  toggleOwn(v: boolean): void { this.ownOnly.set(v); this.page.set(1); this.load(); this.loadCounts(); }

  ngOnInit(): void { this.load(); this.loadCounts(); }

  private load(): void {
    this.api
      .list({
        page: this.page(),
        per_page: this.perPage,
        search: this.query().trim() || undefined,
        stage: this.activeChip() === 'all' ? undefined : this.activeChip(),
        mine: this.ownOnly() || undefined,
      })
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'applications'));
          return of({ rows: [], meta: null });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.error.set(null);
        this.rows.set(res.rows);
        this.total.set(res.meta && typeof res.meta.total === 'number' ? res.meta.total : res.rows.length);
      });
  }

  private loadCounts(): void {
    this.api.counts(this.ownOnly())
      .pipe(catchError(() => of({ total: 0, byStage: {} })), takeUntilDestroyed(this.destroyRef))
      .subscribe((c) => this.counts.set(c));
  }

  onChip(key: string): void { this.activeChip.set(key); this.page.set(1); this.load(); }
  applySearch(): void { this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  open(row: ApplicationListRow): void { void this.router.navigate(['/applications', row.application_id]); }
  newApplication(): void { void this.router.navigate(['/applications/new']); }

  tone = applicationTone;
  offerTone(state: string | null): TagTone {
    switch (String(state || '').toUpperCase()) {
      case 'ACCEPTED': return 'success';
      case 'DECLINED': return 'danger';
      case 'INDICATIVE_FOLLOWUP':
      case 'CHASING': return 'warning';
      default: return 'neutral';
    }
  }
  slaTone(days: number | null): 'ok' | 'warn' | 'breach' {
    if (days == null) return 'ok';
    if (days <= 0) return 'breach';
    if (days === 1) return 'warn';
    return 'ok';
  }
  money(v: number | null): string {
    if (v == null) return '—';
    return '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
}
