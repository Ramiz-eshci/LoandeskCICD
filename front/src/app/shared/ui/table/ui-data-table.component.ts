import { Component, ChangeDetectionStrategy, computed, contentChildren, effect, input, output, signal } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';

import { TableColumn } from './table-column.model';
import { UiCellDirective } from './ui-cell.directive';
import { UiFitTipDirective } from './ui-fit-tip.directive';
import { UiPaginationComponent } from '../ui-pagination/ui-pagination.component';

/**
 * Config-driven table with the LoanDesk table styling.
 * Columns come from `columns`; any column can be overridden with an
 * <ng-template uiCell="<key>" let-row> in the host template.
 *
 * Client-side pagination is ON by default (pageSize = 10): the table slices
 * `rows` itself and renders its own footer. Screens that paginate on the
 * SERVER (e.g. Masters, with their own <ui-pagination>) must opt out with
 * [paginate]="false" so the two pagers don't fight.
 */
@Component({
  selector: 'ui-data-table',
  standalone: true,
  imports: [NgClass, NgTemplateOutlet, UiPaginationComponent, UiFitTipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-data-table.component.html',
  styleUrl: './ui-data-table.component.scss',
})
export class UiDataTableComponent<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly columns = input.required<TableColumn<T>[]>();
  readonly rows = input.required<readonly T[]>();
  readonly emptyText = input('No records found.');
  readonly rowClickable = input(false);
  /** Optional per-row CSS class resolver (e.g. highlight today's rows). */
  readonly rowClass = input<((row: T) => string) | null>(null);

  /** Client-side pagination (default on, 10 rows/page). Set false for server-paged lists. */
  readonly paginate = input(true);
  readonly pageSize = input(10);
  /** Show the pager even when there is only one page (so the control is always visible). */
  readonly alwaysPager = input(false);

  readonly rowClick = output<T>();

  readonly page = signal(1);
  readonly total = computed(() => this.rows().length);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  constructor() {
    // Reset to page 1 whenever the data set or page size changes (search/filter/switch master).
    effect(() => {
      this.rows();
      this.pageSize();
      this.page.set(1);
    });
  }

  readonly viewRows = computed<readonly T[]>(() => {
    const all = this.rows();
    if (!this.paginate()) return all;
    const size = this.pageSize();
    const start = (this.page() - 1) * size;
    return all.slice(start, start + size);
  });

  readonly summary = computed(() => {
    const t = this.total();
    if (!t) return 'Showing 0 of 0';
    const from = (this.page() - 1) * this.pageSize() + 1;
    const to = Math.min(this.page() * this.pageSize(), t);
    return `Showing ${from}–${to} of ${t}`;
  });

  rowClassFor(row: T): string { const f = this.rowClass(); return f ? f(row) : ''; }

  prev(): void { if (this.page() > 1) this.page.update((p) => p - 1); }
  next(): void { if (this.page() < this.totalPages()) this.page.update((p) => p + 1); }

  private readonly cells = contentChildren(UiCellDirective, { descendants: true });

  private readonly cellMap = computed(() => {
    const map = new Map<string, UiCellDirective['template']>();
    for (const c of this.cells()) map.set(c.uiCell(), c.template);
    return map;
  });

  templateFor(key: string) {
    return this.cellMap().get(key) ?? null;
  }

  /**
   * Client 20-10-2026: every listing fits its card - no horizontal scroll. The table uses a
   * fixed layout and the px widths become PROPORTIONS of the available width (otherwise
   * long text, e.g. a big applicant name, stretched its column and pushed the rest off-screen).
   */
  private readonly widthPct = computed(() => {
    const cols = this.columns();
    const px = cols.map((c) => { const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(c.width || ''); return m ? Number(m[1]) : null; });
    if (px.some((v) => v === null)) return null; // mixed / % widths: leave as given
    const sum = px.reduce<number>((a, v) => a + (v as number), 0);
    return sum > 0 ? px.map((v) => `${((v as number) / sum) * 100}%`) : null;
  });
  /**
   * Client 26-10-2026: columns never shrink below their given px widths - when the card is
   * narrower the table scrolls sideways instead of cutting off buttons (e.g. master Actions).
   */
  readonly minWidth = computed(() => {
    const px = this.columns().map((c) => { const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(c.width || ''); return m ? Number(m[1]) : 0; });
    const sum = px.reduce((a, v) => a + v, 0);
    return sum > 0 ? `${sum}px` : null;
  });
  colWidth(i: number, col: TableColumn<T>): string | undefined {
    const pct = this.widthPct();
    return pct ? pct[i] : col.width;
  }

  text(col: TableColumn<T>, row: T): string {
    if (col.value) return col.value(row);
    const v = row[col.key];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }
}
