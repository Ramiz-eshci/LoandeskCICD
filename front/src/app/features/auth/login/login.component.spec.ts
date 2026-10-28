import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let cmp: LoginComponent;
  const auth = { login: jest.fn() };
  const toastr = { warning: jest.fn(), error: jest.fn() };
  let navigate: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }, { provide: ToastrService, useValue: toastr }],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    cmp = fixture.componentInstance;
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('does not call the API with an invalid form and shows the field errors', () => {
    cmp.form.setValue({ email: 'not-an-email', password: '', remember: true });
    cmp.submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(toastr.warning).toHaveBeenCalled();
    expect(cmp.emailError()).toBe('Enter a valid email address.');
    expect(cmp.passwordError()).toBe('Password is required.');
  });

  it('hides errors until a field is touched', () => {
    expect(cmp.emailError()).toBe('');
    expect(cmp.passwordError()).toBe('');
  });

  it('sends only email + password and moves to the OTP step', () => {
    auth.login.mockReturnValue(of({}));
    cmp.form.setValue({ email: 'jane@lender.co.uk', password: 'secret', remember: true });
    cmp.submit();
    expect(auth.login).toHaveBeenCalledWith({ email: 'jane@lender.co.uk', password: 'secret' });
    expect(navigate).toHaveBeenCalledWith(['/mfa']);
    expect(cmp.loading()).toBe(false);
  });

  it('shows a generic message for bad credentials (no account enumeration)', () => {
    auth.login.mockReturnValue(throwError(() => ({ status: 400, error: { message: 'Email does not exist' } })));
    cmp.form.setValue({ email: 'x@y.com', password: 'p', remember: false });
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Invalid email or password.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the server message for a deactivated account (403)', () => {
    auth.login.mockReturnValue(throwError(() => ({ status: 403, error: { message: 'Your account is deactivated.' } })));
    cmp.form.setValue({ email: 'x@y.com', password: 'p', remember: false });
    cmp.submit();
    expect(cmp.errorMsg()).toBe('Your account is deactivated.');
    expect(toastr.error).toHaveBeenCalledWith('Your account is deactivated.', 'Sign in failed');
  });
});
