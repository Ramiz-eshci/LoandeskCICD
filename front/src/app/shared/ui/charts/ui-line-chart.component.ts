import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexMarkers,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
  NgApexchartsModule,
} from 'ng-apexcharts';

import { CHART_FONT_FAMILY, CHART_GRID, ChartValueFormat, categoryAxis, formatTooltipValue, niceMax, slantGrid, valueAxis, valueTooltip } from './chart-theme';

export interface LineSeries {
  name: string;
  color: string;
  /** null = no data for that point: drawn as a gap, not as zero. */
  values: (number | null)[];
  /** Fill the area under the line with a soft tint of `color`. */
  area?: boolean;
  /** Plot on a second y axis on the right (e.g. a count next to an amount). */
  axis?: 'right';
  /** Format for a right-axis series (axis + tooltip); defaults to `valueFormat`. */
  format?: ChartValueFormat;
}

/** Multi-series line/area chart on ApexCharts, themed to the design system. */
@Component({
  selector: 'ui-line-chart',
  standalone: true,
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-line-chart.component.html',
  styleUrl: './ui-line-chart.component.scss',
})
export class UiLineChartComponent {
  readonly labels = input.required<string[]>();
  readonly series = input.required<LineSeries[]>();
  readonly tickCount = input(4);
  readonly height = input(200);
  /** Value formatting for the y axis + tooltip. */
  readonly valueFormat = input<ChartValueFormat>('number');
  /** Emits the clicked point's index (x position) - report drill-down. */
  readonly pointClick = output<number>();
  readonly ariaLabel = input('Line chart');
  /** Always slant the x-axis labels (reports use this so every chart reads alike). */
  readonly slantLabels = input(false);

  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly grid = computed<ApexGrid>(() => (this.slantLabels() ? slantGrid(this.labels()) : CHART_GRID));
  protected readonly legend: ApexLegend = { show: false };
  protected readonly tooltip = computed<ApexTooltip>(() => {
    const t = valueTooltip(this.valueFormat(), { shared: true, intersect: false });
    if (!this.hasRight()) return t;
    const fmts = this.series().map((s) => this.formatOf(s));
    return { ...t, y: { formatter: (v: number, o?: { seriesIndex?: number }) => formatTooltipValue(v, fmts[o?.seriesIndex ?? 0]) } };
  });
  /** Right-axis series draw dashed so they read apart from the amounts. */
  protected readonly stroke = computed<ApexStroke>(() => ({
    curve: 'straight', width: 2, lineCap: 'round',
    dashArray: this.series().map((s) => (s.axis === 'right' ? 5 : 0)),
  }));
  /** With gaps, a lone month between two gaps has no line - show the points so it is visible. */
  protected readonly markers = computed<ApexMarkers>(() => ({
    size: this.series().some((s) => s.values.some((v) => v == null)) ? 4 : 0,
    hover: { size: 5 },
  }));

  protected readonly chart = computed<ApexChart>(() => ({
    type: 'area',
    height: this.height(),
    fontFamily: CHART_FONT_FAMILY,
    toolbar: { show: false },
    zoom: { enabled: false },
    parentHeightOffset: 0,
    animations: { enabled: true, speed: 500 },
    events: {
      markerClick: (_e: unknown, _c: unknown, cfg?: { dataPointIndex?: number }) => this.pointClick.emit(cfg?.dataPointIndex ?? -1),
    },
  }));

  protected readonly fill = computed<ApexFill>(() => ({
    type: this.series().some((s) => s.area) ? 'gradient' : 'solid',
    opacity: 1,
    gradient: {
      shadeIntensity: 0,
      opacityFrom: 0.2,
      opacityTo: 0,
      stops: [0, 100],
    },
  }));

  protected readonly colors = computed(() => this.series().map((s) => s.color));

  protected readonly apexSeries = computed<ApexAxisChartSeries>(() =>
    this.series().map((s) => ({
      name: s.name,
      // With a right axis the series mix area + line, so each names its own type.
      ...(this.hasRight() ? { type: s.area ? 'area' : 'line' } : {}),
      data: s.values.map((v) => (v == null ? null : Math.max(0, v))),
    })),
  );

  protected readonly xaxis = computed<ApexXAxis>(() => categoryAxis(this.labels(), this.slantLabels()));

  protected readonly yaxis = computed<ApexYAxis | ApexYAxis[]>(() => {
    const ticks = this.tickCount();
    const peak = (ss: LineSeries[]) => Math.max(0, ...ss.flatMap((s) => s.values.map((v) => v ?? 0)));
    const left = this.series().filter((s) => s.axis !== 'right');
    if (!this.hasRight()) return valueAxis(niceMax(peak(left), ticks), ticks, this.valueFormat());
    const right = this.series().filter((s) => s.axis === 'right');
    const rightFmt = this.formatOf(right[0]);
    // A count axis steps in whole numbers (0, 1, 2 ...), never 0.75.
    const rightMax = rightFmt === 'number' ? Math.max(ticks, Math.ceil(peak(right) / ticks) * ticks) : niceMax(peak(right), ticks);
    const leftAxis = valueAxis(niceMax(peak(left), ticks), ticks, this.valueFormat());
    const rightAxis = { ...valueAxis(rightMax, ticks, rightFmt), opposite: true };
    // Apex wants one entry per series; series sharing an axis point at the first one's name.
    return this.series().map((s) => {
      const group = s.axis === 'right' ? right : left;
      return { ...(s.axis === 'right' ? rightAxis : leftAxis), seriesName: group[0]?.name, show: group[0] === s };
    });
  });

  private readonly hasRight = computed(() => this.series().some((s) => s.axis === 'right'));
  private formatOf(s: LineSeries | undefined): ChartValueFormat {
    return s?.axis === 'right' ? (s.format ?? this.valueFormat()) : this.valueFormat();
  }
}
