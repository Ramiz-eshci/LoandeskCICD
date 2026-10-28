/** Column definition consumed by <ui-data-table>. */
export interface TableColumn<T = Record<string, unknown>> {
  /** Property key on the row object, and the key used by `*uiCell`. */
  key: string;
  /** Uppercase header label. */
  header: string;
  /** CSS width, e.g. '120px' or '12%'. */
  width?: string;
  align?: 'start' | 'center' | 'end';
  /** Render the cell in DM Mono with tabular figures (IDs, money, dates). */
  mono?: boolean;
  /** Bold the cell value. */
  bold?: boolean;
  /** Custom text projection; ignored when an `*uiCell` template exists. */
  value?: (row: T) => string;
}
