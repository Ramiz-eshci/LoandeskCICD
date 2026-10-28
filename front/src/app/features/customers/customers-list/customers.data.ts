import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { Customer } from './customer.model';

/** Design-stage sample data. */
export const CUSTOMERS: Customer[] = [
  {
    id: 'CUST-000112',
    name: 'Lakeside Holdings Ltd',
    type: 'Company',
    kyc: 'Verified',
    kycTone: 'success',
    facilities: 1,
    exposure: '£450,000',
    arrears: 'None',
    arrearsTone: 'success',
    status: 'Active Customer',
  },
  {
    id: 'CUST-000108',
    name: 'TBM Capital Ltd',
    type: 'Company',
    kyc: 'Verified',
    kycTone: 'success',
    facilities: 1,
    exposure: '£560,000',
    arrears: 'None',
    arrearsTone: 'success',
    status: 'Active Customer',
  },
];

export const CUSTOMER_COLUMNS: TableColumn<Customer>[] = [
  { key: 'id', header: 'Customer ID', width: '140px', mono: true, bold: true },
  { key: 'name', header: 'Name', width: '210px' },
  { key: 'type', header: 'Type', width: '110px' },
  { key: 'kyc', header: 'KYC', width: '110px' },
  { key: 'facilities', header: 'Facilities', width: '110px' },
  { key: 'exposure', header: 'Exposure', width: '130px', mono: true, bold: true },
  { key: 'arrears', header: 'Arrears', width: '110px' },
  { key: 'status', header: 'Status', width: '150px' },
  { key: 'actions', header: 'Actions', width: '120px' },
];
