import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { UiBarChartComponent, BarGroup, BarSeries } from '../../../shared/ui/charts/ui-bar-chart.component';
import { UiBarListComponent, BarListItem } from '../../../shared/ui/charts/ui-bar-list.component';
import { UiLineChartComponent, LineSeries } from '../../../shared/ui/charts/ui-line-chart.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiKpiCardComponent } from '../../../shared/ui/ui-kpi-card/ui-kpi-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiSegmentedComponent, SegmentOption } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import {
  DetailColumn,
  DetailRow,
  EnquiryShowcase,
  PortfolioShowcase,
  ReportFilters,
  ReportSection,
  ReportsService,
  ShowcaseReport,
  ShowcaseTile,
  UnderwritingShowcase,
} from '../reports.service';

const NAVY = '#0f2244';
const GOLD = '#eaab00';
const MID = '#1e3a5f';
const LIGHT = '#a8bed6';
const PALETTE = [NAVY, GOLD, MID, LIGHT, '#3f6ea5', '#c98a00', '#6b7f99'];

const STEP_LABELS: Record<number, string> = {
  // Client 22-10-2026: same names as the case screen (7/8/9 are inside Underwriting Review).
  1: 'Initial Review', 2: 'Valuation', 3: 'KYC / AML', 4: 'Solicitor Quote', 5: 'Underwriting Review',
  6: 'Underwriting Review', 7: 'Underwriting Review', 8: 'Underwriting Review', 9: 'Underwriting Review',
  10: 'Final Credit Committee', 11: 'Funds to Solicitor', 12: 'Completion & Move to Portfolio',
};

type ShowcaseSection = 'enquiry' | 'underwriting' | 'portfolio';

const SECTION_LABEL: Record<ShowcaseSection, string> = {
  enquiry: 'Enquiry', underwriting: 'Underwriting', portfolio: 'Portfolio',
};

/**
 * Showcase report — one live, permission-aware page across Enquiry, Underwriting
 * and Portfolio. A high-level dashboard on top; filterable, exportable detail
 * tables below. All figures from GET /api/reports/showcase.
 */
@Component({
  selector: 'app-report-showcase',
  standalone: true,
  imports: [
    UiBarChartComponent,
    UiBarListComponent,
    UiLineChartComponent,
    UiCardComponent,
    UiKpiCardComponent,
    UiPageHeaderComponent,
    UiSegmentedComponent,
    UiDataTableComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-showcase.component.html',
  styleUrl: './report-showcase.component.scss',
})
export class ReportShowcaseComponent implements OnInit {
  private readonly api = inject(ReportsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastr = inject(ToastrService);

  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly data = signal<ShowcaseReport | null>(null);

  readonly headline = computed<ShowcaseTile[]>(() => this.data()?.headline ?? []);
  readonly enquiry = computed<EnquiryShowcase | null>(() => this.data()?.enquiry ?? null);
  readonly underwriting = computed<UnderwritingShowcase | null>(() => this.data()?.underwriting ?? null);
  readonly portfolio = computed<PortfolioShowcase | null>(() => this.data()?.portfolio ?? null);

  readonly generatedAt = computed(() => {
    const iso = this.data()?.context?.generated_at;
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  });

  /* ---- high-level view models ---- */
  readonly enquiryPipeline = computed<BarListItem[]>(() =>
    (this.enquiry()?.pipeline ?? []).map((p, i) => ({ label: p.label, value: p.value, display: String(p.value), color: PALETTE[i % PALETTE.length] })));
  readonly enquiryTrend = computed<LineSeries[]>(() => {
    const t = this.enquiry()?.trend;
    return t ? [{ name: 'Enquiries', color: NAVY, values: t.values, area: true }] : [];
  });
  readonly enquiryTrendLabels = computed<string[]>(() => this.enquiry()?.trend?.labels ?? []);
  readonly uwByStatus = computed<BarListItem[]>(() =>
    (this.underwriting()?.by_status ?? []).map((s, i) => ({ label: s.label, value: s.value, display: String(s.value), color: PALETTE[i % PALETTE.length] })));
  readonly uwStepSeries: BarSeries[] = [{ name: 'Open cases', color: GOLD }];
  readonly uwStepData = computed<BarGroup[]>(() =>
    (this.underwriting()?.by_step ?? []).map((s) => ({ label: STEP_LABELS[s.step] ?? `Step ${s.step}`, values: [s.value] })));
  readonly pfByStatus = computed<BarListItem[]>(() =>
    (this.portfolio()?.by_status ?? []).map((s, i) => ({ label: s.label, value: s.value, display: `${s.value} · ${this.gbpShort(s.principal ?? 0)}`, color: PALETTE[i % PALETTE.length] })));
  readonly pfMaturitySeries: BarSeries[] = [{ name: 'Facilities maturing', color: NAVY }];
  readonly pfMaturityData = computed<BarGroup[]>(() => {
    const m = this.portfolio()?.maturities;
    return m ? m.labels.map((l, i) => ({ label: l, values: [m.counts[i] ?? 0] })) : [];
  });
  readonly hasEnquiryTrend = computed(() => this.enquiryTrendLabels().length > 0);
  readonly hasUwSteps = computed(() => this.uwStepData().length > 0);
  readonly hasMaturities = computed(() => this.pfMaturityData().some((g) => g.values[0] > 0));

  /* ---- detail / filters ---- */
  readonly activeSection = signal<ShowcaseSection>('enquiry');
  readonly from = signal('');
  readonly to = signal('');
  readonly status = signal('');
  readonly search = signal('');
  readonly detailLoading = signal(false);
  readonly exporting = signal('');
  /** Per-section rows; seeded from the showcase payload, replaced on filter. */
  private readonly detailRows = signal<Partial<Record<ShowcaseSection, DetailRow[]>>>({});

  readonly segments = computed<SegmentOption[]>(() => {
    const d = this.data();
    if (!d) return [];
    const out: SegmentOption[] = [];
    (['enquiry', 'underwriting', 'portfolio'] as ShowcaseSection[]).forEach((s) => {
      if (d[s]) out.push({ key: s, label: SECTION_LABEL[s] });
    });
    return out;
  });

  readonly statusOptions = computed<string[]>(() => {
    const d = this.data();
    const sec = this.activeSection();
    return (d?.[sec]?.statuses ?? []) as string[];
  });

  readonly currentRows = computed<DetailRow[]>(() => this.detailRows()[this.activeSection()] ?? []);

  readonly currentColumns = computed<TableColumn<DetailRow>[]>(() => {
    const cols = this.data()?.detail?.columns?.[this.activeSection()] ?? [];
    return cols.map((c) => this.toTableColumn(c));
  });

  readonly currentTitle = computed(() => `${SECTION_LABEL[this.activeSection()]} Records`);

  ngOnInit(): void {
    this.load();
  }

  private load(filters?: ReportFilters): void {
    this.detailLoading.set(true);
    this.api.showcase(filters)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          this.data.set(res);
          this.detailRows.set({ ...res.detail.rows });
          const segs = this.segments();
          if (segs.length && !segs.some((s) => s.key === this.activeSection())) {
            this.activeSection.set(segs[0].key as ShowcaseSection);
          }
        } else {
          this.failed.set(true);
        }
        this.loading.set(false);
        this.detailLoading.set(false);
      });
  }

  private filters(): ReportFilters {
    return {
      from: this.from() || null,
      to: this.to() || null,
      status: this.status() || null,
      search: this.search() || null,
    };
  }

  onSectionChange(key: string): void {
    this.activeSection.set(key as ShowcaseSection);
    this.status.set(''); // status set is per-module
    this.refreshDetail();
  }

  applyFilters(): void {
    this.refreshDetail();
  }

  resetFilters(): void {
    this.from.set(''); this.to.set(''); this.status.set(''); this.search.set('');
    this.refreshDetail();
  }

  private refreshDetail(): void {
    const section = this.activeSection();
    this.detailLoading.set(true);
    this.api.detail(section, this.filters())
      .pipe(catchError(() => { this.toastr.error('Could not load records'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) this.detailRows.update((m) => ({ ...m, [section]: res.rows }));
        this.detailLoading.set(false);
      });
  }

  exportCsv(): void {
    const section = this.activeSection();
    this.exporting.set('csv');
    this.api.exportCsv(section, this.filters())
      .pipe(catchError(() => { this.toastr.error('CSV export failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (blob) this.saveBlob(blob, `${section}-report.csv`);
        this.exporting.set('');
      });
  }

  exportPdf(): void {
    this.exporting.set('pdf');
    this.api.exportPdf(this.filters())
      .pipe(catchError(() => { this.toastr.error('PDF export failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (blob) this.saveBlob(blob, 'lending-performance-report.pdf');
        this.exporting.set('');
      });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }

  /* ---- input handlers (native) ---- */
  setFrom(e: Event): void { this.from.set((e.target as HTMLInputElement).value); }
  setTo(e: Event): void { this.to.set((e.target as HTMLInputElement).value); }
  setStatus(e: Event): void { this.status.set((e.target as HTMLSelectElement).value); this.refreshDetail(); }
  setSearch(e: Event): void { this.search.set((e.target as HTMLInputElement).value); }

  /* ---- formatting ---- */
  private toTableColumn(c: DetailColumn): TableColumn<DetailRow> {
    const header = c.header.toUpperCase();
    if (c.type === 'currency') return { key: c.key, header, align: 'end', mono: true, value: (r) => this.gbpFull(Number(r[c.key] ?? 0)) };
    if (c.type === 'date') return { key: c.key, header, mono: true, value: (r) => this.fmtDate(r[c.key]) };
    if (c.type === 'number') return { key: c.key, header, align: 'end', mono: true, value: (r) => (r[c.key] === null || r[c.key] === undefined ? '—' : String(r[c.key])) };
    return { key: c.key, header, value: (r) => (r[c.key] === null || r[c.key] === undefined ? '—' : String(r[c.key])) };
  }

  tileValue(t: ShowcaseTile): string {
    if (t.format === 'currency') return this.gbpShort(t.value);
    if (t.format === 'percent') return `${t.value}%`;
    return t.value.toLocaleString('en-GB');
  }

  gbpShort(v: number): string {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `£${Math.round(v / 1_000)}K`;
    return `£${Math.round(v)}`;
  }
  gbpFull(v: number): string {
    return '£' + Number(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  fmtDate(v: unknown): string {
    if (!v) return '—';
    const d = new Date(v as string);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
  }
}
