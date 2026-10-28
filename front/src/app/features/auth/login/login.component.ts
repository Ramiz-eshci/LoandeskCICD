import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { ToastrService } from 'ngx-toastr';

import { AuthService } from '../../../core/auth/auth.service';

import { AuthBrandComponent } from '../auth-brand/auth-brand.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';

/**
 * Step 1 of the sign-in journey.
 * Wide viewports show the split layout (navy brand panel + white form panel);
 * below 1024px the brand panel collapses and the form centres on its own.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, AuthBrandComponent, UiButtonDirective, UiFormFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: '../auth.css',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toastr = inject(ToastrService);

  readonly reveal = signal(false);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  logoFailed = false;

  readonly highlights = [
    'Loan Origination & Underwriting',
    'Credit Approval & Compliance',
    'Portfolio Management & Servicing',
    'Collections & Recovery',
  ];

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    remember: [true],
  });

  /** Show validation only once the field was touched or the form submitted. */
  showError(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  emailError(): string {
    const c = this.form.controls.email;
    if (!this.showError('email')) return '';
    if (c.hasError('required')) return 'Email address is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return '';
  }

  passwordError(): string {
    const c = this.form.controls.password;
    if (!this.showError('password')) return '';
    if (c.hasError('required')) return 'Password is required.';
    return '';
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastr.warning('Please fix the highlighted fields before continuing.', 'Validation');
      return;
    }
    // Design stage (dev only): advance the journey without calling the API.
    if (!environment.production && environment.designMode) {
      void this.router.navigate(['/mfa']);
      return;
    }
    this.loading.set(true);
    this.errorMsg.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login({ email, password }).subscribe({
      next: () => {
        this.loading.set(false);
        // OTP step is part of the Figma journey; the workspace/permissions are
        // already loaded from the login response by the time MFA completes.
        void this.router.navigate(['/mfa']);
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.loading.set(false);
        // 403 = deactivated account (server message); anything else stays generic.
        const msg = err?.status === 403 && err?.error?.message ? err.error.message : 'Invalid email or password.';
        this.errorMsg.set(msg);
        this.toastr.error(msg, 'Sign in failed');
      },
    });
  }
}
