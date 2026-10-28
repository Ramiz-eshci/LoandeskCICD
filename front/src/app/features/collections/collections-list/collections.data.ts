import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { CollectionCase } from './collection.model';

/** Design-stage sample data (Collections & Recovery). */
export const COLLECTION_CASES: CollectionCase[] = [
  { id: 'LN-000231', borrower: 'John Smith', balance: '£238,400', arrears: '£1,980', daysOverdue: 12, statusKey: 'open', status: 'In Arrears' },
  { id: 'LN-000198', borrower: 'Rachel Green', balance: '£372,100', arrears: '£6,240', daysOverdue: 44, statusKey: 'promise-to-pay', status: 'Promise to Pay' },
  { id: 'LN-000176', borrower: 'Meridian Estates Ltd', balance: '£1,190,000', arrears: '£18,500', daysOverdue: 63, statusKey: 'legal', status: 'Legal Recovery' },
  { id: 'LN-000155', borrower: 'Priya Sharma', balance: '£166,700', arrears: '£0', daysOverdue: 0, statusKey: 'resolved', status: 'Resolved' },
];

export const COLLECTION_COLUMNS: TableColumn<CollectionCase>[] = [
  { key: 'id', header: 'Loan', width: '120px', mono: true, bold: true },
  { key: 'borrower', header: 'Borrower', width: '200px' },
  { key: 'balance', header: 'Balance', width: '130px', mono: true, bold: true },
  { key: 'arrears', header: 'Arrears', width: '120px', mono: true, bold: true },
  { key: 'daysOverdue', header: 'Days Overdue', width: '120px', mono: true },
  { key: 'status', header: 'Status', width: '160px' },
  { key: 'actions', header: 'Actions', width: '190px' },
];
