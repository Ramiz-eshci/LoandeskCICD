import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  let cmp: ForgotPasswordComponent;
  const auth = { forgotPassword: jest.fn() };
  const toastr = { error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }, { provide: ToastrService, useValue: toastr }],
    });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not call the API for an invalid e-mail', () => {
    cmp.form.setValue({ email: 'nope' });
    cmp.submit();
    expect(auth.forgotPassword).not.toHaveBeenCalled();
    expect(cmp.emailError()).toBe('Enter a valid email address.');
  });

  it('shows the neutral server message (no hint whether the account exists)', () => {
    auth.forgotPassword.mockReturnValue(of({ status: true, message: 'If an account exists for this email, a password reset link has been sent to it.', data: {} }));
    cmp.form.setValue({ email: 'ghost@lender.co.uk' });
    cmp.submit();
    expect(auth.forgotPassword).toHaveBeenCalledWith('ghost@lender.co.uk');
    expect(cmp.sent()).toBe(true);
    expect(cmp.message()).toBe('If an account exists for this email, a password reset link has been sent to it.');
    expect(cmp.devLink()).toBeNull();
  });

  it('falls back to the neutral message when the API sends none', () => {
    auth.forgotPassword.mockReturnValue(of({ status: true, data: {} }));
    cmp.form.setValue({ email: 'a@b.com' });
    cmp.submit();
    expect(cmp.message()).toMatch(/^If an account exists/);
  });

  it('shows a generic error for server / rate-limit failures', () => {
    auth.forgotPassword.mockReturnValue(throwError(() => ({ status: 429, error: { message: 'Too many attempts, please slow down' } })));
    cmp.form.setValue({ email: 'a@b.com' });
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Too many attempts, please slow down');
    expect(cmp.sent()).toBe(false);
  });
});
