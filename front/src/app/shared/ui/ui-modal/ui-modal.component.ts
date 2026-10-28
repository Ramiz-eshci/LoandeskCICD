import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

/**
 * Centered dialog. Render conditionally:
 *   @if (open()) { <ui-modal title="New Enquiry" (closed)="open.set(false)"> ... </ui-modal> }
 * Projected slots: default = body, `[modalFooter]` = footer actions.
 */
@Component({
  selector: 'ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-modal.component.html',
  styleUrl: './ui-modal.component.scss',
})
export class UiModalComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  /**
   * Clicking the backdrop does NOT dismiss the dialog. Most of these modals hold
   * half-finished work (indicative figures, offer fields, credit paper uploads);
   * a stray click outside used to throw it all away. Opt back in per-dialog with
   * [closeOnBackdrop]="true" if a genuinely read-only popup wants it.
   */
  readonly closeOnBackdrop = input(false);

  readonly closed = output<void>();
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');

  onOverlay(event: MouseEvent): void {
    event.stopPropagation();
    if (this.closeOnBackdrop()) this.closed.emit();
  }
}
