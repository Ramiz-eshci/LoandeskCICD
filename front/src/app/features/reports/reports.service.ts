import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { CrudService } from '../../core/http/crud.service';
import { API } from '../../core/constants/api-endpoints';
import { ApiResponse } from '../../core/models/api-response.model';

/** Reports (api/routes/reports.routes.js). */
export interface ReportRecord {
  [key: string]: unknown;
}

/* ---- Showcase report payload (api/services/reports.service.js) ---- */

export type TileTone = 'default' | 'positive' | 'warning' | 'danger';
export type TileFormat = 'currency' | 'percent';
export type ReportSection = 'enquiry' | 'application' | 'underwriting' | 'portfolio' | 'finance' | 'summary';

export interface ShowcaseTile {
  label: string;
  value: number;
  caption: string;
  icon: string;
  format?: TileFormat;
  tone?: TileTone;
}

export interface NamedValue {
  code?: string;
  label: string;
  value: number;
  principal?: number;
}

export interface DetailColumn {
  key: string;
  header: string;
  type?: 'currency' | 'date' | 'number';
}

export type DetailRow = Record<string, unknown>;

export interface DetailResult {
  section: ReportSection;
  title: string;
  columns: DetailColumn[];
  rows: DetailRow[];
}

export interface EnquiryShowcase {
  tiles: ShowcaseTile[];
  pipeline: NamedValue[];
  trend: { labels: string[]; values: number[] };
  conversion: { total: number; converted: number; rate_pct: number };
  statuses: string[];
}

export interface UnderwritingShowcase {
  tiles: ShowcaseTile[];
  by_status: NamedValue[];
  by_step: { step: number; value: number }[];
  approval: { decided: number; approved: number; rate_pct: number };
  statuses: string[];
}

export interface PortfolioShowcase {
  tiles: ShowcaseTile[];
  by_status: NamedValue[];
  maturities: { labels: string[]; counts: number[]; principal: number[] };
  written_off: number;
  statuses: string[];
}

export interface ReportFilters {
  from?: string | null;
  to?: string | null;
  status?: string | null;
  search?: string | null;
  bdm?: string | null;
}

export interface ShowcaseReport {
  headline: ShowcaseTile[];
  enquiry?: EnquiryShowcase;
  underwriting?: UnderwritingShowcase;
  portfolio?: PortfolioShowcase;
  detail: {
    columns: Record<ReportSection, DetailColumn[]>;
    rows: Partial<Record<ReportSection, DetailRow[]>>;
  };
  context: {
    title: string;
    subtitle: string;
    filters: ReportFilters;
    user_id: number | null;
    role_id: number | null;
    generated_at: string;
  };
}

/* ---- Per-module report (charts + kpis) ---- */

export interface LineChartData { labels: string[]; keys?: string[]; series: { name: string; values: (number | null)[]; area?: boolean; axis?: 'right'; format?: 'number' | 'currency' | 'days' }[]; }
export interface BarChartData { seriesNames: string[]; keys?: string[]; groups: { label: string; values: number[] }[]; }
export interface DonutChartData { items: { label: string; value: number; principal?: number }[]; }
export interface BarListChartData { items: { label: string; value: number; display?: string }[]; }

export interface SankeyChartData {
  nodes: { id: string; label: string; color?: string }[];
  links: { source: string; target: string; value: number }[];
}

export interface FunnelChartData { items: { label: string; value: number; display?: string; pct?: number; drill?: string | null }[]; }
export interface RadialChartData { items: { label: string; value: number; display?: string }[]; }
export type ReportChartType = 'line' | 'bar' | 'donut' | 'barlist' | 'sankey' | 'funnel' | 'radial' | 'waterfall';
export type ReportValueFormat = 'number' | 'currency' | 'days' | 'percent';
/** Waterfall (client 26-10-2026): total bars + up / down movements, in order. */
export interface WaterfallChartData { items: { label: string; value: number; kind: 'total' | 'up' | 'down'; count?: number }[]; }
export type ReportChartData = LineChartData | BarChartData | DonutChartData | BarListChartData | SankeyChartData | FunnelChartData | RadialChartData | WaterfallChartData;

/** One switchable view of a chart (e.g. Number / Value / By size). */
export interface ReportChartView {
  key: string;
  label: string;
  type?: ReportChartType;
  format?: ReportValueFormat;
  data: ReportChartData;
}

export interface ReportChart {
  id: string;
  title: string;
  subtitle?: string;
  type: ReportChartType;
  format?: ReportValueFormat;
  /** 'full' = whole row; default half width. */
  span?: 'full' | 'half';
  /** Detail-row field a click on this chart filters by (drill-down). */
  drill?: string;
  data: ReportChartData;
  views?: ReportChartView[];
}

export interface BdmOption {
  id: number;
  name: string;
}

export interface ModuleReport {
  section: ReportSection;
  title: string;
  kpis: ShowcaseTile[];
  charts: ReportChart[];
  bdmOptions?: BdmOption[] | null;
  bdmLabel?: string;
  listSummary?: ShowcaseTile[] | null;
  detail: { columns: DetailColumn[]; rows: DetailRow[] };
  context: { filters: ReportFilters; generated_at: string; user_id: number | null };
}

@Injectable({ providedIn: 'root' })
export class ReportsService extends CrudService<ReportRecord> {
  private readonly httpClient = inject(HttpClient);
  private readonly base = environment.apiBaseUrl + API.reports;

  protected override resourcePath(): string {
    return API.reports;
  }

  private toParams(f?: ReportFilters, extra?: Record<string, string>): HttpParams {
    let p = new HttpParams();
    if (f?.from) p = p.set('from', f.from);
    if (f?.to) p = p.set('to', f.to);
    if (f?.status) p = p.set('status', f.status);
    if (f?.search) p = p.set('search', f.search);
    if (f?.bdm) p = p.set('bdm', f.bdm);
    for (const [k, v] of Object.entries(extra ?? {})) if (v) p = p.set(k, v);
    return p;
  }

  /** Live cross-module showcase (high-level + initial detail). */
  showcase(f?: ReportFilters): Observable<ShowcaseReport> {
    return this.httpClient
      .get<ApiResponse<ShowcaseReport>>(this.base + '/showcase', { params: this.toParams(f) })
      .pipe(map((r) => r.data));
  }

  /** Filtered detail rows for one section. */
  detail(section: ReportSection, f?: ReportFilters): Observable<DetailResult> {
    return this.httpClient
      .get<ApiResponse<DetailResult>>(this.base + '/showcase/detail', { params: this.toParams(f, { section }) })
      .pipe(map((r) => r.data));
  }

  /** Whole report as PDF. */
  exportPdf(f?: ReportFilters): Observable<Blob> {
    return this.httpClient.get(this.base + '/showcase/export', {
      params: this.toParams(f, { format: 'pdf' }),
      responseType: 'blob',
    });
  }

  /** Full per-module report: kpis + charts + filtered detail. */
  moduleReport(section: ReportSection, f?: ReportFilters): Observable<ModuleReport> {
    return this.httpClient
      .get<ApiResponse<ModuleReport>>(this.base + '/module/' + section, { params: this.toParams(f) })
      .pipe(map((r) => r.data));
  }

  /** Module report as a real .xlsx workbook. */
  exportModuleXlsx(section: ReportSection, f?: ReportFilters): Observable<Blob> {
    return this.httpClient.get(this.base + '/module/' + section + '/export', {
      params: this.toParams(f, { format: 'xlsx' }),
      responseType: 'blob',
    });
  }

  /** One section as CSV. */
  exportCsv(section: ReportSection, f?: ReportFilters): Observable<Blob> {
    return this.httpClient.get(this.base + '/showcase/export', {
      params: this.toParams(f, { format: 'csv', section }),
      responseType: 'blob',
    });
  }
}
