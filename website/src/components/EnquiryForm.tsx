import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEMO_INTERESTS, validateDemoRequest, type DemoRequest } from '../lib/demo';
import { DemoSubmissionError, submitDemoRequest } from '../lib/api';

export function DemoConfirmation({ email }: { email: string }) {
  const confirmation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmation.current?.focus();
  }, []);

  return (
    <div ref={confirmation} className="form-card demo-success" role="region" tabIndex={-1} aria-labelledby="demo-success-title" aria-describedby="demo-success-description demo-success-contact">
      <span className="demo-success-mark" aria-hidden="true">✓</span>
      <span className="form-kicker">Demo request received</span>
      <h3 id="demo-success-title">Thank you for your interest.</h3>
      <p id="demo-success-description">Our team will be in touch to discuss your requirements and arrange a tailored demonstration of LoanDesk.</p>
      <div className="demo-contact" id="demo-success-contact"><span>We’ll contact you at</span><strong>{email}</strong></div>
      <a className="text-link" href="#platform">Explore the platform <span aria-hidden="true">↗</span></a>
    </div>
  );
}

export default function EnquiryForm() {
  const [request, setRequest] = useState<DemoRequest>({
    name: '', email: '', company: '', interest: DEMO_INTERESTS[0], message: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState('');
  const submitting = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors = validateDemoRequest(request);
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) {
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${Object.keys(nextErrors)[0]}"]`)?.focus();
      return;
    }
    submitting.current = true;
    setSending(true);
    try {
      await submitDemoRequest(request);
      setSubmitted(true);
    } catch (error) {
      if (error instanceof DemoSubmissionError) setErrors(error.fieldErrors);
      setServerError(error instanceof Error ? error.message : 'Your request could not be saved. Please try again.');
    } finally {
      submitting.current = false;
      setSending(false);
    }
  }

  if (submitted) return <DemoConfirmation email={request.email.trim()} />;

  function fieldError(key: string) {
    return errors[key] ? <span id={`demo-${key}-error`} className="field-error">{errors[key]}</span> : null;
  }

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate aria-busy={sending} aria-labelledby="demo-form-title" aria-describedby="demo-form-intro">
      <span className="form-kicker">A demonstration for your team</span>
      <h3 id="demo-form-title">Book a LoanDesk demo.</h3>
      <p className="form-intro" id="demo-form-intro">Tell us about your firm and the workflows you’d like to explore. Fields marked * are required.</p>
      <fieldset className="demo-fields" disabled={sending}>
      <div className="form-grid">
        <label className="field">
          <span>Full name <span aria-hidden="true">*</span></span>
          <input name="name" autoComplete="name" required maxLength={120} placeholder="Jane Smith" value={request.name} onChange={(event) => setRequest({ ...request, name: event.target.value })} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'demo-name-error' : undefined} />
          {fieldError('name')}
        </label>
        <label className="field">
          <span>Work email <span aria-hidden="true">*</span></span>
          <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="jane@yourfirm.co.uk" value={request.email} onChange={(event) => setRequest({ ...request, email: event.target.value })} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'demo-email-error' : undefined} />
          {fieldError('email')}
        </label>
      </div>
      <label className="field">
        <span>Company <span aria-hidden="true">*</span></span>
        <input name="company" autoComplete="organization" required maxLength={160} placeholder="Your lending firm" value={request.company} onChange={(event) => setRequest({ ...request, company: event.target.value })} aria-invalid={!!errors.company} aria-describedby={errors.company ? 'demo-company-error' : undefined} />
        {fieldError('company')}
      </label>
      <label className="field">
        <span>Interested in</span>
        <select name="interest" value={request.interest} onChange={(event) => setRequest({ ...request, interest: event.target.value })} aria-invalid={!!errors.interest} aria-describedby={errors.interest ? 'demo-interest-error' : undefined}>
          {DEMO_INTERESTS.map((interest) => <option key={interest}>{interest}</option>)}
        </select>
        {fieldError('interest')}
      </label>
      <label className="field">
        <span>What would you like to explore? <small>Optional</small></span>
        <textarea name="message" rows={3} maxLength={2000} placeholder="Your current process, team size, or the workflows you want to improve…" value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} aria-invalid={!!errors.message} aria-describedby={errors.message ? 'demo-message-error' : undefined} />
        {fieldError('message')}
      </label>
      <button className="btn-primary form-submit" type="submit">{sending ? 'Sending your request…' : 'Request a demo'} <span aria-hidden="true">↗</span></button>
      </fieldset>
      {serverError ? <p className="form-error" role="alert">{serverError}</p> : null}
      <p className="form-fine">We’ll use your details to respond to your demo request. Please do not include borrower information or sensitive documents.</p>
    </form>
  );
}
