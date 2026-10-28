import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexGrid,
  ApexLegend,
  ApexPlotOptions,
  ApexTooltip,
  ApexXAxis,
  ApexYAxis,
  NgApexchartsModule,
} from 'ng-apexcharts';

import {
  CHART_FONT_FAMILY, CHART_TOOLTIP, ChartValueFormat, categoryAxis, formatTooltipValue, niceMax, slantGrid, valueAxis,
} from './chart-theme';

/** One waterfall step: a running `total` bar, or an `up` / `down` movement by `value`. */
export interface WaterfallItem {
  label: string;
  value: number;
  kind: 'total' | 'up' | 'down';
  /** Optional number of deals behind a movement (shown in the tooltip). */
  count?: number;
}

export const WATERFALL_COLOUR = { total: '#9aa7b8', up: '#2e8b57', down: '#d64545' } as const;

/**
 * Waterfall (bridge) chart on ApexCharts column ranges (client 26-10-2026): total bars stand
 * on zero, each movement floats from the running total to the new running total.
 */
@Component({
  selector: 'ui-waterfall-chart',
  standalone: true,
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <apx-chart
      [series]="$any(apexSeries())"
      [chart]="chart()"
      [plotOptions]="plotOptions"
      [dataLabels]="dataLabels"
      [grid]="grid()"
      [legend]="legend"
      [tooltip]="tooltip()"
      [xaxis]="xaxis()"
      [yaxis]="yaxis()"
    />
  `,
  styles: [':host { display: block; }'],
})
export class UiWaterfallChartComponent {
  readonly items = input.required<WaterfallItem[]>();
  readonly tickCount = input(4);
  readonly height = input(300);
  readonly valueFormat = input<ChartValueFormat>('currency');
  readonly ariaLabel = input('Waterfall chart');

  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly legend: ApexLegend = { show: false };
  protected readonly plotOptions: ApexPlotOptions = { bar: { horizontal: false, columnWidth: '60%' } };

  /** [low, high] per bar from the running total. */
  private readonly ranges = computed(() => {
    let running = 0;
    return this.items().map((it) => {
      const v = Math.max(0, Number(it.value) || 0);
      let low: number; let high: number;
      if (it.kind === 'total') { running = v; low = 0; high = v; }
      else if (it.kind === 'up') { low = running; high = running + v; running = high; }
      else { high = running; low = Math.max(0, running - v); running = low; }
      return { it, low, high };
    });
  });

  protected readonly chart = computed<ApexChart>(() => ({
    type: 'rangeBar',
    height: this.height(),
    fontFamily: CHART_FONT_FAMILY,
    toolbar: { show: false },
    zoom: { enabled: false },
    parentHeightOffset: 0,
    animations: { enabled: true, speed: 500 },
  }));

  protected readonly apexSeries = computed<ApexAxisChartSeries>(() => [{
    name: 'Loan book',
    data: this.ranges().map((r) => ({ x: r.it.label, y: [r.low, r.high], fillColor: WATERFALL_COLOUR[r.it.kind] })),
  }]);

  protected readonly grid = computed<ApexGrid>(() => slantGrid(this.items().map((i) => i.label)));

  protected readonly tooltip = computed<ApexTooltip>(() => {
    const fmt = this.valueFormat();
    const rows = this.ranges();
    return {
      ...CHART_TOOLTIP,
      custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
        const r = rows[dataPointIndex];
        if (!r) return '';
        const sign = r.it.kind === 'up' ? '+' : r.it.kind === 'down' ? '−' : '';
        const deals = r.it.count ? ` · ${r.it.count} loan${r.it.count === 1 ? '' : 's'}` : '';
        return `<div class="apexcharts-tooltip-title" style="font-family:${CHART_FONT_FAMILY}">${r.it.label}</div>`
          + `<div style="padding:6px 10px;font-family:${CHART_FONT_FAMILY}"><b>${sign}${formatTooltipValue(r.it.value, fmt)}</b>${deals}</div>`;
      },
    };
  });

  protected readonly xaxis = computed<ApexXAxis>(() => ({ ...categoryAxis(this.items().map((i) => i.label), true), type: 'category' }));

  protected readonly yaxis = computed<ApexYAxis>(() =>
    valueAxis(niceMax(Math.max(0, ...this.ranges().map((r) => r.high)), this.tickCount()), this.tickCount(), this.valueFormat()),
  );
}
