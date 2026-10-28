import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';

export interface BarListItem {
  label: string;
  /** Numeric weight; the widest item fills the track. */
  value: number;
  /** Text shown on the right; falls back to `value` + `%`. */
  display?: string;
  color?: string;
}

/** Horizontal share breakdown — label, proportional bar and value. */
@Component({
  selector: 'ui-bar-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-bar-list.component.html',
  styleUrl: './ui-bar-list.component.scss',
})
export class UiBarListComponent {
  readonly items = input.required<BarListItem[]>();
  readonly defaultColor = input('var(--accent)');
  /** Rows act as buttons (report drill-down). */
  readonly clickable = input(false);
  readonly itemClick = output<string>();

  protected readonly rows = computed(() => {
    const peak = Math.max(1, ...this.items().map((i) => i.value));
    return this.items().map((i) => ({
      label: i.label,
      display: i.display ?? `${i.value}%`,
      pct: (i.value / peak) * 100,
      color: i.color ?? this.defaultColor(),
    }));
  });
}
