import type { DemoRequest } from './demo';

const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || 'http://localhost:3400/api').replace(/\/$/, '');

export class DemoSubmissionError extends Error {
  fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export async function submitDemoRequest(request: DemoRequest): Promise<{ request_ref: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/demo-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: request.name.trim(),
        email: request.email.trim(),
        company: request.company.trim(),
        interest: request.interest,
        message: request.message.trim() || null,
      }),
    });
  } catch {
    throw new DemoSubmissionError('We could not reach LoanDesk. Please check your connection and try again.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new DemoSubmissionError('The server returned an unexpected response. Please try again.');
  }

  if (!response.ok || body?.status !== true) {
    const fieldErrors: Record<string, string> = {};
    for (const field of ['name', 'email', 'company', 'interest', 'message']) {
      if (typeof body?.errors?.[field] === 'string') fieldErrors[field] = body.errors[field];
    }
    throw new DemoSubmissionError(
      typeof body?.message === 'string' ? body.message : 'Your demo request could not be saved. Please try again.',
      fieldErrors,
    );
  }

  if (typeof body?.data?.request_ref !== 'string' || !body.data.request_ref.trim()) {
    throw new DemoSubmissionError('The server did not confirm your demo request. Please try again.');
  }
  return { request_ref: body.data.request_ref };
}
