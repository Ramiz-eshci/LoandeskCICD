import { UiFitTipDirective } from '../../../shared/ui/table/ui-fit-tip.directive';
import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, debounceTime, of, skip } from 'rxjs';

import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { FilterChip, UiFilterChipsComponent } from '../../../shared/ui/ui-filter-chips/ui-filter-chips.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UnderwritingApi, UwCaseRow, UwStepDef } from '../underwriting.api';

interface Counts { byStep: Record<string, number>; credit: number; awaiting: number; total: number; portfolio?: number; closed?: number; returned?: number; onhold?: number; }

/**
 * Underwriting Work Queue — compact chip filters (same pattern as Enquiries), steps taken
 * from the same meta the detail page uses, so both screens always show the same stages.
 */
@Component({
  selector: 'app-underwriting-list',
  standalone: true,
  imports: [UiPageHeaderComponent, UiPaginationComponent, UiFilterChipsComponent, UiSearchInputComponent, UiFitTipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './underwriting-list.component.html',
  styleUrl: './underwriting-list.component.scss',
})
export class UnderwritingListComponent implements OnInit {
  private readonly api = inject(UnderwritingApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly steps = signal<UwStepDef[]>([]);
  readonly rows = signal<UwCaseRow[]>([]);
  readonly counts = signal<Counts | null>(null);
  readonly error = signal<string | null>(null);
  /** 'live' | 'all' | 'awaiting' | 'portfolio' | 'declined' | 'step-<no>' */
  readonly activeChip = signal('live');
  readonly query = signal('');
  /** "My deals" toggle (client 07-10-2026): false = all underwriters, true = only mine. */
  readonly ownOnly = signal(false);
  toggleOwn(v: boolean): void { this.ownOnly.set(v); this.page.set(1); this.load(); }

  /** Same as the detail page: hide Initial Review (1) and the merged sub-steps 7,8,9. */
  readonly visibleSteps = computed(() => this.steps().filter((s) => ![1, 7, 8, 9].includes(s.no)));
  stepLabel(s: UwStepDef): string { return s.no === 6 ? 'Underwriting Review' : s.name; }
  private displayNo(no: number): number {
    // Match the detail stepper (client 08-10-2026, Requirements to Broker removed).
    if (no === 2) return 1;
    if (no === 4) return 2;
    if (no === 3) return 3;
    if (no === 6) return 4;
    if (no >= 10) return no - 5;
    return 4;
  }


  readonly chips = computed<FilterChip[]>(() => {
    const c = this.counts();
    const closed = c?.closed ?? 0;
    const live = c?.total ?? 0;
    return [
      // Client 07-10-2026: default to live work only. 'All' = every case the All list shows
      // (client 20-10-2026: it missed Moved to Portfolio / On Hold / Returned, so 43 vs 65 cases).
      { key: 'live', label: 'Live', count: live },
      { key: 'all', label: 'All', count: live + closed + (c?.portfolio ?? 0) + (c?.onhold ?? 0) + (c?.returned ?? 0) },
      { key: 'awaiting', label: 'Awaiting Review', count: c?.awaiting ?? 0 },
      ...this.visibleSteps().map((s) => ({ key: 'step-' + s.no, label: this.stepLabel(s),
        count: s.no === 6
          ? ((c?.byStep['6'] ?? 0) + (c?.byStep['7'] ?? 0) + (c?.byStep['8'] ?? 0) + (c?.byStep['9'] ?? 0))
          : (c?.byStep[String(s.no)] ?? 0) })),
      { key: 'onhold', label: 'On Hold', count: c?.onhold ?? 0 },
      { key: 'returned', label: 'Returned to BDM', count: c?.returned ?? 0 },
      { key: 'portfolio', label: 'Moved to Portfolio', count: c?.portfolio ?? 0 },
      { key: 'declined', label: 'Declined / Closed', count: closed },
    ];
  });

  // ---- Server-side paging + filters (chip / search are applied by the API) ----
  readonly page = signal(1);
  // Client 19-10-2026: pagination off for now - every row loads on one page. Set true to bring it back.
  readonly paginate = false; // Client 21-10-2026: pagination removed - every row loads on one page.
  readonly perPage = this.paginate ? 10 : 5000;
  readonly total = signal(0);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t} cases`;
  });
  readonly subtitle = computed(() => `${this.counts()?.total ?? 0} cases · Underwriter is central case owner — coordinates all specialist checks`);

  constructor() {
    toObservable(this.query).pipe(skip(1), debounceTime(350), takeUntilDestroyed())
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  ngOnInit(): void {
    this.api.meta().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((m) => this.steps.set(m?.steps || []));
    this.api.counts().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((c) => this.counts.set(c));
    this.load();
  }

  private load(): void {
    this.error.set(null);
    const chip = this.activeChip();
    this.api.list({
      page: this.page(), per_page: this.perPage,
      // Live hides declined + closed; Declined/Closed shows only those; All shows everything.
      status: chip === 'live' ? 'LIVE' : chip === 'declined' ? 'CLOSED_DECLINED'
        : chip === 'returned' ? 'Returned to BDM' : chip === 'onhold' ? 'On Hold' : undefined,
      tab: chip === 'awaiting' || chip === 'portfolio' ? chip : undefined,
      step: chip.startsWith('step-') ? Number(chip.slice(5)) : undefined,
      search: this.query().trim() || undefined,
      mine: this.ownOnly() || undefined,
    }).pipe(catchError(() => { this.error.set('Could not load underwriting cases.'); return of({ rows: [] as UwCaseRow[], meta: null }); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.rows.set(res.rows);
        this.total.set(res.meta && typeof res.meta.total === 'number' ? res.meta.total : res.rows.length);
      });
  }

  onChip(key: string): void { this.activeChip.set(key); this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  /** Stage cell: same names + numbering as the detail page stepper (merged steps 6-9 = "Underwriting Review"). */
  stageName(step: number): string {
    if ([6, 7, 8, 9].includes(step)) return 'Underwriting Review';
    return this.steps().find((s) => s.no === step)?.name || '—';
  }
  stageNo(step: number): string {
    const d = this.displayNo(step);
    return d ? `Step ${d} of ${this.visibleSteps().length}` : '';
  }

  /** Case status shown in the list — "Moved to Portfolio" once underwriting is complete. */
  statusLabel(r: UwCaseRow): string {
    switch (r.status) {
      case 'In Portfolio': return 'Moved to Portfolio';
      case 'Sent to Credit': return 'With Credit';
      case 'New Review': return 'Awaiting Review';
      default: return r.status || '—';
    }
  }
  statusClass(r: UwCaseRow): string {
    switch (r.status) {
      case 'In Portfolio': return 'st-done';
      case 'Rejected': case 'Closed': return 'st-rej';
      case 'Pending Information': return 'st-query';
      case 'New Review': return 'st-new';
      case 'On Hold': return 'st-hold';
      case 'Returned to BDM': return 'st-returned';
      default: return 'st-prog';
    }
  }
  /** Not touched for 3+ days while still active — show a reminder bell (client 07-10-2026). */
  stale(r: UwCaseRow): boolean {
    if (!['In Progress', 'Pending Information', 'Ready to Proceed', 'New Review'].includes(String(r.status))) return false;
    const ts = r['updated_at'] as string | undefined;
    if (!ts) return false;
    return (Date.now() - new Date(ts).getTime()) > 3 * 86400000;
  }
  staleDays(r: UwCaseRow): number {
    const ts = r['updated_at'] as string | undefined;
    if (!ts) return 0;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  }

  open(r: UwCaseRow): void { void this.router.navigate(['/underwriting', r.underwriting_case_id]); }
  applicant(r: UwCaseRow): string { return r.company_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || '—'; }
  money(v: number | null): string { return v == null ? '—' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  sla(r: UwCaseRow): string { if (!r.sla_due_date) return '—'; const d = Math.ceil((new Date(r.sla_due_date).getTime() - Date.now()) / 86400000); return d < 0 ? 'Breach' : d === 0 ? 'Today' : d + ' days'; }
  slaBreach(r: UwCaseRow): boolean { return r.status !== 'In Portfolio' && !!r.sla_due_date && new Date(r.sla_due_date).getTime() < Date.now(); }
  dotClass(status: string | null): string {
    switch (status) {
      case 'Completed': case 'Approved': return 'passed';
      case 'In Progress': return 'inprog';
      case 'Query Raised': case 'Pending Information': return 'query';
      case 'Rejected': return 'failed';
      case 'Available': return 'assigned';
      default: return 'notstarted';
    }
  }
}
