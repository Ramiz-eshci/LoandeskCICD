import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

export interface PillTab {
  key: string;
  label: string;
  /** bootstrap-icons class name. */
  icon?: string;
}

/**
 * Fully rounded tab pills with optional icons — used for report categories.
 * Active pill is filled with the accent colour.
 */
@Component({
  selector: 'ui-pill-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-pill-tabs.component.html',
  styleUrl: './ui-pill-tabs.component.scss',
})
export class UiPillTabsComponent {
  readonly tabs = input.required<PillTab[]>();
  readonly active = model<string>('');
}
