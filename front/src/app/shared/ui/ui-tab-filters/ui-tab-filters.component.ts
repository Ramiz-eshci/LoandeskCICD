import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

export interface TabFilter {
  key: string;
  label: string;
  count?: number;
}

/**
 * Underlined tab strip used above list tables.
 * `countPosition` places the record count before or after the label.
 * Two-way bound through `[(active)]`.
 */
@Component({
  selector: 'ui-tab-filters',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-tab-filters.component.html',
  styleUrl: './ui-tab-filters.component.scss',
})
export class UiTabFiltersComponent {
  readonly tabs = input.required<TabFilter[]>();
  readonly countPosition = input<'before' | 'after'>('after');
  readonly active = model<string>('all');
}
