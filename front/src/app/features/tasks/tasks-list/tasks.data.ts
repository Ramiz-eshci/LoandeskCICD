import { TaskBucket, WorkTask } from './task.model';

/** Design-stage sample data. */
export const TASKS: WorkTask[] = [
  {
    type: 'Missing Documents',
    priority: 'High',
    subject: 'Rachel & Thomas Green',
    reference: 'APP-000454',
    due: 'Today',
    bucket: 'overdue',
  },
  {
    type: 'Valuation Review',
    priority: 'High',
    subject: 'John Smith',
    reference: 'APP-000458',
    due: 'Today',
    bucket: 'today',
  },
  {
    type: 'Application Review',
    priority: 'High',
    subject: 'Harrison Properties Ltd',
    reference: 'APP-000457',
    due: '23 Aug',
    bucket: 'today',
  },
  {
    type: 'KYC Renewal',
    priority: 'Medium',
    subject: 'Premier Retail Ltd',
    reference: 'CUST-00873',
    due: 'Tomorrow',
    bucket: 'upcoming',
  },
  {
    type: 'Maturity Warning',
    priority: 'High',
    subject: 'Nexus Developments Ltd',
    reference: 'FAC-001215',
    due: '25 Aug',
    bucket: 'upcoming',
  },
  {
    type: 'Arrears Follow-Up',
    priority: 'Medium',
    subject: 'Bridgeford Corp Ltd',
    reference: 'ARR-00088',
    due: '28 Aug',
    bucket: 'upcoming',
  },
];

export const TASK_BUCKETS: { key: TaskBucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due Today' },
  { key: 'upcoming', label: 'Upcoming' },
];
