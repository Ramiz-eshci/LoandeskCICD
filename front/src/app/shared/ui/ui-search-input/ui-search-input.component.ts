import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

/**
 * Search field with a leading icon.
 *  - `variant="header"` — muted pill used in the top bar.
 *  - `variant="field"`  — white bordered form control used in filter bars.
 */
export type SearchVariant = 'header' | 'field';

@Component({
  selector: 'ui-search-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-search-input.component.html',
  styleUrl: './ui-search-input.component.scss',
})
export class UiSearchInputComponent {
  readonly placeholder = input('Search');
  readonly width = input('100%');
  readonly variant = input<SearchVariant>('header');
  readonly value = model('');
}
