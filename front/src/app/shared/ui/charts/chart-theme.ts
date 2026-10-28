import { ApexGrid, ApexTooltip, ApexXAxis, ApexYAxis } from 'ng-apexcharts';

/**
 * ApexCharts option fragments shared by every LoanDesk chart so they all read as
 * one system: dashed #eef2f7 grid on both axes, 11px DM Mono tick labels, no
 * chart chrome and an Inter tooltip.
 */

export const AXIS_FONT = {
  fontSize: '11px',
  fontFamily: "'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  colors: '#5a7394',
} as const;

export const CHART_FONT_FAMILY = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const CHART_GRID: ApexGrid = {
  borderColor: '#eef2f7',
  strokeDashArray: 3,
  xaxis: { lines: { show: true } },
  yaxis: { lines: { show: true } },
  padding: { top: 0, right: 8, bottom: 0, left: 8 },
};

export const CHART_TOOLTIP: ApexTooltip = {
  enabled: true,
  theme: 'light',
  style: { fontSize: '12px', fontFamily: CHART_FONT_FAMILY },
};

/** X axis with no border/ticks — the dashed grid carries the structure.
 *  `slant` (client 26-10-2026, reports): every label at -45° so all charts read alike,
 *  instead of Apex rotating only the charts whose labels happen to overlap. */
export function categoryAxis(categories: string[], slant = false): ApexXAxis {
  return {
    categories,
    axisBorder: { show: false },
    axisTicks: { show: false },
    tooltip: { enabled: false },
    labels: slant
      ? { style: { ...AXIS_FONT }, rotate: -45, rotateAlways: true, hideOverlappingLabels: false, trim: false, maxHeight: 130 }
      : { style: { ...AXIS_FONT } },
  };
}

/** Grid for slanted labels: a -45° label runs down-left from its tick, so a long FIRST label
 *  would be cut off at the chart's left edge - pad the left by roughly its slanted width. */
export function slantGrid(categories: string[]): ApexGrid {
  const first = String(categories[0] ?? '').length;
  const left = Math.min(110, Math.max(8, Math.round(first * 4.7) - 20)); // ~6.6px/char x cos 45°
  return { ...CHART_GRID, padding: { ...CHART_GRID.padding, left } };
}

/** How chart values read: plain numbers, pounds (compact on axes) or days. */
export type ChartValueFormat = 'number' | 'currency' | 'days';

/** Compact label for an axis tick (e.g. £1.2m, £250k). */
export function formatAxisValue(value: number, fmt: ChartValueFormat = 'number'): string {
  const v = Number(value) || 0;
  if (fmt === 'currency') {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `£${Number((v / 1_000_000).toFixed(2))}m`;
    if (a >= 1_000) return `£${Number((v / 1_000).toFixed(1))}k`;
    return `£${Math.round(v)}`;
  }
  return Number(v.toFixed(2)).toString();
}

/** Full value for a tooltip (e.g. £1,250,000). */
export function formatTooltipValue(value: number, fmt: ChartValueFormat = 'number'): string {
  const v = Number(value) || 0;
  if (fmt === 'currency') return '£' + v.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  if (fmt === 'days') return `${Math.round(v)} days`;
  return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/** Y axis clamped to a readable maximum with whole-number ticks. */
export function valueAxis(max: number, tickAmount: number, fmt: ChartValueFormat = 'number'): ApexYAxis {
  return {
    min: 0,
    max,
    tickAmount,
    forceNiceScale: false,
    labels: {
      style: { ...AXIS_FONT },
      formatter: (value: number) => formatAxisValue(value, fmt),
    },
  };
}

/** Tooltip that formats the hovered value. */
export function valueTooltip(fmt: ChartValueFormat, extra: ApexTooltip = {}): ApexTooltip {
  return { ...CHART_TOOLTIP, ...extra, y: { formatter: (v: number) => formatTooltipValue(v, fmt) } };
}

/** Round an axis maximum up to a readable step (1, 2, 2.5, 4, 5, 8 or 10 x 10^n). */
export function niceMax(peak: number, tickCount: number): number {
  if (peak <= 0) return tickCount;
  const rough = peak / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const ladder = [1, 2, 2.5, 4, 5, 8, 10];
  const nice = ladder.find((n) => rough / magnitude <= n) ?? 10;
  return nice * magnitude * tickCount;
}
