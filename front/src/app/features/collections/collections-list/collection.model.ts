export type CollectionStatusKey = 'open' | 'promise-to-pay' | 'legal' | 'resolved';

export interface CollectionCase {
  id: string;
  borrower: string;
  balance: string;
  arrears: string;
  daysOverdue: number;
  statusKey: CollectionStatusKey;
  status: string;
  [key: string]: unknown;
}
