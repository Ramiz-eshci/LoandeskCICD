export const DEMO_INTERESTS = ['Full platform', 'Enquiries & applications', 'Underwriting workflow', 'Portfolio & servicing', 'Reporting & oversight'] as const;

export interface DemoRequest {
  name: string;
  email: string;
  company: string;
  interest: string;
  message: string;
}

export function validateDemoRequest(request: DemoRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!request.name.trim()) errors.name = 'Enter your name';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(request.email.trim())) errors.email = 'Enter a valid work email';
  if (!request.company.trim()) errors.company = 'Enter your company name';
  if (!DEMO_INTERESTS.some((interest) => interest === request.interest)) errors.interest = 'Choose a valid area of interest';
  if (request.name.length > 120) errors.name = 'Keep your name under 120 characters';
  if (request.email.length > 254) errors.email = 'Keep your email under 254 characters';
  if (request.company.length > 160) errors.company = 'Keep your company name under 160 characters';
  if (request.message.length > 2000) errors.message = 'Keep your message under 2,000 characters';
  return errors;
}
