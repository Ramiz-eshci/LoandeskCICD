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
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { NewEnquiryDrawerComponent } from '../enquiry-form/new-enquiry-drawer.component';
import { EnquiriesService } from '../enquiries.service';
import { EnquiryListRow, statusTone } from './enquiry.model';
import { formatDate } from '../../../core/util/date.util';
import { loadErrorMessage } from '../../../core/util/load-error.util';

/** Enquiries list — status chips, search, sort and server-paged pipeline table (real /api/enquiries). */
@Component({
  selector: 'app-enquiries-list',
  standalone: true,
  imports: [
    UiBadgeComponent, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiFilterChipsComponent, NewEnquiryDrawerComponent, UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './enquiries-list.component.html',
  styleUrl: './enquiries-list.component.scss',
})
export class EnquiriesListComponent implements OnInit {
  private readonly api = inject(EnquiriesService);
  private readonly perms = inject(PermissionsStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<EnquiryListRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  // Client 19-10-2026: pagination off for now - every row loads on one page. Set true to bring it back.
  readonly paginate = false; // Client 21-10-2026: pagination removed - every row loads on one page.
  readonly perPage = this.paginate ? 10 : 5000;
  readonly query = signal('');
  readonly activeChip = signal('live');
  readonly sort = signal('enquiry_id');
  readonly dir = signal<'asc' | 'desc'>('desc');
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  readonly counts = signal<{ total: number; byCode: Record<string, number> }>({ total: 0, byCode: {} });

  /** Chase prompt (client 09-10-2026): an enquiry waiting on the client with no movement
   *  for 3+ business days. Based on the last outbound action timestamp (no view tracking). */
  private businessDaysSince(iso?: string | null): number {
    if (!iso) return 0;
    const from = new Date(iso);
    if (isNaN(from.getTime())) return 0;
    const now = new Date();
    const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let d = 0;
    while (cur < end) { cur.setDate(cur.getDate() + 1); const wd = cur.getDay(); if (wd !== 0 && wd !== 6) d++; }
    return d;
  }
  /** Most recent of several timestamps (ISO), or null. */
  private latestTs(...vals: (string | null)[]): string | null {
    let best: string | null = null;
    for (const v of vals) { if (v && (!best || v > best)) best = v; }
    return best;
  }
  private chaseRef(row: EnquiryListRow): { ts: string | null; reason: string } | null {
    const g = (k: string): string | null => { const v = (row as Record<string, unknown>)[k]; return typeof v === 'string' && v ? v : null; };
    if (g('offer_accepted_at')) return null;
    // Client 09-10-2026: the bell reflects INACTIVITY. Any activity on the enquiry bumps
    // updated_at, so the chase clock runs from the latest of updated_at and the status's own
    // send time — doing anything on the enquiry clears the bell; 3 idle business days re-raise it.
    const upd = g('updated_at');
    switch (row.status_code) {
      case 'QUALIFIED':       return { ts: this.latestTs(g('offer_sent_at'), upd), reason: 'Offer sent' };
      case 'INDICATIVE_SENT': return { ts: this.latestTs(g('indicative_sent_at'), upd), reason: 'Indicative sent' };
      case 'CONTACTED':       return { ts: upd, reason: 'Awaiting information' };
      case 'FOLLOW_UP':       return { ts: upd, reason: 'Follow-up' };
      default:                return null;
    }
  }
  chaseDays(row: EnquiryListRow): number { const r = this.chaseRef(row); return r ? this.businessDaysSince(r.ts) : 0; }
  chaseDue(row: EnquiryListRow): boolean { return this.chaseDays(row) >= 3; }
  chaseTitle(row: EnquiryListRow): string {
    const r = this.chaseRef(row); if (!r) return '';
    const d = this.chaseDays(row);
    return `${r.reason} — no response for ${d} business day${d === 1 ? '' : 's'}. Chase the client.`;
  }

  readonly columns: TableColumn<EnquiryListRow>[] = [
    { key: 'enquiry_ref', header: 'ENQUIRY ID', width: '150px', mono: true, bold: true },
    { key: 'created_at', header: 'DATE', width: '95px' },
    { key: 'applicant_name', header: 'APPLICANT', width: '190px' },
    { key: 'source_name', header: 'SOURCE', width: '95px' },
    { key: 'broker_name', header: 'BROKER', width: '130px' },
    { key: 'product_name', header: 'PRODUCT', width: '140px' },
    { key: 'amount_requested', header: 'LOAN AMOUNT', width: '150px', mono: true, bold: true },
    { key: 'term_months', header: 'TERM', width: '65px' },
    { key: 'assigned_to_name', header: 'BDM', width: '110px' },
    { key: 'status_name', header: 'STATUS', width: '120px' },
  ];

  // Curated filter set matching the enquiry workflow steps (per Ramiz).
  // Unassigned catches web/Outlook-intake enquiries that arrive without a BDM.
  private readonly chipDefs: { key: string; label: string }[] = [
    // Client 06-10-2026: default to live work only; 'All' still shows everything.
    { key: 'live', label: 'Live' },
    { key: 'all', label: 'All' },
    // Email / website intake lands as NEW with no BDM, so this chip covers both codes.
    { key: 'NEW,UNASSIGNED', label: 'Unassigned' },
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'CONTACTED', label: 'Awaiting Information' },
    { key: 'INDICATIVE_SENT', label: 'Indicative Sent' },
    { key: 'QUALIFIED', label: 'Offer Sent' },
    { key: 'OFFER_ACCEPTED', label: 'Offer Accepted' },
    { key: 'CONVERTED', label: 'Converted' },
    { key: 'LOST', label: 'Declined' },
  ];
  readonly chips = computed<FilterChip[]>(() => {
    const cnt = this.counts();
    return this.chipDefs.map((c) => ({
      key: c.key,
      label: c.label,
      count: c.key === 'all' ? cnt.total
        : c.key === 'live'
          ? Math.max(0, cnt.total - ((cnt.byCode['CONVERTED'] ?? 0) + (cnt.byCode['LOST'] ?? 0) + (cnt.byCode['CLOSED'] ?? 0)))
        : c.key.split(',').reduce((n, code) => n + (cnt.byCode[code] ?? 0), 0),
    }));
  });

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly subtitle = computed(() => `${this.total()} enquir${this.total() === 1 ? 'y' : 'ies'}` + (this.assignedOnly() ? ' assigned to you' : ''));
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, this.total());
    return `Showing ${from}–${to} of ${this.total()}`;
  });

  readonly canAdd = computed(
    () => !this.perms.loaded() || this.perms.isSuperAdmin() || this.perms.can('ENQUIRIES.ENQUIRY_LIST', 'add'),
  );

  /** Scoped roles (no view_all) only ever see enquiries assigned to them — backend-enforced. */
  readonly assignedOnly = computed(
    () => this.perms.loaded() && !this.perms.isSuperAdmin() && !this.perms.can('ENQUIRIES.ALL_ENQUIRIES', 'view'),
  );

  /** "My deals" toggle (same as Underwriting): false = all BDMs, true = only mine. */
  readonly ownOnly = signal(false);
  toggleOwn(v: boolean): void { this.ownOnly.set(v); this.page.set(1); this.load(); this.loadCounts(); }

  ngOnInit(): void { this.load(); this.loadCounts(); }

  private load(): void {
    this.api
      .list({
        page: this.page(),
        per_page: this.perPage,
        search: this.query().trim() || undefined,
        status_code: this.activeChip() === 'all' ? undefined : (this.activeChip() === 'live' ? 'LIVE' : this.activeChip()),
        sort: this.sort(),
        dir: this.dir(),
        mine: this.ownOnly() || undefined,
      })
      .pipe(
        catchError((e) => {
          this.error.set(loadErrorMessage(e, 'enquiries'));
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
      .pipe(catchError(() => of({ total: 0, byCode: {} })), takeUntilDestroyed(this.destroyRef))
      .subscribe((c) => this.counts.set(c));
  }

  onChip(key: string): void { this.activeChip.set(key); this.page.set(1); this.load(); }
  applySearch(): void { this.page.set(1); this.load(); }
  onSort(ev: Event): void { this.sort.set((ev.target as HTMLSelectElement).value); this.page.set(1); this.load(); }
  toggleDir(): void { this.dir.set(this.dir() === 'asc' ? 'desc' : 'asc'); this.page.set(1); this.load(); }
  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  onCreated(): void { this.creating.set(false); this.page.set(1); this.load(); this.loadCounts(); }
  open(row: EnquiryListRow): void { void this.router.navigate(['/enquiries', row.enquiry_id]); }
  goApplication(ev: Event, row: EnquiryListRow): void {
    ev.stopPropagation();
    void this.router.navigate(['/applications'], { queryParams: { id: row.converted_application_id } });
  }

  tone = statusTone;
  formatDate(v: string): string {
    if (!v) return '—';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : formatDate(d);
  }
  money(v: number | null): string {
    if (v == null) return '—';
    return '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }
}
