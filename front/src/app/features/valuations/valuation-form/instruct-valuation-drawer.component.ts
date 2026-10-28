import { Component, ChangeDetectionStrategy, computed, inject, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiDrawerComponent } from '../../../shared/ui/ui-drawer/ui-drawer.component';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';

export const VALUATION_TYPES = ['RICS Red Book', 'Desktop', 'Development Appraisal', 'Drive-by'];
export const VALUER_PANEL = ['Knight Frank LLP', 'Savills', 'CBRE', 'Colliers', 'JLL'];

/** Instruct Valuation — single-page form in a slide-over. */
@Component({
  selector: 'app-instruct-valuation-drawer',
  standalone: true,
  imports: [ReactiveFormsModule, UiButtonDirective, UiDrawerComponent, UiFormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './instruct-valuation-drawer.component.html',
  styleUrl: './instruct-valuation-drawer.component.scss',
})
export class InstructValuationDrawerComponent {
  private readonly fb = inject(FormBuilder);

  readonly closed = output<void>();
  readonly instructed = output<void>();

  readonly types = VALUATION_TYPES;
  readonly panel = VALUER_PANEL;

  readonly form = this.fb.nonNullable.group({
    applicationId: ['', Validators.required],
    address: ['', Validators.required],
    type: ['RICS Red Book'],
    valuer: ['Knight Frank LLP'],
    instructions: [''],
    fee: [''],
    requiredBy: [''],
  });

  errorFor(name: 'applicationId' | 'address'): string {
    const control = this.form.controls[name];
    return control.invalid && control.touched ? 'This field is required.' : '';
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // Design stage: no API call yet.
    this.instructed.emit();
    this.closed.emit();
  }
}
