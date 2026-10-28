import {
  Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';

import { UiBarChartComponent, BarGroup, BarSeries } from '../../../shared/ui/charts/ui-bar-chart.component';
import { UiBarListComponent, BarListItem } from '../../../shared/ui/charts/ui-bar-list.component';
import { UiLineChartComponent, LineSeries } from '../../../shared/ui/charts/ui-line-chart.component';
import { UiDonutChartComponent, DonutSlice } from '../../../shared/ui/charts/ui-donut-chart.component';
import { UiSankeyComponent, SankeyLink, SankeyNode } from '../../../shared/ui/charts/ui-sankey.component';
import { UiRingGaugesComponent, RingGauge } from '../../../shared/ui/charts/ui-ring-gauges.component';
import { UiWaterfallChartComponent, WaterfallItem, WATERFALL_COLOUR } from '../../../shared/ui/charts/ui-waterfall-chart.component';
import { formatTooltipValue } from '../../../shared/ui/charts/chart-theme';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiSegmentedComponent, SegmentOption } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import {
  BarChartData, BarListChartData, BdmOption, DetailColumn, DetailRow, DonutChartData, FunnelChartData, LineChartData, RadialChartData,
  ModuleReport, ReportChart, ReportChartData, ReportChartType, ReportFilters, ReportSection,
  ReportValueFormat, ReportsService, SankeyChartData, ShowcaseTile, WaterfallChartData,
} from '../reports.service';

const NAVY = '#0f2244', GOLD = '#eaab00', MID = '#1e3a5f', LIGHT = '#a8bed6';
const PALETTE = [NAVY, GOLD, MID, LIGHT, '#3f6ea5', '#c98a00', '#6b7f99', '#8aa6c6'];
/** Outcome series get meaningful colours wherever they appear. */
const SERIES_COLOUR: Record<string, string> = {
  Converted: '#2e8b57', Completed: '#2e8b57', Approved: '#2e8b57', 'Moved to Portfolio': '#2e8b57', 'On time': NAVY,
  Pending: GOLD, Active: GOLD, Live: GOLD, Left: GOLD, 'Still live': GOLD, 'In progress': GOLD,
  Declined: '#d64545', Rejected: '#d64545', 'Rejected / Withdrawn': '#d64545', 'Declined / Closed': '#d64545', 'Lost / declined': '#d64545', 'SLA overdue': '#d64545',
  Closed: '#9aa7b8',
};

const META: Record<ReportSection, { subtitle: string; icon: string }> = {
  enquiry: { subtitle: 'Demand, pipeline, sources, conversion and decline reasons', icon: 'bi-file-earmark-text' },
  application: { subtitle: 'Applications, product mix, BDM, loan size and completion', icon: 'bi-briefcase' },
  underwriting: { subtitle: 'Casebook, steps, decisions, SLA and rejection reasons', icon: 'bi-clipboard-check' },
  portfolio: { subtitle: 'Live book, maturities, interest run-rate and risk', icon: 'bi-bar-chart' },
  finance: { subtitle: 'Interest income, fees, exit fees, money out vs in and the 12-month forecast', icon: 'bi-cash-coin' },
  summary: { subtitle: 'Every enquiry followed through to its outcome', icon: 'bi-diagram-3' },
};

type PresetKey = 'this_month' | 'last_month' | '3m' | '6m' | '12m' | 'ytd' | 'last_year' | 'all';
interface Preset { key: PresetKey; label: string }

/** Everything a chart card needs, computed ONCE per data load (stable references). */
interface PreparedView {
  key: string;
  type: ReportChartType;
  format: ReportValueFormat;
  hasData: boolean;
  lineLabels: string[];
  lineSeries: LineSeries[];
  barGroups: BarGroup[];
  barSeries: BarSeries[];
  donutSlices: DonutSlice[];
  donutTotal: string;
  barList: BarListItem[];
  sankeyNodes: SankeyNode[];
  sankeyLinks: SankeyLink[];
  funnel: { label: string; value: number; display: string; pct: number; width: number; drill: string | null }[];
  rings: RingGauge[];
  waterfall: WaterfallItem[];
  /** Drill value per bar group / line point (month keys), else the label is used. */
  keys: string[];
  /** Chart number format for chart components (they don't know 'percent'). */
  chartFormat: 'number' | 'currency' | 'days';
}
interface PreparedChart {
  id: string;
  drill: string;
  title: string;
  subtitle: string;
  full: boolean;
  options: SegmentOption[];
  views: Map<string, PreparedView>;
  first: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Generic report page (Enquiry / Application / Underwriting / Portfolio / Finance / Summary). */
@Component({
  selector: 'app-module-report',
  standalone: true,
  imports: [
    UiBarChartComponent, UiBarListComponent, UiLineChartComponent, UiDonutChartComponent, UiSankeyComponent, UiRingGaugesComponent,
    UiWaterfallChartComponent, UiCardComponent, UiPageHeaderComponent, UiDataTableComponent, UiSegmentedComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './module-report.component.html',
  styleUrl: './module-report.component.scss',
})
export class ModuleReportComponent implements OnInit {
  private readonly api = inject(ReportsService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toastr = inject(ToastrService);
  readonly waterfallColour = WATERFALL_COLOUR;
  private inflight?: Subscription;

  readonly section = signal<ReportSection>('enquiry');
  /** True while a request runs. The page keeps the previous report on screen (no swap
   *  to a "Loading" block) so the scroll position and the charts stay where they are. */
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** True when the server refused the report (403) — the role can't view this module. */
  readonly forbidden = signal(false);
  readonly data = signal<ModuleReport | null>(null);

  readonly from = signal('');
  readonly to = signal('');
  readonly status = signal('');
  readonly search = signal('');
  readonly bdm = signal('');
  readonly preset = signal<PresetKey | ''>('all');
  readonly exporting = signal(false);
  /** Selected view per chart id (Number / Value / By size…). */
  readonly viewSel = signal<Record<string, string>>({});

  readonly presets: Preset[] = (() => {
    const y = new Date().getFullYear();
    return [
      { key: 'this_month', label: 'This month' },
      { key: 'last_month', label: 'Last month' },
      { key: '3m', label: 'Last 3 months' },
      { key: '6m', label: 'Last 6 months' },
      { key: '12m', label: 'Last 12 months' },
      { key: 'ytd', label: String(y) },
      { key: 'last_year', label: String(y - 1) },
      { key: 'all', label: 'All time' },
    ];
  })();

  readonly title = computed(() => this.data()?.title ?? 'Report');
  readonly subtitle = computed(() => META[this.section()].subtitle);
  readonly kpis = computed<ShowcaseTile[]>(() => this.data()?.kpis ?? []);
  readonly charts = computed<ReportChart[]>(() => this.data()?.charts ?? []);
  readonly bdmOptions = computed<BdmOption[]>(() => this.data()?.bdmOptions ?? []);
  readonly bdmLabel = computed(() => this.data()?.bdmLabel ?? 'BDM');
  readonly listSummary = computed<ShowcaseTile[]>(() => this.data()?.listSummary ?? []);
  readonly generatedAt = computed(() => {
    const at = this.data()?.context?.generated_at;
    return at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  });

  /** Status filter options, taken from an unfiltered load so picking one keeps the rest. */
  readonly statusOptions = signal<string[]>([]);

  /** Chart inputs prepared once per load - toggling a view only swaps that card's inputs. */
  private readonly prepared = computed<PreparedChart[]>(() => {
    const list = this.charts().map((ch) => this.prepare(ch));
    // Client 23-10-2026: no empty half next to a lone chart - a half-width card left alone
    // in its row (odd run of halves before a full card / the end) takes the full width.
    let run = 0;
    list.forEach((c, i) => {
      if (c.full) { run = 0; return; }
      run += 1;
      const next = list[i + 1];
      if ((!next || next.full) && run % 2 === 1) c.full = true;
    });
    return list;
  });

  readonly cards = computed(() => {
    const sel = this.viewSel();
    return this.prepared().map((p) => {
      const key = p.views.has(sel[p.id]) ? sel[p.id] : p.first;
      return { ...p, selected: key, view: p.views.get(key)! };
    });
  });

  readonly detailColumns = computed<TableColumn<DetailRow>[]>(() =>
    (this.data()?.detail?.columns ?? []).map((c) => this.toTableColumn(c)));
  private readonly allDetailRows = computed<DetailRow[]>(() => this.data()?.detail?.rows ?? []);
  /** Drill-down (client 22-10-2026): a click on a chart filters the records table. */
  readonly drillSel = signal<{ field: string; value: string; label: string; chart: string } | null>(null);
  readonly detailRows = computed<DetailRow[]>(() => {
    const d = this.drillSel();
    const rows = this.allDetailRows();
    if (!d) return rows;
    return rows.filter((r) => {
      const v = r[d.field];
      return Array.isArray(v) ? v.includes(d.value) : String(v ?? '') === d.value;
    });
  });
  drill(card: { drill: string; title: string }, value: string | null | undefined, label?: string): void {
    if (!card.drill || value == null || value === '') return;
    this.drillSel.set({ field: card.drill, value: String(value), label: label ?? String(value), chart: card.title });
    setTimeout(() => document.getElementById('report-records')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  drillIndex(card: { drill: string; title: string; view: PreparedView }, i: number, labels: string[]): void {
    this.drill(card, card.view.keys[i] ?? labels[i], labels[i]);
  }
  barLabels(v: PreparedView): string[] { return v.barGroups.map((g) => g.label); }
  clearDrill(): void { this.drillSel.set(null); }
  setPreset(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as PresetKey | '';
    if (v) this.applyPreset(v); else this.preset.set('');
  }

  ngOnInit(): void {
    const sec = (this.route.snapshot.data['section'] as ReportSection) || 'enquiry';
    this.section.set(sec);
    this.load();
  }

  private filters(): ReportFilters {
    return { from: this.from() || null, to: this.to() || null, status: this.status() || null, search: this.search() || null, bdm: this.bdm() || null };
  }

  private load(): void {
    this.inflight?.unsubscribe();
    this.drillSel.set(null);
    this.loading.set(true);
    this.failed.set(false);
    this.forbidden.set(false);
    this.inflight = this.api.moduleReport(this.section(), this.filters())
      .pipe(catchError((e: { status?: number }) => { if (e?.status === 403) this.forbidden.set(true); else this.failed.set(true); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        if (res) {
          if (!this.status()) {
            const st = res.charts.find((c) => c.id === 'status');
            const d = (st?.views?.[0]?.data ?? st?.data) as DonutChartData | undefined;
            if (d?.items) this.statusOptions.set(d.items.map((i) => i.label));
          }
          this.data.set(res);
        }
        this.loading.set(false);
      });
  }

  /* ---- filters ---- */
  applyFilters(): void { this.load(); }
  resetFilters(): void {
    this.from.set(''); this.to.set(''); this.status.set(''); this.search.set(''); this.bdm.set(''); this.preset.set('all');
    this.load();
  }
  setFrom(e: Event): void { this.from.set((e.target as HTMLInputElement).value); this.preset.set(''); }
  setTo(e: Event): void { this.to.set((e.target as HTMLInputElement).value); this.preset.set(''); }
  setStatus(e: Event): void { this.status.set((e.target as HTMLSelectElement).value); this.load(); }
  setBdm(e: Event): void { this.bdm.set((e.target as HTMLSelectElement).value); this.load(); }
  setSearch(e: Event): void { this.search.set((e.target as HTMLInputElement).value); }

  /** Quick date-range buttons (client 22-10-2026). */
  applyPreset(key: PresetKey): void {
    const now = new Date();
    const y = now.getFullYear(); const m = now.getMonth();
    const back = (months: number) => iso(new Date(y, m - months, now.getDate() + 1));
    let from = ''; let to = '';
    switch (key) {
      case 'this_month': from = iso(new Date(y, m, 1)); to = iso(now); break;
      case 'last_month': from = iso(new Date(y, m - 1, 1)); to = iso(new Date(y, m, 0)); break;
      case '3m': from = back(3); to = iso(now); break;
      case '6m': from = back(6); to = iso(now); break;
      case '12m': from = back(12); to = iso(now); break;
      case 'ytd': from = iso(new Date(y, 0, 1)); to = iso(now); break;
      case 'last_year': from = iso(new Date(y - 1, 0, 1)); to = iso(new Date(y - 1, 11, 31)); break;
      default: break;
    }
    this.preset.set(key);
    this.from.set(from);
    this.to.set(to);
    this.load();
  }

  setView(chartId: string, key: string): void {
    this.viewSel.update((s) => ({ ...s, [chartId]: key }));
  }

  exportExcel(): void {
    this.exporting.set(true);
    this.api.exportModuleXlsx(this.section(), this.filters())
      .pipe(catchError(() => { this.toastr.error('Excel export failed'); return of(null); }), takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `${this.section()}-report.xlsx`; a.click();
          URL.revokeObjectURL(url);
        }
        this.exporting.set(false);
      });
  }

  /* ---- chart preparation (palette + formatting), once per load ---- */
  private prepare(ch: ReportChart): PreparedChart {
    const raw = ch.views?.length ? ch.views : [{ key: 'default', label: '', type: ch.type, format: ch.format, data: ch.data }];
    const views = new Map<string, PreparedView>();
    raw.forEach((v) => views.set(v.key, this.prepareView(v.key, v.type ?? ch.type, v.format ?? ch.format ?? 'number', v.data)));
    return {
      id: ch.id,
      drill: ch.drill ?? '',
      title: ch.title,
      subtitle: ch.subtitle ?? '',
      full: ch.span === 'full' || (raw[0].type ?? ch.type) === 'sankey',
      options: raw.length > 1 ? raw.map((v) => ({ key: v.key, label: v.label })) : [],
      views,
      first: raw[0].key,
    };
  }

  private prepareView(key: string, type: ReportChartType, format: ReportValueFormat, data: ReportChartData): PreparedView {
    const colour = (name: string, i: number) => SERIES_COLOUR[name] ?? PALETTE[i % PALETTE.length];
    const pv: PreparedView = {
      key, type, format, hasData: false,
      lineLabels: [], lineSeries: [], barGroups: [], barSeries: [], donutSlices: [], donutTotal: '', barList: [], sankeyNodes: [], sankeyLinks: [],
      funnel: [], rings: [], waterfall: [], keys: [], chartFormat: format === 'percent' ? 'number' : format,
    };
    if (type === 'line') {
      const d = data as LineChartData;
      pv.lineLabels = d.labels;
      pv.lineSeries = d.series.map((s, i) => ({ name: s.name, color: colour(s.name, i), values: s.values, area: s.area, axis: s.axis, format: s.format }));
      pv.keys = d.keys ?? d.labels;
      pv.hasData = d.series.some((s) => s.values.some((v) => (v ?? 0) > 0));
    } else if (type === 'bar') {
      const d = data as BarChartData;
      pv.barGroups = d.groups.map((g) => ({ label: g.label, values: g.values }));
      pv.barSeries = d.seriesNames.map((nme, i) => ({ name: nme, color: colour(nme, i) }));
      pv.keys = d.keys ?? d.groups.map((g) => g.label);
      // An average of 0 days is a real figure (same-day deals), so a days chart with any
      // series has data; counts / values still need something above zero.
      pv.hasData = format === 'days' ? d.seriesNames.length > 0 : d.groups.some((g) => g.values.some((v) => v > 0));
    } else if (type === 'donut') {
      const d = data as DonutChartData;
      pv.donutSlices = d.items.filter((it) => it.value > 0).map((it, i) => ({ label: it.label, value: it.value, color: colour(it.label, i) }));
      pv.donutTotal = format === 'currency' ? this.gbpShort(d.items.reduce((a, b) => a + b.value, 0)) : d.items.reduce((a, b) => a + b.value, 0).toLocaleString('en-GB');
      pv.hasData = pv.donutSlices.length > 0;
    } else if (type === 'waterfall') {
      const d = data as WaterfallChartData;
      pv.waterfall = d.items.map((it) => ({ label: it.label, value: it.value, kind: it.kind, count: it.count }));
      pv.hasData = d.items.some((it) => it.value > 0);
    } else if (type === 'barlist') {
      const d = data as BarListChartData;
      pv.barList = d.items.map((it, i) => ({ label: it.label, value: it.value, display: it.display ?? formatTooltipValue(it.value, pv.chartFormat), color: PALETTE[i % PALETTE.length] }));
      pv.hasData = d.items.length > 0;
    } else if (type === 'funnel') {
      const d = data as FunnelChartData;
      const max = Math.max(1, ...d.items.map((i) => i.value));
      pv.funnel = d.items.map((i) => ({ label: i.label, value: i.value, display: i.display ?? String(i.value), pct: i.pct ?? 0, width: Math.max(8, (i.value / max) * 100), drill: i.drill ?? null }));
      pv.hasData = d.items.some((i) => i.value > 0);
    } else if (type === 'radial') {
      const d = data as RadialChartData;
      const ringCol = ['#0f2244', '#2e8b57', '#eaab00', '#3f6ea5'];
      // Outcome rings take their outcome colour (green done / red declined / gold live).
      pv.rings = d.items.map((i, k) => ({ label: i.label, value: i.value, display: i.display, color: SERIES_COLOUR[i.label] ?? ringCol[k % ringCol.length] }));
      pv.hasData = d.items.length > 0;
    } else if (type === 'sankey') {
      const d = data as SankeyChartData;
      pv.sankeyNodes = d.nodes;
      pv.sankeyLinks = d.links;
      pv.hasData = d.links.some((l) => l.value > 0);
    }
    return pv;
  }

  /* ---- formatting ---- */
  private toTableColumn(c: DetailColumn): TableColumn<DetailRow> {
    const header = c.header.toUpperCase();
    if (c.type === 'currency') return { key: c.key, header, align: 'end', mono: true, value: (r) => this.gbpFull(Number(r[c.key] ?? 0)) };
    if (c.type === 'date') return { key: c.key, header, mono: true, value: (r) => this.fmtDate(r[c.key]) };
    if (c.type === 'number') return { key: c.key, header, align: 'end', mono: true, value: (r) => (r[c.key] == null ? '—' : String(r[c.key])) };
    return { key: c.key, header, value: (r) => (r[c.key] == null ? '—' : String(r[c.key])) };
  }
  tileValue(t: ShowcaseTile): string {
    if (t.format === 'currency') return this.gbpShort(t.value);
    if (t.format === 'percent') return `${t.value}%`;
    return t.value.toLocaleString('en-GB');
  }
  legendValue(v: number, fmt: ReportValueFormat): string { return fmt === 'currency' ? this.gbpShort(v) : formatTooltipValue(v, fmt === 'percent' ? 'number' : fmt); }
  share(v: number, all: { value: number }[]): string {
    const t = all.reduce((a, b) => a + b.value, 0);
    return t ? `${Math.round((v / t) * 1000) / 10}%` : '';
  }
  gbpShort(v: number): string {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `£${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
    if (a >= 10_000) return `£${Math.round(v / 1_000)}K`;
    return '£' + Math.round(v).toLocaleString('en-GB');
  }
  gbpFull(v: number): string { return '£' + Number(v || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 }); }
  fmtDate(v: unknown): string {
    if (!v) return '—';
    const d = new Date(v as string);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
  }
}
