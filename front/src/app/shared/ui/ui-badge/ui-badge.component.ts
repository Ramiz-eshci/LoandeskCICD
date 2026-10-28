import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/** Semantic tones available in the LoanDesk design system. */
export type BadgeStatus =
  | 'approved'
  | 'pending'
  | 'declined'
  | 'active'
  | 'overdue'
  | 'completed'
  | 'review'
  | 'info'
  | 'closed';

/** Rounded status pill. `<ui-badge status="approved">Converted</ui-badge>` */
@Component({
  selector: 'ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-badge.component.html',
  styleUrl: './ui-badge.component.scss',
})
export class UiBadgeComponent {
  readonly status = input<BadgeStatus>('info');
}
