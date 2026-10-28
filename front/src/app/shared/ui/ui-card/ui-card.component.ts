import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * White surface with the design-system border/radius.
 * Optional header row: `title` plus a projected `[cardAction]` slot.
 *
 *   <ui-card title="Recent Applications">
 *     <a cardAction class="text-accent fw-semibold">View all &rarr;</a>
 *     ...body...
 *   </ui-card>
 */
@Component({
  selector: 'ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-card.component.html',
  styleUrl: './ui-card.component.scss',
})
export class UiCardComponent {
  readonly title = input('');
  readonly hasHeader = input(false);
  readonly dividedHeader = input(false);
  /** Tailwind-ish padding utility applied to the body; pass '' for flush content (tables). */
  readonly bodyClass = input('p-3');
}
