import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

export interface FilterChip {
  key: string;
  label: string;
  count?: number;
}

/**
 * Segmented status filter used above list tables: a bordered pill per status
 * with its record count. Two-way bound through `[(active)]`.
 */
@Component({
  selector: 'ui-filter-chips',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-filter-chips.component.html',
  styleUrl: './ui-filter-chips.component.scss',
})
export class UiFilterChipsComponent {
  readonly chips = input.required<FilterChip[]>();
  readonly active = model<string>('all');
}
