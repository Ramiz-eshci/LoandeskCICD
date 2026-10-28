export const CONTACT = {
  email: (import.meta.env.VITE_SALES_EMAIL as string | undefined)?.trim() || '',
};

export const APP_LOGIN_URL = (import.meta.env.VITE_APP_LOGIN_URL as string | undefined)?.trim() || 'http://localhost:4200/login';

export const HERO_JOURNEY = [
  { label: 'Enquiry', icon: 'chat', title: 'Capture the opportunity.', description: 'Borrower details, security and proposed terms come together in one file.', owner: 'Business development', next: 'Application team', status: 'New enquiry', items: ['Borrower & property', 'Proposed loan terms', 'Enquiry ownership'] },
  { label: 'Application', icon: 'case', title: 'Build the case file.', description: 'Accepted terms and supporting documents travel into the application.', owner: 'Application team', next: 'Underwriting', status: 'Application', items: ['Accepted terms', 'Supporting documents', 'Application handover'] },
  { label: 'Underwriting', icon: 'shield', title: 'Work through the evidence.', description: 'Your underwriter records the checks, findings and recommendation.', owner: 'Underwriting', next: 'Portfolio after completion', status: 'In review', items: ['Valuation instruction', 'KYC / AML records', 'Findings & recommendation'] },
  { label: 'Portfolio', icon: 'trend', title: 'Keep the live loan in view.', description: 'After completion, the file continues into servicing and reporting.', owner: 'Portfolio team', next: 'Ongoing servicing', status: 'Live facility', items: ['Facility & payments', 'Maturity & extensions', 'Portfolio reporting'] },
] as const;

export const PROBLEMS = [
  { title: 'Information is fragmented.', body: 'Enquiries, checklists and documents often sit in separate systems. Bringing them together takes time away from assessing the case.' },
  { title: 'Context is lost at handover.', body: 'Business development, underwriting and portfolio teams need a consistent case history. Rebuilding it at each stage slows the process.' },
  { title: 'Portfolio visibility is limited.', body: 'When progress, outstanding actions and loan servicing sit apart, identifying priorities depends on manual updates across teams.' },
];

export const WORKFLOW = [
  { title: 'Capture the opportunity', label: 'Enquiries & applications', body: 'Keep borrower details, security, proposed terms and supporting documents together. Assign the enquiry and carry the accepted deal into an application.', detail: 'A clear starting point for every case.', items: ['Enquiry ownership', 'Indicative terms & offers', 'Application handover'] },
  { title: 'Work through the evidence', label: 'Underwriting', body: 'Move the case through defined review stages. Record valuation instructions, KYC and AML checks, findings and recommendations with the people responsible.', detail: 'Your team makes the decision. LoanDesk keeps the record.', items: ['Stage checklists', 'Findings & queries', 'Credit and legal review'] },
  { title: 'Keep the live loan in view', label: 'Portfolio', body: 'Continue from completion into servicing. See facilities, payments, interest, customer contact, extensions and redemption within the portfolio workspace.', detail: 'Completion is a handover, not the end of the file.', items: ['Facility overview', 'Payments & maturity', 'Extensions & redemption'] },
];

export const MODULES = [
  { icon: 'chat', title: 'Enquiries & applications', body: 'Manage the pipeline, assign ownership, prepare offers and move accepted enquiries into applications.', tags: ['Pipeline', 'Offers', 'Documents'] },
  { icon: 'shield', title: 'Underwriting workflow', body: 'Bring review stages, checklists, evidence and recorded findings into a shared case workspace.', tags: ['KYC / AML workflow', 'Valuations', 'Credit review'] },
  { icon: 'layers', title: 'Portfolio & servicing', body: 'Follow live facilities through payments, customer contact, extensions and redemption.', tags: ['Facilities', 'Payments', 'Maturity'] },
  { icon: 'trend', title: 'Reporting & oversight', body: 'Review enquiries, applications, underwriting and the live book through module reports and exports.', tags: ['Module reports', 'Filters', 'Exports'] },
] as const;

export const CONTROLS = [
  { title: 'Access shaped around roles', body: 'Permissions govern which modules and actions a team member can access. Keep responsibilities clear across the lending desk.' },
  { title: 'A history behind the case', body: 'Audit records bring changes and activity into view, helping teams follow how a case reached its current stage.' },
  { title: 'Checks at each handover', body: 'Stage requirements and workflow permissions support a consistent review process before a case moves forward.' },
];

export const FAQS = [
  { q: 'Who is LoanDesk built for?', a: 'LoanDesk is built for lending firms and the teams running them: business development, underwriters, credit, legal and portfolio operations. It is a workspace for managing lending activity.' },
  { q: 'Which parts of the lending lifecycle does it cover?', a: 'The platform covers enquiries, applications, staged underwriting and live portfolio servicing, with reporting and administration across the workflow.' },
  { q: 'Does LoanDesk make lending decisions for us?', a: 'Lending decisions remain with your authorised team. LoanDesk organises case information, workflow checks, findings and approvals so the work and its history stay together.' },
  { q: 'Can different teams have different access?', a: 'Yes. Role and module permissions control access to records and actions, including review stages and reporting. We can walk through the permissions relevant to your team during a demo.' },
  { q: 'What can we see in a demo?', a: 'A walkthrough of the journey from enquiry to application, underwriting and portfolio servicing. Tell us where your team spends the most time so we can focus on the relevant workflows.' },
  { q: 'What about integrations, hosting and pricing?', a: 'Bring your data sources, security requirements and operating model to the conversation. We will discuss the deployment, integrations and commercial scope that apply to your firm.' },
];
