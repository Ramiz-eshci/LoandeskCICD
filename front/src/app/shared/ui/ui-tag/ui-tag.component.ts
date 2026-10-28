import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/** Outcome tones for the small square tag. */
export type TagTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

/**
 * Compact 10px outcome tag (4px radius) — used for secondary column states
 * such as "Converted", "Chasing (30d)", "Incomplete", "Rejected".
 * Distinct from <ui-badge>, which is the rounded 11px primary status pill.
 */
@Component({
  selector: 'ui-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-tag.component.html',
  styleUrl: './ui-tag.component.scss',
})
export class UiTagComponent {
  readonly tone = input<TagTone>('neutral');
}
