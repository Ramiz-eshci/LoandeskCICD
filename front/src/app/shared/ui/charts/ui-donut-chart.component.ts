import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import {
  ApexChart,
  ApexDataLabels,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexStroke,
  ApexTooltip,
  NgApexchartsModule,
} from 'ng-apexcharts';

import { CHART_FONT_FAMILY, ChartValueFormat, valueTooltip } from './chart-theme';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Donut chart on ApexCharts with the design-system legend rendered below it. */
@Component({
  selector: 'ui-donut-chart',
  standalone: true,
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-donut-chart.component.html',
  styleUrl: './ui-donut-chart.component.scss',
})
export class UiDonutChartComponent {
  readonly slices = input.required<DonutSlice[]>();
  readonly height = input(200);
  /** Hole size as a percentage of the donut diameter. */
  readonly donutSize = input('68%');
  readonly centreValue = input('');
  readonly centreLabel = input('');
  readonly valueFormat = input<ChartValueFormat>('number');
  /** Built-in legend under the donut (reports draw their own, with values). */
  readonly showLegend = input(true);
  readonly sliceClick = output<string>();
  readonly ariaLabel = input('Donut chart');

  protected readonly dataLabels: ApexDataLabels = { enabled: false };
  protected readonly stroke: ApexStroke = { width: 0 };
  protected readonly legend: ApexLegend = { show: false };
  protected readonly tooltip = computed<ApexTooltip>(() => valueTooltip(this.valueFormat()));

  protected readonly chart = computed<ApexChart>(() => ({
    type: 'donut',
    height: this.height(),
    fontFamily: CHART_FONT_FAMILY,
    toolbar: { show: false },
    parentHeightOffset: 0,
    animations: { enabled: true, speed: 500 },
    events: {
      dataPointSelection: (_e: unknown, _c: unknown, cfg?: { dataPointIndex?: number }) => {
        const s = this.slices()[cfg?.dataPointIndex ?? -1];
        if (s) this.sliceClick.emit(s.label);
      },
    },
  }));

  protected readonly plotOptions = computed<ApexPlotOptions>(() => ({
    pie: {
      expandOnClick: false,
      donut: {
        size: this.donutSize(),
        labels: {
          // Client 22-10-2026: centre text is HTML (apex's overlapped the label and value).
          show: false,
          name: {
            show: true,
            offsetY: 14,
            fontSize: '10px',
            fontFamily: CHART_FONT_FAMILY,
            color: '#5a7394',
            formatter: () => this.centreLabel(),
          },
          value: {
            show: true,
            offsetY: -12,
            fontSize: '18px',
            fontWeight: 700,
            fontFamily: "'DM Mono', ui-monospace, monospace",
            color: '#0f2244',
            formatter: () => this.centreValue(),
          },
          total: {
            show: true,
            showAlways: true,
            label: this.centreLabel(),
            formatter: () => this.centreValue(),
          },
        },
      },
    },
  }));

  protected readonly apexSeries = computed<ApexNonAxisChartSeries>(() =>
    this.slices().map((s) => Math.max(0, s.value)),
  );
  protected readonly labels = computed(() => this.slices().map((s) => s.label));
  protected readonly colors = computed(() => this.slices().map((s) => s.color));
}
