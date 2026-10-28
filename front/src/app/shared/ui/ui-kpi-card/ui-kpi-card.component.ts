import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/** Value colour. */
export type KpiTone = 'default' | 'positive' | 'warning' | 'danger' | 'accent';

/**
 * Metric tile used across the dashboards.
 *
 *  - `labelStyle="caps"`  uppercase 11px label (dashboard, portfolio, reports)
 *  - `labelStyle="plain"` sentence-case 14px label (valuations, legal)
 *  - `iconPlacement="corner"` circular icon on the right of the label row
 *  - `iconPlacement="inline"` icon immediately before the label
 */
@Component({
  selector: 'ui-kpi-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-kpi-card.component.html',
  styleUrl: './ui-kpi-card.component.scss',
})
export class UiKpiCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly caption = input('');
  readonly delta = input('');
  readonly deltaDown = input(false);
  readonly icon = input('');
  readonly iconPlacement = input<'corner' | 'inline'>('corner');
  readonly bareIcon = input(false);
  readonly labelStyle = input<'caps' | 'plain'>('caps');
  readonly tone = input<KpiTone>('default');
  readonly valueSize = input(32);
  readonly mono = input(true);
  /** Tighter padding / spacing so many tiles fit on one line (client 26-10-2026, Portfolio). */
  readonly compact = input(false);
}
