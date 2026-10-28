import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

/** Table footer: record count on the left, previous/next on the right. */
@Component({
  selector: 'ui-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-pagination.component.html',
  styleUrl: './ui-pagination.component.scss',
})
export class UiPaginationComponent {
  readonly summary = input.required<string>();
  readonly hasPrevious = input(false);
  readonly hasNext = input(false);

  readonly previous = output<void>();
  readonly next = output<void>();
}
