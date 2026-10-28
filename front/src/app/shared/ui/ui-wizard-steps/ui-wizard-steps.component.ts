import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

export interface WizardStep {
  key: string;
  label: string;
}

/**
 * Chip rail for long multi-step forms. Completed steps show a check, the
 * current step is filled navy, later steps are muted. Completed chips are
 * clickable so the user can jump back.
 */
@Component({
  selector: 'ui-wizard-steps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-wizard-steps.component.html',
  styleUrl: './ui-wizard-steps.component.scss',
})
export class UiWizardStepsComponent {
  readonly steps = input.required<WizardStep[]>();
  /** Zero-based index of the step being edited. */
  readonly current = input(0);

  readonly stepSelected = output<number>();

  state(i: number): 'done' | 'current' | 'upcoming' {
    if (i < this.current()) return 'done';
    return i === this.current() ? 'current' : 'upcoming';
  }
}
