import { Component, ChangeDetectionStrategy } from '@angular/core';

/** Centred LoanDesk lockup shown above every sign-in step. */
@Component({
  selector: 'app-auth-brand',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-brand.component.html',
  styleUrl: './auth-brand.component.scss',
})
export class AuthBrandComponent {
  failed = false;
}
