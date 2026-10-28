import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * Page title block with an optional right-hand action slot.
 *
 *   <ui-page-header title="Enquiries" subtitle="4 enquiries · London Branch">
 *     <button uiButton variant="accent">+ New Enquiry</button>
 *   </ui-page-header>
 */
@Component({
  selector: 'ui-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-page-header.component.html',
  styleUrl: './ui-page-header.component.scss',
})
export class UiPageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
