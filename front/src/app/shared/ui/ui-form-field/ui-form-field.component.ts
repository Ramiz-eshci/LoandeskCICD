import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * Uppercase label + control wrapper. The control itself is projected so the
 * caller keeps full control of the form binding:
 *
 *   <ui-form-field label="Email address">
 *     <input class="form-input" formControlName="email" />
 *   </ui-form-field>
 */
@Component({
  selector: 'ui-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-form-field.component.html',
  styleUrl: './ui-form-field.component.scss',
})
export class UiFormFieldComponent {
  readonly label = input.required<string>();
  readonly for = input<string | null>(null);
  readonly hint = input('');
  readonly error = input('');
}
