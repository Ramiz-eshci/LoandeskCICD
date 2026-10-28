import { Directive, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

/**
 * Applies LoanDesk button styling to any <button>/<a>.
 *
 *   <button uiButton variant="accent">+ New Enquiry</button>
 *   <button uiButton variant="ghost" size="sm">Filter</button>
 */
@Directive({
  selector: '[uiButton]',
  standalone: true,
  host: { '[class]': 'classes()' },
})
export class UiButtonDirective {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  protected readonly classes = computed(() => {
    const base = `btn-${this.variant()}`;
    return this.size() === 'sm' ? `${base} btn-sm` : base;
  });
}
