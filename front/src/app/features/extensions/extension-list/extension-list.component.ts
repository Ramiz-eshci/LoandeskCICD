import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, skip } from 'rxjs';

import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiTabFiltersComponent, TabFilter } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { Extension, ExtensionCounts, ExtensionService, extensionTone } from '../extension.service';

interface ExtRow extends Record<string, unknown> {
  id: number;
  ref: string;
  facility: string;
  customer: string;
  months: string;
  maturity: string;
  fees: string;
  status: string;
  raised: string;
}

/**
 * Extensions menu: every extension request while it is being worked / decided
 * (In Progress, Pending Approval), approved ones still waiting on upfront fees
 * (Awaiting Fees), plus decided ones. Opening a row goes to the
 * extension page; approved extensions also show on the facility's Extension tab.
 */
@Component({
  selector: 'app-extension-list',
  standalone: true,
  imports: [UiBadgeComponent, UiButtonDirective, UiCardComponent, UiPageHeaderComponent, UiPaginationComponent,
    UiSearchInputComponent, UiTabFiltersComponent, UiCellDirective, UiDataTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Extensions" subtitle="Facility extension requests handled by the Portfolio team" />

    <ui-tab-filters class="mb-3" [tabs]="tabs()" [active]="view()" (activeChange)="onTab($event)" />

    <div class="mb-3">
      <ui-search-input variant="field" width="440px" placeholder="Search extension, facility or customer…" [(value)]="query" />
    </div>

    <ui-card bodyClass="">
      <ui-data-table [columns]="columns" [rows]="rows()" [rowClickable]="true" [paginate]="false" (rowClick)="open($event)"
        [emptyText]="loading() ? 'Loading extensions…' : 'No extensions here.'">
        <ng-template uiCell="status" let-row>
          <ui-badge [status]="tone(row.status)">{{ row.status }}</ui-badge>
        </ng-template>
        <ng-template uiCell="actions" let-row>
          <button uiButton variant="ghost" size="sm" type="button" (click)="$event.stopPropagation(); open(row)">Open</button>
        </ng-template>
      </ui-data-table>
    </ui-card>

    <ui-pagination class="d-block mt-3" [summary]="pageSummary()" [hasPrevious]="page() > 1" [hasNext]="page() * perPage < total()" (previous)="go(-1)" (next)="go(1)" />
  `,
})
export class ExtensionListComponent implements OnInit {
  private readonly api = inject(ExtensionService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly columns: TableColumn<ExtRow>[] = [
    { key: 'ref', header: 'Extension', width: '120px', mono: true, bold: true },
    { key: 'facility', header: 'Facility', width: '130px', mono: true },
    { key: 'customer', header: 'Customer', width: '200px' },
    { key: 'months', header: 'Extension', width: '110px' },
    { key: 'maturity', header: 'Maturity (current → new)', width: '220px' },
    { key: 'fees', header: 'Fees', width: '170px', mono: true },
    { key: 'status', header: 'Status', width: '160px' },
    { key: 'raised', header: 'Raised', width: '150px' },
    { key: 'actions', header: '', width: '80px' },
  ];

  readonly counts = signal<ExtensionCounts | null>(null);
  readonly tabs = computed<TabFilter[]>(() => {
    const c = this.counts();
    return [
      { key: 'open', label: 'In Progress', count: c?.open },
      // Client 28-10-2026: approved, upfront fees not yet paid - not back in the portfolio yet.
      { key: 'fees', label: 'Awaiting Fees', count: c?.fees },
      { key: 'decided', label: 'Approved', count: c?.decided },
      { key: 'cancelled', label: 'Cancelled', count: c?.cancelled },
      { key: 'all', label: 'All', count: c?.all },
    ];
  });
  readonly view = signal('open');
  readonly query = signal('');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly perPage = 10;
  readonly loading = signal(false);
  readonly rows = signal<ExtRow[]>([]);
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    return `Showing ${from}–${Math.min(this.page() * this.perPage, t)} of ${t}`;
  });

  constructor() {
    toObservable(this.query).pipe(skip(1), debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  ngOnInit(): void {
    this.api.counts().pipe(catchError(() => of(null))).subscribe((c) => {
      if (!c) return;
      this.counts.set(c);
      // Head of Extension lands on what is waiting for them.
      if (c.is_head && c.pending > 0 && this.view() === 'open') { this.view.set('pending'); this.load(); }
    });
    this.load();
  }

  tone(s: string) { return extensionTone(s); }
  onTab(k: string): void { this.view.set(k); this.page.set(1); this.load(); }
  go(d: number): void { this.page.update((p) => Math.max(1, p + d)); this.load(); }
  open(r: ExtRow): void { void this.router.navigate(['/extensions', r.id]); }

  private load(): void {
    this.loading.set(true);
    this.api.list({ view: this.view(), search: this.query().trim() || undefined, page: this.page(), per_page: this.perPage })
      .pipe(catchError(() => of({ rows: [] as Extension[], meta: null })), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.rows.set(res.rows.map((x) => this.toRow(x)));
        this.total.set(res.meta?.total ?? res.rows.length);
        this.loading.set(false);
      });
  }

  private toRow(x: Extension): ExtRow {
    const money = (v: number | null) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(Number(v || 0));
    const fees = [x.ext_fee_amount ? `Ext ${money(x.ext_fee_amount)}` : null, x.doc_fee_amount ? `Doc ${money(x.doc_fee_amount)}` : null].filter(Boolean).join(' · ');
    return {
      id: x.extension_id,
      ref: x.extension_ref,
      facility: x.loan_number,
      customer: x.customer_name,
      months: `${x.extension_months} month${x.extension_months === 1 ? '' : 's'}`,
      maturity: `${this.date(x.current_maturity)} → ${this.date(x.new_maturity)}`,
      fees: fees || '—',
      status: x.awaiting_fees ? 'Awaiting Fees' : x.status,
      raised: `${this.date(String(x.created_at || '').slice(0, 10))}${x.created_by_name ? ' · ' + x.created_by_name : ''}`,
    };
  }

  private date(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
