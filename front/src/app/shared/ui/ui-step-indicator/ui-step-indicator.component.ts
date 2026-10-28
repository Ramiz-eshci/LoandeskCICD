import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

export interface StepItem {
  label: string;
}

/**
 * Numbered step rail.
 *  - `variant="progress"` — steps before `current` are done, `current` is active.
 *  - `variant="pipeline"` — every step rendered as a filled stage marker, used
 *    to show a fixed process (e.g. the legal pipeline) rather than progress.
 */
@Component({
  selector: 'ui-step-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-step-indicator.component.html',
  styleUrl: './ui-step-indicator.component.scss',
})
export class UiStepIndicatorComponent {
  readonly steps = input.required<StepItem[]>();
  /** Zero-based index of the active step (progress variant only). */
  readonly current = input(0);
  readonly variant = input<'progress' | 'pipeline'>('progress');
  /** Tighter circles, labels and connectors for narrow containers. */
  readonly compact = input(false);
  /** When true, steps the user has already reached can be clicked to navigate. */
  readonly clickable = input(false);
  /** Highest index that may be clicked (e.g. furthest step reached). -1 = no cap. */
  readonly maxStep = input(-1);
  /** Emits the step index when a clickable step is selected. */
  readonly stepSelect = output<number>();

  canClick(i: number): boolean {
    if (!this.clickable()) return false;
    const cap = this.maxStep();
    return cap < 0 || i <= cap;
  }
  pick(i: number): void {
    if (this.canClick(i)) this.stepSelect.emit(i);
  }

  state(i: number): 'done' | 'active' | 'upcoming' {
    if (this.variant() === 'pipeline') return 'done';
    if (i < this.current()) return 'done';
    return i === this.current() ? 'active' : 'upcoming';
  }
}
