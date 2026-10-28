import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

/**
 * Right-hand slide-over panel.
 * Slots: default = body, `[drawerFooter]` = footer actions.
 * `subtitle` renders under the title; `width` overrides the 520px default.
 */
@Component({
  selector: 'ui-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-drawer.component.html',
  styleUrl: './ui-drawer.component.scss',
})
export class UiDrawerComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly width = input(520);
  readonly closed = output<void>();
}
