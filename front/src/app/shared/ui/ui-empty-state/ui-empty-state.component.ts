import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/** Centered placeholder for empty lists and unbuilt screens. */
@Component({
  selector: 'ui-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-empty-state.component.html',
  styleUrl: './ui-empty-state.component.scss',
})
export class UiEmptyStateComponent {
  readonly title = input.required<string>();
  readonly message = input('');
  readonly icon = input('bi-inbox');
}
