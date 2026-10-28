import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { catchError, of } from 'rxjs';

import { formatDateTime } from '../../../core/util/date.util';
import { loadErrorMessage } from '../../../core/util/load-error.util';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiDrawerComponent } from '../../../shared/ui/ui-drawer/ui-drawer.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiTagComponent } from '../../../shared/ui/ui-tag/ui-tag.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { EmailHistorySummary, EmailLogRow, EmailOptions, EmailService } from '../email.service';

/** yyyy-mm-dd for a date input, in local time. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Masters > Email History (client 17-10-2026): every e-mail the system sent (or failed to
 * send) with module, reference number, To and CC. Defaults to today; search by enquiry /
 * application / extension ref or loan number to see all e-mails for one deal.
 */
@Component({
  selector: 'app-email-history',
  standalone: true,
  imports: [
    FormsModule, UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent, UiDrawerComponent, UiKpiCardComponent,
    UiPageHeaderComponent, UiPaginationComponent, UiTagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './email-history.component.html',
  styleUrl: './email-history.component.scss',
})
export class EmailHistoryComponent implements OnInit {
  private readonly api = inject(EmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  // filters
  from = ymd(new Date());
  to = ymd(new Date());
  module = '';
  event = '';
  status = '';
  search = '';

  readonly opts = signal<EmailOptions | null>(null);
  readonly rows = signal<EmailLogRow[]>([]);
  readonly summary = signal<EmailHistorySummary | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly perPage = 20;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<EmailLogRow | null>(null);
  readonly selectedHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.selected()?.body || ''));

  readonly events = computed(() => {
    const all = (this.opts()?.events || []);
    return this.module ? all.filter((e) => e.module === this.module) : all;
  });

  readonly kpis = computed(() => {
    const s = this.summary();
    return [
      { label: 'Emails', value: s?.total ?? 0, icon: 'bi-envelope', tone: 'default' as const, caption: this.rangeLabel() },
      { label: 'Sent', value: s?.sent ?? 0, icon: 'bi-check2-circle', tone: 'positive' as const, caption: 'Delivered to the mail server' },
      { label: 'Failed', value: s?.failed ?? 0, icon: 'bi-x-circle', tone: (s?.failed ? 'danger' : 'default') as 'danger' | 'default', caption: 'Not sent - see the error' },
      { label: 'Deals / records', value: s?.records ?? 0, icon: 'bi-folder2-open', tone: 'accent' as const, caption: 'Different reference numbers' },
    ];
  });

  readonly columns: TableColumn<EmailLogRow>[] = [
    { key: 'sent_at', header: 'Date / time', width: '150px', mono: true, value: (r) => formatDateTime(r.sent_at) },
    { key: 'module_name', header: 'Module', width: '110px' },
    { key: 'record_ref', header: 'Number', width: '120px', mono: true, value: (r) => r.record_ref || '–' },
    { key: 'event_name', header: 'Email' },
    { key: 'to_list', header: 'To' },
    { key: 'cc_list', header: 'CC', value: (r) => r.cc_list || '–' },
    { key: 'status', header: 'Status', width: '90px' },
  ];

  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const from = this.total() ? (this.page() - 1) * this.perPage + 1 : 0;
    return `Showing ${from}–${Math.min(this.page() * this.perPage, this.total())} of ${this.total()}`;
  });
  readonly subtitle = computed(() => `${this.total()} e-mail(s) · ${this.rangeLabel()}`);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    // Deep link from a record: /masters/email-history?search=ENQ-000123 shows all dates.
    if (qp.get('search')) { this.search = qp.get('search') || ''; this.from = ''; this.to = ''; }
    if (qp.get('module')) this.module = qp.get('module') || '';
    this.api.options().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe((o) => this.opts.set(o));
    this.load();
  }

  rangeLabel(): string {
    if (!this.from && !this.to) return 'all dates';
    const today = ymd(new Date());
    if (this.from === today && this.to === today) return 'today';
    if (this.from === this.to) return this.from;
    return `${this.from || '…'} to ${this.to || '…'}`;
  }

  /** Local-day boundaries sent as ISO (the log is stored in UTC). */
  private bounds(): { from?: string; to?: string } {
    const out: { from?: string; to?: string } = {};
    if (this.from) out.from = new Date(this.from + 'T00:00:00').toISOString();
    if (this.to) { const d = new Date(this.to + 'T00:00:00'); d.setDate(d.getDate() + 1); out.to = d.toISOString(); }
    return out;
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.history({
      ...this.bounds(), module: this.module, event: this.event, status: this.status, search: this.search.trim(),
      page: this.page(), per_page: this.perPage,
    }).pipe(catchError((e) => { this.error.set(loadErrorMessage(e, 'email history')); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        this.loading.set(false);
        if (!r) return;
        this.rows.set(r.rows);
        this.summary.set(r.summary || null);
        this.total.set(Number(r.meta?.total ?? r.rows.length));
      });
  }

  apply(): void { this.page.set(1); this.load(); }

  quick(range: 'today' | '7d' | '30d' | 'all'): void {
    const now = new Date();
    if (range === 'all') { this.from = ''; this.to = ''; }
    else {
      const start = new Date(now);
      start.setDate(now.getDate() - (range === 'today' ? 0 : range === '7d' ? 6 : 29));
      this.from = ymd(start); this.to = ymd(now);
    }
    this.apply();
  }

  onModuleChange(): void { this.event = ''; this.apply(); }

  filterModule(m: string): void { this.module = this.module === m ? '' : m; this.event = ''; this.apply(); }

  reset(): void {
    this.from = ymd(new Date()); this.to = ymd(new Date());
    this.module = ''; this.event = ''; this.status = ''; this.search = '';
    this.apply();
  }

  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  open(r: EmailLogRow): void {
    this.selected.set(r);
    this.api.historyItem(r.email_log_id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((full) => { if (full && this.selected()?.email_log_id === r.email_log_id) this.selected.set(full); });
  }

  /** Show every e-mail for this record (all dates). */
  allForRecord(r: EmailLogRow): void {
    if (!r.record_ref) return;
    this.selected.set(null);
    this.search = r.record_ref; this.from = ''; this.to = ''; this.module = ''; this.event = ''; this.status = '';
    this.apply();
  }

  fmt(v: string | null | undefined): string { return formatDateTime(v); }
}
