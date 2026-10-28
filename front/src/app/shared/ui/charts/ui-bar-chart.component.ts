import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexPlotOptions,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
  NgApexchartsModule,
} from 'ng-apexcharts';

import { CHART_FONT_FAMILY, CHART_GRID, ChartValueFormat, categoryAxis, niceMax, slantGrid, valueAxis, valueTooltip } from './chart-theme';

export interface BarGroup {
  /** X-axis label, e.g. 'Mar'. */
  label: string;
  /** One value per series, same order as `series`. */
  values: number[];
}

export interface BarSeries {
  name: string;
  color: string;
}

/**
 * Grouped column chart on ApexCharts, themed to the LoanDesk design system.
 * `columnWidth` is the share of a category slot taken by the whole bar group.
 */
@Component({
  selector: 'ui-bar-chart',
  standalone: true,
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-bar-chart.component.html',
  styleUrl: './ui-bar-chart.component.scss',
})
export class UiBarChartComponent {
  readonly data = input.required<BarGroup[]>();
  readonly series = input.required<BarSeries[]>();
  readonly tickCount = input(4);
  readonly height = input(200);
  /** Share of the category slot filled by the bar group. */
  readonly columnWidth = input('38%');
  readonly barRadius = input(0);
  /** Value formatting for the y axis + tooltip. */
  readonly valueFormat = input<ChartValueFormat>('number');
  /** Emits the clicked group's index (bar or x-axis label) - report drill-down. */
  readonly groupClick = output<number>();
  readonly clickable = input(false);
  readonly ariaLabel = input('Bar chart');
  /** Always slant the x-axis labels (reports use this so every chart reads alike). */
  readonly slantLabels = input(false);

  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly fill: ApexFill = { opacity: 1 };
  protected readonly grid = computed<ApexGrid>(() => (this.slantLabels() ? slantGrid(this.data().map((g) => g.label)) : CHART_GRID));
  protected readonly legend: ApexLegend = { show: false };
  protected readonly tooltip = computed<ApexTooltip>(() => valueTooltip(this.valueFormat(), {}));

  protected readonly chart = computed<ApexChart>(() => ({
    type: 'bar',
    height: this.height(),
    fontFamily: CHART_FONT_FAMILY,
    toolbar: { show: false },
    zoom: { enabled: false },
    parentHeightOffset: 0,
    animations: { enabled: true, speed: 500 },
    events: {
      dataPointSelection: (_e: unknown, _c: unknown, cfg?: { dataPointIndex?: number }) => this.groupClick.emit(cfg?.dataPointIndex ?? -1),
      xAxisLabelClick: (_e: unknown, _c: unknown, cfg?: unknown) => this.groupClick.emit((cfg as { labelIndex?: number } | undefined)?.labelIndex ?? -1),
    },
  }));

  protected readonly plotOptions = computed<ApexPlotOptions>(() => ({
    bar: {
      columnWidth: this.columnWidth(),
      borderRadius: this.barRadius(),
      borderRadiusApplication: 'end',
      dataLabels: { position: 'top' },
    },
  }));

  protected readonly colors = computed(() => this.series().map((s) => s.color));

  protected readonly apexSeries = computed<ApexAxisChartSeries>(() =>
    this.series().map((s, i) => ({
      name: s.name,
      data: this.data().map((g) => Math.max(0, g.values[i] ?? 0)),
    })),
  );

  protected readonly xaxis = computed<ApexXAxis>(() => categoryAxis(this.data().map((g) => g.label), this.slantLabels()));

  protected readonly yaxis = computed<ApexYAxis>(() =>
    valueAxis(niceMax(Math.max(0, ...this.data().flatMap((g) => g.values)), this.tickCount()), this.tickCount(), this.valueFormat()),
  );
}
