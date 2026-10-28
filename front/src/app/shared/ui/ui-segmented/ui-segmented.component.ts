import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

export interface SegmentOption {
  key: string;
  label: string;
}

/**
 * Single-choice button group used for short enumerations in forms
 * (applicant type, credit score, KYC outcome…). Two-way bound via `[(value)]`.
 */
@Component({
  selector: 'ui-segmented',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-segmented.component.html',
  styleUrl: './ui-segmented.component.scss',
})
export class UiSegmentedComponent {
  readonly options = input.required<SegmentOption[]>();
  readonly value = model<string>('');
}
