import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

/** Thin accent progress bar with an optional label/value row. */
@Component({
  selector: 'ui-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-progress.component.html',
  styleUrl: './ui-progress.component.scss',
})
export class UiProgressComponent {
  readonly value = input.required<number>();
  readonly label = input('');
  readonly showValue = input(true);

  protected readonly clamped = computed(() => Math.max(0, Math.min(100, Math.round(this.value()))));
}
