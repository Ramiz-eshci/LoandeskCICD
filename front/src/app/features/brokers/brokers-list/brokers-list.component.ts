import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, skip } from 'rxjs';

import { PermissionsStore } from '../../../core/session/permissions.store';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { BrokerStatRow, BrokerStatTotals, BrokersService } from '../brokers.service';

type SortKey = 'enquiries' | 'applications' | 'underwriting' | 'completions' | 'portfolio_total' | 'name';

interface BrokerRow {
  [key: string]: unknown;
  id: number;
  name: string;
  company: string;
  contact: string;
  enquiries: string;
  applications: string;
  underwriting: string;
  completions: string;
  conversion: string;
  portfolio: string;
  live: string;
  rate: string;
  lastEnquiry: string;
  active: boolean;
  actions?: string;
  raw: BrokerStatRow;
}

/**
 * Brokers — moved out of Masters into its own menu below Customers (client 20-10-2026).
 * Shows who brings in the most enquiries, applications and completions, the portfolio
 * value they introduced and the average rate on those loans. Add / edit reuse the Broker
 * master form (same table + validation).
 */
@Component({
  selector: 'app-brokers-list',
  standalone: true,
  imports: [
    UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiKpiCardComponent, UiPageHeaderComponent, UiSearchInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './brokers-list.component.html',
  styleUrl: './brokers-list.component.scss',
})
export class BrokersListComponent implements OnInit {
  private readonly api = inject(BrokersService);
  private readonly router = inject(Router);
  private readonly perms = inject(PermissionsStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly query = signal('');
  readonly loading = signal(false);
  readonly data = signal<BrokerStatRow[]>([]);
  readonly totals = signal<BrokerStatTotals | null>(null);
  readonly sortKey = signal<SortKey>('enquiries');

  readonly sortOptions: { key: SortKey; label: string }[] = [
    { key: 'enquiries', label: 'Most enquiries' },
    { key: 'applications', label: 'Most applications' },
    { key: 'underwriting', label: 'Most in underwriting' },
    { key: 'completions', label: 'Most completions' },
    { key: 'portfolio_total', label: 'Highest portfolio value' },
    { key: 'name', label: 'Name A–Z' },
  ];

  readonly canAdd = computed(() => this.perms.isSuperAdmin() || this.perms.can('BROKERS', 'add'));
  readonly canEdit = computed(() => this.perms.isSuperAdmin() || this.perms.can('BROKERS', 'edit'));

  readonly columns: TableColumn<BrokerRow>[] = [
    { key: 'name', header: 'Broker', width: '220px', bold: true },
    { key: 'contact', header: 'Contact', width: '200px' },
    { key: 'enquiries', header: 'Enquiries', width: '95px', align: 'end', mono: true },
    { key: 'applications', header: 'Applications', width: '110px', align: 'end', mono: true },
    { key: 'underwriting', header: 'Underwriting', width: '115px', align: 'end', mono: true },
    { key: 'portfolio', header: 'Portfolio Total', width: '140px', align: 'end', mono: true },
    { key: 'lastEnquiry', header: 'Last Enquiry', width: '120px', mono: true },
    { key: 'actions', header: 'Actions', width: '90px' },
  ];

  readonly rows = computed<BrokerRow[]>(() => {
    const k = this.sortKey();
    const list = [...this.data()];
    list.sort((a, b) => {
      if (k === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      const d = Number(b[k] ?? -1) - Number(a[k] ?? -1);
      return d !== 0 ? d : Number(b.portfolio_total) - Number(a.portfolio_total);
    });
    return list.map((r) => this.toRow(r));
  });

  readonly subtitle = computed(() => {
    const t = this.totals();
    const n = t?.brokers ?? 0;
    return `${n} broker${n === 1 ? '' : 's'} · deal volume by introducer`;
  });
  readonly kpiPortfolio = computed(() => this.money(this.totals()?.portfolio_total ?? 0));
  readonly kpiConversion = computed(() => {
    const t = this.totals();
    return t && t.enquiries ? `${Math.round((t.completions / t.enquiries) * 1000) / 10}%` : '—';
  });

  constructor() {
    toObservable(this.query).pipe(skip(1), debounceTime(350), takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.api.stats(this.query().trim() || undefined)
      .pipe(catchError(() => of({ rows: [] as BrokerStatRow[], totals: null as BrokerStatTotals | null })), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.data.set(res.rows || []);
        this.totals.set(res.totals || null);
        this.loading.set(false);
      });
  }

  setSort(v: string): void { this.sortKey.set(v as SortKey); }
  create(): void { void this.router.navigate(['/masters', 'broker', 'new'], { queryParams: { from: 'brokers' } }); }
  /** Client 22-10-2026: clicking a broker opens its dashboard. */
  open(row: BrokerRow): void { void this.router.navigate(['/brokers', row.id]); }
  edit(row: BrokerRow): void {
    if (!this.canEdit()) return;
    void this.router.navigate(['/masters', 'broker', row.id, 'edit'], { queryParams: { from: 'brokers' } });
  }

  private toRow(r: BrokerStatRow): BrokerRow {
    const count = (v: number) => String(Number(v || 0));
    return {
      id: r.broker_id,
      name: [r.name, r.company && r.company !== r.name ? `(${r.company})` : ''].filter(Boolean).join(' '),
      company: r.company || '',
      contact: [r.email, r.phone].filter(Boolean).join(' · ') || '—',
      enquiries: count(r.enquiries),
      applications: count(r.applications),
      underwriting: count(r.underwriting ?? 0),
      completions: count(r.completions),
      conversion: r.conversion_pct != null ? `${r.conversion_pct}%` : '—',
      portfolio: r.portfolio_total ? this.money(r.portfolio_total) : '—',
      live: r.live_balance ? this.money(r.live_balance) : '—',
      rate: r.avg_rate_pct != null ? `${r.avg_rate_pct}% pm` : '—',
      lastEnquiry: this.formatDate(r.last_enquiry_at),
      active: r.is_active === true || r.is_active === 1,
      raw: r,
    };
  }
  money(v: number): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v || 0));
  }
  private formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
