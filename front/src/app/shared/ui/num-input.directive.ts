import { Directive, ElementRef, HostListener, Input, booleanAttribute, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Numeric input guard for money / % fields.
 *  - blocks the minus / plus / exponent keys (no negatives),
 *  - caps the entry at two decimals (or whole numbers when [integer]),
 * writing the cleaned value back through ngModel. Pair with type="number".
 */
@Directive({ selector: '[numInput]', standalone: true })
export class NumInputDirective {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly ctrl = inject(NgControl, { optional: true });

  @Input({ transform: booleanAttribute }) integer = false;
  /** Allow a leading minus so negative figures can be typed (underwriter quotes). */
  @Input({ transform: booleanAttribute }) allowNegative = false;

  @HostListener('keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if ((e.key === '-' && !this.allowNegative) || e.key === '+' || e.key === 'e' || e.key === 'E') { e.preventDefault(); return; }
    if (this.integer && (e.key === '.' || e.key === ',')) e.preventDefault();
  }

  @HostListener('input')
  onInput(): void {
    const input = this.el.nativeElement;
    const raw = input.value ?? '';
    if (raw === '') return;
    const neg = this.allowNegative && /^\s*-/.test(raw);
    let v = raw.replace(/[^\d.]/g, '');
    const dot = v.indexOf('.');
    if (dot >= 0) {
      const intPart = v.slice(0, dot);
      const dec = v.slice(dot + 1).replace(/\./g, '');
      v = this.integer ? intPart : intPart + '.' + dec.slice(0, 2);
    }
    if (neg) v = '-' + v;
    if (v !== raw) {
      input.value = v;
      if (this.ctrl?.control) this.ctrl.control.setValue(v === '' || v === '.' || v === '-' || v === '-.' ? null : Number(v), { emitEvent: true });
    }
  }
}
