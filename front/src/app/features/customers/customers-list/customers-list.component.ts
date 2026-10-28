import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, skip } from 'rxjs';

import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { UiPaginationComponent } from '../../../shared/ui/ui-pagination/ui-pagination.component';
import { UiSearchInputComponent } from '../../../shared/ui/ui-search-input/ui-search-input.component';
import { UiCellDirective } from '../../../shared/ui/table/ui-cell.directive';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { PortfolioCustomerRow, PortfolioService } from '../../portfolio/portfolio.service';
import { PortfolioCustomer } from '../../portfolio/portfolio-list/facility.model';
import { PORTFOLIO_CUSTOMER_COLUMNS } from '../../portfolio/portfolio-list/portfolio.data';

/**
 * Customers — the customer listing (moved out of the Portfolio tabs).
 * Server-paged from /api/portfolio/customers; "View 360" opens /customers/:id.
 */
@Component({
  selector: 'app-customers-list',
  standalone: true,
  imports: [
    UiButtonDirective, UiCardComponent, UiCellDirective, UiDataTableComponent,
    UiPageHeaderComponent, UiPaginationComponent, UiSearchInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customers-list.component.html',
})
export class CustomersListComponent implements OnInit {
  private readonly api = inject(PortfolioService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly columns = PORTFOLIO_CUSTOMER_COLUMNS;
  readonly rows = signal<PortfolioCustomer[]>([]);
  readonly loading = signal(false);
  readonly query = signal('');

  // ---- Server-side paging (same pattern as Enquiries / Applications) ----
  readonly page = signal(1);
  readonly perPage = 10;
  readonly total = signal(0);
  readonly hasNext = computed(() => this.page() * this.perPage < this.total());
  readonly pageSummary = computed(() => {
    const t = this.total();
    const from = t ? (this.page() - 1) * this.perPage + 1 : 0;
    const to = Math.min(this.page() * this.perPage, t);
    return `Showing ${from}–${to} of ${t} customers`;
  });
  readonly subtitle = computed(() => `${this.total()} customer${this.total() === 1 ? '' : 's'}`);

  constructor() {
    // Search: reload page 1 once typing pauses.
    toObservable(this.query).pipe(skip(1), debounceTime(350), takeUntilDestroyed())
      .subscribe(() => { this.page.set(1); this.load(); });
  }

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.api.customers({ page: this.page(), per_page: this.perPage, search: this.query().trim() || undefined })
      .pipe(catchError(() => of({ rows: [] as PortfolioCustomerRow[], meta: null })), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => {
        this.rows.set(res.rows.map((r) => this.toCustomer(r)));
        this.total.set(res.meta?.total ?? res.rows.length);
        this.loading.set(false);
      });
  }

  prev(): void { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next(): void { if (this.hasNext()) { this.page.update((p) => p + 1); this.load(); } }

  open360(row: PortfolioCustomer): void { void this.router.navigate(['/customers', row.applicantId]); }

  private toCustomer(r: PortfolioCustomerRow): PortfolioCustomer {
    const arrears = Number(r.arrears_amount || 0);
    return {
      id: `CUST-${String(r.applicant_id).padStart(6, '0')}`,
      applicantId: r.applicant_id,
      name: r.customer_name,
      type: String(r.applicant_type || (r.company_name ? 'Company' : 'Individual')),
      branch: String(r.branch_name || '—'),
      facilities: Number(r.facilities || 0),
      applications: Number(r.applications || 0),
      created: this.formatDate(r.created_at),
      exposure: this.money(Number(r.exposure || 0)),
      arrears: arrears ? this.money(arrears) : 'None',
      inArrears: arrears > 0,
    };
  }
  private money(v: number): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v || 0));
  }
  private formatDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
