export interface Customer {
  id: string;
  name: string;
  type: string;
  kyc: string;
  kycTone: 'success' | 'warning' | 'danger' | 'neutral';
  facilities: number;
  exposure: string;
  arrears: string;
  arrearsTone: 'success' | 'warning' | 'danger' | 'neutral';
  status: string;
  [key: string]: unknown;
}
