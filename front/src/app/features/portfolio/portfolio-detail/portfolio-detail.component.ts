import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { PermissionsStore } from '../../../core/session/permissions.store';
import { UPLOAD_ACCEPT, filterUploads } from '../../../core/util/upload-policy.util';

import { extractFieldErrors, toFieldErrorList, errorSummary } from '../../../core/util/server-errors';

import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiDataTableComponent } from '../../../shared/ui/table/ui-data-table.component';
import { UiDrawerComponent } from '../../../shared/ui/ui-drawer/ui-drawer.component';
import { UiModalComponent } from '../../../shared/ui/ui-modal/ui-modal.component';
import { UiTabFiltersComponent, TabFilter } from '../../../shared/ui/ui-tab-filters/ui-tab-filters.component';
import { TableColumn } from '../../../shared/ui/table/table-column.model';
import { RedemptionFigures, RedExitType } from '../portfolio.service';
import { ContactSchedule, ContactScheduleMilestone, PortfolioContactLog, PortfolioContactPayload, PortfolioFacilityDetail, PortfolioFacilityRequestPayload, PortfolioNote, PortfolioPaymentPayload, PortfolioService } from '../portfolio.service';
import { PortfolioDocUploadComponent, DocUploadResult } from '../shared/portfolio-doc-upload.component';
import { Extension, ExtensionService, extensionTone } from '../../extensions/extension.service';
import { BadgeStatus } from '../../../shared/ui/ui-badge/ui-badge.component';

type OverviewTransaction = {
  date: string;
  type: string;
  description: string;
  method: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
};

@Component({
  selector: 'app-portfolio-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiBadgeComponent,
    UiButtonDirective,
    UiCardComponent,
    UiDataTableComponent,
    UiDrawerComponent,
    UiModalComponent,
    UiTabFiltersComponent,
    PortfolioDocUploadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './portfolio-detail.component.html',
  styleUrl: './portfolio-detail.component.scss',
})
export class PortfolioDetailComponent implements OnInit {
  private readonly api = inject(PortfolioService);
  private readonly extApi = inject(ExtensionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toastr = inject(ToastrService);
  private readonly perms = inject(PermissionsStore);
  /** Portfolio RBAC (Roles matrix): admin bypass; before perms load, allow (API is the final gate).
   *  No umbrella any more: every facility tab is its own module (PORTFOLIO.FACILITY_*). */
  pc(module: string, ...actions: string[]): boolean {
    if (!this.perms.loaded() || this.perms.isSuperAdmin()) return true;
    return actions.some((a) => this.perms.can('PORTFOLIO.' + module, a));
  }
  // ---- per-tab actions ----
  readonly canPayAdd = computed(() => this.pc('FACILITY_PAYMENTS', 'add'));
  readonly canFee = computed(() => this.pc('FACILITY_FEES', 'add'));
  readonly canFeeEdit = computed(() => this.pc('FACILITY_FEES', 'edit'));
  readonly canFeeDelete = computed(() => this.pc('FACILITY_FEES', 'delete'));
  readonly canCovenantAdd = computed(() => this.pc('FACILITY_COVENANTS', 'add'));
  readonly canDocAdd = computed(() => this.pc('FACILITY_DOCUMENTS', 'add'));
  readonly canDocDelete = computed(() => this.pc('FACILITY_DOCUMENTS', 'delete'));
  readonly canNote = computed(() => this.pc('FACILITY_CONTACTS', 'add'));
  /** Customer logs live in the Contacts tab now; old Customer Logs grants still count. */
  readonly canLogAdd = computed(() => this.pc('FACILITY_CONTACTS', 'add') || this.pc('CONTACT_LOG', 'add'));
  readonly canLogEdit = computed(() => this.pc('FACILITY_CONTACTS', 'edit') || this.pc('CONTACT_LOG', 'edit'));
  readonly canLogDelete = computed(() => this.pc('FACILITY_CONTACTS', 'delete') || this.pc('CONTACT_LOG', 'delete'));
  readonly canRedeem = computed(() => this.pc('FACILITY_REDEMPTION', 'add'));
  readonly canRedeemComplete = computed(() => this.pc('FACILITY_REDEMPTION', 'edit'));
  /** Request types the role may raise: Extension > ADD / Further Advance > ADD. */
  readonly canExtension = computed(() => this.pc('EXTENSION', 'add'));
  readonly canFurtherAdvance = computed(() => this.pc('FURTHER_ADVANCE', 'add'));
  /** Extension / Further Advance can only be raised on a live (Active) facility. */
  readonly canRequest = computed(() => this.isActive() && (this.canExtension() || this.canFurtherAdvance()));
  readonly isActive = computed(() => (this.facility()?.status ?? 'Active') === 'Active');
  // ---- Bad loans (client 30-09-2026): FACILITY_BAD_DEBT view | add (mark, note, money received) | edit (write off, restore)
  readonly canBadAdd = computed(() => this.pc('FACILITY_BAD_DEBT', 'add'));
  readonly canBadEdit = computed(() => this.pc('FACILITY_BAD_DEBT', 'edit'));
  readonly extensions = computed<Extension[]>(() => this.detail()?.extensions ?? []);
  readonly openExtension = computed(() => this.extensions().find((e) => e.open) ?? null);
  readonly facilityStatusLabel = computed(() => (this.facility()?.status === 'Redeemed' ? 'Completed' : (this.facility()?.status ?? '')));
  readonly facilityTone = computed<BadgeStatus>(() => {
    switch (this.facility()?.status) {
      case 'Bad Debt': return 'overdue';
      case 'Written Off': return 'declined';
      case 'Recovered': case 'Redeemed': return 'completed';
      default: return 'active';
    }
  });
  readonly canContactView = computed(() => this.canSeeTab('contacts'));
  readonly canMaturityView = computed(() => this.canSeeTab('redemption'));
  /** Tab key -> Roles-matrix module(s); VIEW on any listed module shows the tab.
   *  Merged tabs: Schedule = Schedule + Fees, Transactions = Transactions + Statements.
   *  Interest tab removed (its daily / projected figures now sit on the Schedule tab). */
  // Client 13-10-2026: one permission per VISIBLE tab (removed-tab modules retired from the
  // Roles matrix; the Transactions tab now covers the ledger, payments, statements and fees).
  private readonly TAB_MODULE: Record<string, string[]> = {
    transactions: ['FACILITY_TRANSACTIONS'],
    documents: ['FACILITY_DOCUMENTS'],
    contacts: ['FACILITY_CONTACTS'],
    drawdowns: ['FACILITY_DRAWDOWNS'],
    extension: ['EXTENSION', 'HEAD_OF_EXTENSION'],
    baddebt: ['FACILITY_BAD_DEBT'],
    redemption: ['FACILITY_REDEMPTION'],
    redeemed: ['FACILITY_REDEMPTION'],
    audit: ['FACILITY_AUDIT'],
  };
  canSeeTab(key: string): boolean { const mods = this.TAB_MODULE[key]; return !!mods && mods.some((m) => this.pc(m, 'view')); }
  /** Sections inside the merged tabs keep their own VIEW permission. */
  readonly showScheduleTable = computed(() => this.pc('FACILITY_SCHEDULE', 'view'));
  readonly showFeesCard = computed(() => this.pc('FACILITY_FEES', 'view'));
  readonly showLedger = computed(() => this.pc('FACILITY_TRANSACTIONS', 'view'));
  readonly showSecurity = computed(() => this.pc('FACILITY_SECURITY', 'view'));
  readonly showValuation = computed(() => this.pc('FACILITY_VALUATION', 'view'));
  readonly showRequests = computed(() => this.pc('FACILITY_AMENDMENTS', 'view'));
  readonly showCollections = computed(() => this.pc('FACILITY_COLLECTIONS', 'view'));
  readonly showStatement = computed(() => this.pc('FACILITY_STATEMENTS', 'view'));
  /** Fees still owed (status Due) — shown on the Schedule tab. */
  readonly feesDue = computed(() => (this.detail()?.fees ?? [])
    .filter((f) => String(f['status'] ?? 'Due') === 'Due')
    .reduce((sum, f) => sum + Number(f['amount'] ?? 0), 0));

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detail = signal<PortfolioFacilityDetail | null>(null);
  readonly contactSchedule = signal<ContactSchedule | null>(null);
  readonly notes = signal<PortfolioNote[]>([]);
  noteDraft = '';
  readonly noteSaving = signal(false);
  readonly activeTab = signal('transactions');
  readonly requestOpen = signal(false);
  readonly requestSaving = signal(false);
  readonly requestError = signal<string | null>(null);
  readonly requestNotice = signal<string | null>(null);
  requestDraft: PortfolioFacilityRequestPayload = this.blankRequest();

  readonly paymentOpen = signal(false);
  readonly paymentSaving = signal(false);
  readonly paymentError = signal<string | null>(null);
  paymentDraft: PortfolioPaymentPayload = this.blankPayment();

  readonly documentOpen = signal(false);
  readonly documentSaving = signal(false);
  readonly documentError = signal<string | null>(null);

  readonly paymentMethods = [
    'Bank Transfer',
    'Direct Debit',
    'Standing Order',
    'Cash',
    'Cheque',
    'Internal Transfer',
    'Other',
  ];

  // Covenants hidden (code kept; add back here to show it again).
  // Interest removed; Fees merged into Schedule; Statements merged into Transactions.
  private readonly ALL_TABS: TabFilter[] = [
    // Point 2 regroup: Loan Structure -> header box (Term); Payments + Drawdowns -> Transactions;
    // Valuation -> Security; Collections -> Amendments. Old keys kept out of the list only.
    // Client 06-10-2026: Overview, Schedule & Fees, Security & Valuation and
    // Amendments & Arrears tabs removed. Transactions is the landing tab.
    { key: 'transactions', label: 'Transactions' },
    { key: 'documents', label: 'Documents' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'drawdowns', label: 'Drawdowns' },
    { key: 'extension', label: 'Extensions' },
    { key: 'baddebt', label: 'Bad Debt' },
    { key: 'redemption', label: 'Redemption' },
    // Client 26-10-2026: a redeemed facility shows the redemption it closed on (read-only)
    // in place of the calculator.
    { key: 'redeemed', label: 'Redemption Details' },
    { key: 'audit', label: 'Audit' },
  ];
  readonly isRedeemed = computed(() => this.facility()?.status === 'Redeemed');
  /** Only the tabs the active role may view. */
  readonly tabs = computed<TabFilter[]>(() => this.ALL_TABS.filter((t) => this.canSeeTab(t.key)
    && (t.key !== 'drawdowns' || this.isDrawdownFacility())
    && (t.key !== 'redemption' || !this.isRedeemed())
    && (t.key !== 'redeemed' || this.isRedeemed())));
  /** Selected tab, or the first viewable one when the selected tab is not allowed. */
  readonly shownTab = computed(() => (this.canSeeTab(this.activeTab()) ? this.activeTab() : (this.tabs()[0]?.key ?? '')));

  readonly scheduleColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'installment_no', header: '#', width: '70px' },
    { key: 'due_date', header: 'Due Date', width: '130px' },
    { key: 'principal_due', header: 'Principal', width: '130px', mono: true },
    { key: 'interest_due', header: 'Interest', width: '130px', mono: true },
    { key: 'total_due', header: 'Total', width: '130px', mono: true, bold: true },
    { key: 'status', header: 'Status', width: '120px' },
  ];
  readonly securityColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'property_address', header: 'Property', width: '260px' },
    { key: 'charge_type', header: 'Charge', width: '120px' },
    { key: 'estimated_value', header: 'Estimated Value', width: '150px', mono: true },
    { key: 'valuation_amount', header: 'Valuation', width: '140px', mono: true },
    { key: 'valuation_status', header: 'Status', width: '130px' },
  ];
  readonly valuationColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'property_address', header: 'Property', width: '240px' },
    { key: 'valuation_type_name', header: 'Type', width: '140px' },
    { key: 'valuer_firm', header: 'Valuer', width: '160px' },
    { key: 'market_value', header: 'Market Value', width: '150px', mono: true, bold: true },
    { key: 'gdv_value', header: 'GDV', width: '140px', mono: true },
    { key: 'valuation_date', header: 'Valuation Date', width: '140px' },
    { key: 'valuation_status', header: 'Status', width: '130px' },
  ];
  readonly documentColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'file_name', header: 'Document', width: '260px' },
    { key: 'document_type_name', header: 'Type', width: '170px' },
    { key: 'status', header: 'Status', width: '120px' },
    { key: 'version', header: 'Version', width: '100px' },
    { key: 'verified_status', header: 'Verified', width: '120px' },
  ];
  readonly collectionColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'status', header: 'Status', width: '130px' },
    { key: 'arrears_amount', header: 'Arrears', width: '130px', mono: true },
    { key: 'days_overdue', header: 'Days Overdue', width: '140px' },
    { key: 'notes', header: 'Notes', width: '260px' },
  ];
  readonly requestColumns: TableColumn<Record<string, unknown>>[] = [
    { key: 'request_type', header: 'Type', width: '150px' },
    { key: 'effective_date', header: 'Effective Date', width: '140px' },
    { key: 'proposed_maturity', header: 'New Maturity', width: '140px' },
    { key: 'new_amount', header: 'New Amount', width: '130px', mono: true },
    { key: 'status', header: 'Status', width: '140px' },
    { key: 'reason', header: 'Reason', width: '260px' },
  ];

  readonly facility = computed(() => this.detail()?.facility ?? null);
  /** Valuation tab: only security rows that actually carry a valuation. */
  /**
   * Valuation tab. Primary source is the Valuations workflow (underwriting Step 2),
   * exposed by the API as `detail.valuations`. Falls back to any valuation figures
   * carried on the security rows so legacy/seed facilities still render.
   */
  readonly valuationRows = computed<Record<string, unknown>[]>(() => {
    const workflow = this.detail()?.valuations ?? [];
    if (workflow.length) {
      return workflow.map((v) => ({
        property_address: v['property_address'] ?? '—',
        valuation_type_name: v['valuation_type_name'] ?? '—',
        valuer_firm: v['valuer_firm'] ?? '—',
        market_value: v['market_value'] != null ? this.money(v['market_value']) : '—',
        gdv_value: v['gdv_value'] != null ? this.money(v['gdv_value']) : '—',
        valuation_date: v['valuation_date'] ? this.formatDate(String(v['valuation_date'])) : '—',
        valuation_status: v['valuation_status'] ?? '—',
      }));
    }
    return (this.detail()?.security ?? [])
      .filter((r) => r['valuation_amount'] != null || r['valuation_status'] || r['valuation_date'])
      .map((r) => ({
        property_address: r['property_address'] ?? '—',
        valuation_type_name: r['valuation_type_name'] ?? '—',
        valuer_firm: '—',
        market_value: r['valuation_amount'] != null ? this.money(r['valuation_amount']) : '—',
        gdv_value: '—',
        valuation_date: r['valuation_date'] ? this.formatDate(String(r['valuation_date'])) : '—',
        valuation_status: r['valuation_status'] ?? '—',
      }));
  });
  readonly documentTypes = computed(() => this.detail()?.documentTypes ?? []);
  readonly daysRemaining = computed(() => {
    const maturity = this.facility()?.maturity_date;
    if (!maturity) return '—';
    const days = Math.ceil((new Date(maturity).getTime() - Date.now()) / 86400000);
    return `${Math.max(0, days)}d`;
  });
  /** Days remaining as a plain number for the overview side card. */
  readonly daysRemainingCount = computed(() => {
    const maturity = this.facility()?.maturity_date;
    if (!maturity) return 0;
    return Math.max(0, Math.ceil((new Date(maturity).getTime() - Date.now()) / 86400000));
  });
  readonly accruedInterest = computed(() => {
    const f = this.facility();
    if (!f) return 0;
    return Math.max(0, Number(f.outstanding_balance ?? f.principal ?? 0) - Number(f.principal || 0));
  });
  /** Client 22-10-2026: outstanding = net loan (day 1 + released drawdowns) - payments (server position). */
  readonly position = computed(() => this.facility()?.position ?? null);
  readonly currentBalance = computed(() => Number(this.position()?.outstanding ?? this.facility()?.outstanding_balance ?? this.facility()?.principal ?? 0));
  /** Daily interest: rate_pct is a MONTHLY rate, so monthly = balance x rate%, daily = monthly x 12 / 365. */
  readonly dailyInterest = computed(() => (this.currentBalance() * (Number(this.facility()?.rate_pct || 0) / 100) * 12) / 365);
  /** Daily rate in percent: monthly rate x 12 / 365. */
  readonly dailyRatePct = computed(() => (Number(this.facility()?.rate_pct || 0) * 12) / 365);
  /** Projected interest from today to maturity. */
  readonly projectedToMaturity = computed(() => this.dailyInterest() * this.daysRemainingCount());
  readonly statementRows = computed<Record<string, unknown>[]>(() => {
    const payments = this.detail()?.payments ?? [];
    const schedules = this.detail()?.schedule ?? [];
    const paid = payments.reduce((sum, p) => sum + Number(p['amount'] || 0), 0);
    const due = schedules.reduce((sum, s) => sum + Number(s['total_due'] || 0), 0);
    return [
      { label: 'Opening Principal', value: this.money(this.facility()?.principal || 0) },
      { label: 'Scheduled Due', value: this.money(due) },
      { label: 'Payments Received', value: this.money(paid) },
      { label: 'Current Balance', value: this.money(this.currentBalance()) },
    ];
  });

  // ---- Overview: balance projection (12 months, M1..M12) ----
  readonly projectionLabels = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'];
  readonly projectionValues = computed(() => {
    const base = this.currentBalance();
    const step = this.dailyInterest() * 30;
    return this.projectionLabels.map((_, i) => base + step * i);
  });
  /** Nice £ axis ceiling + SVG paths for the projection area chart. */
  readonly projectionChart = computed(() => {
    const values = this.projectionValues();
    const peak = Math.max(0, ...values);
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(peak, 1))) - 3));
    const max = Math.max(4, Math.ceil(peak / (200 * magnitude))) * 200 * magnitude;
    const W = 720, H = 260, padL = 58, padR = 14, padT = 14, padB = 30;
    const iw = W - padL - padR, ih = H - padT - padB;
    const x = (i: number) => padL + (iw * i) / Math.max(1, values.length - 1);
    const y = (v: number) => padT + ih - (ih * v) / Math.max(1, max);
    const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const first = pts[0];
    const area = `${line} L${last.x.toFixed(1)},${(padT + ih).toFixed(1)} L${first.x.toFixed(1)},${(padT + ih).toFixed(1)} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ value: max * t, y: padT + ih - ih * t }));
    return { W, H, padL, padT, plotW: iw, plotH: ih, plotBottom: padT + ih, line, area, ticks, max, pts };
  });

  /** Full transaction ledger from posted drawdowns and payments. */
  readonly ledgerTransactions = computed<OverviewTransaction[]>(() => {
    const drawdowns = this.detail()?.drawdowns ?? [];
    const payments = this.detail()?.payments ?? [];
    const f = this.facility();
    if (!f) return [];
    // Client 12-10-2026: the ledger lists PAYMENTS only — drawdown rows are not shown here
    // (they have their own Drawdowns tab).
    void drawdowns;
    const rows = [
      ...payments.map((p) => ({
        sortDate: String(p['paid_on'] ?? ''),
        type: 'Payment',
        description: String(p['reference'] || 'Payment'),
        method: String(p['method'] ?? '') || '—',
        debit: null,
        credit: Number(p['amount'] ?? 0) || null,
      })),
    ].sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0));
    let running = 0;
    return rows.map((r) => {
      running += Number(r.debit || 0) - Number(r.credit || 0);
      return {
        date: this.formatDate(r.sortDate),
        type: r.type,
        description: r.description || r.type,
        method: r.method,
        debit: r.debit,
        credit: r.credit,
        balance: running,
      };
    });
  });

  /** Recent transactions for the overview card — latest four, newest first. */
  readonly recentTransactions = computed<OverviewTransaction[]>(() => this.ledgerTransactions().slice(-4).reverse());

  /** Redemption calculator — all figures derived live, never NaN. */
  readonly redemptionDate = signal('');
  readonly redemptionNotice = signal<string | null>(null);
  readonly redemptionSaving = signal(false);
  readonly redemptionSteps = [
    'Generate Redemption Statement',
    'Send to Solicitor / Borrower',
    'Receive Cleared Funds',
    'Allocate Payment',
    'Release Security / Charge',
    'Generate Closure Confirmation',
    'Close Facility',
  ];
  readonly redemptionDateIso = computed(() => {
    const picked = this.redemptionDate();
    if (picked) return picked;
    return this.facility()?.maturity_date || new Date().toISOString().slice(0, 10);
  });
  readonly redemptionDayCount = computed(() => {
    const f = this.facility();
    if (!f?.start_date) return 0;
    const ms = new Date(this.redemptionDateIso()).getTime() - new Date(`${f.start_date}T00:00:00`).getTime();
    return Math.max(0, Math.round(ms / 86400000));
  });
  readonly exitFeesDue = computed(() => (this.detail()?.fees ?? [])
    .filter((f) => String(f['fee_type'] ?? '').toLowerCase() === 'exit' && !['Waived', 'Capitalised'].includes(String(f['status'] ?? 'Due')))
    .reduce((sum, f) => sum + Number(f['amount'] ?? 0), 0));
  readonly otherFeesDue = computed(() => (this.detail()?.fees ?? [])
    .filter((f) => String(f['fee_type'] ?? '').toLowerCase() !== 'exit' && !['Waived', 'Capitalised'].includes(String(f['status'] ?? 'Due')))
    .reduce((sum, f) => sum + Number(f['amount'] ?? 0), 0));
  // ---- Top bar (client 09-10-2026): Net Loan / Gross Loan / Total Interest / Amount Outstanding ----
  /** Net Loan = day 1 net + net of every released drawdown (client 22-10-2026). */
  readonly netLoan = computed(() => Number(this.position()?.net_loan ?? this.facility()?.net_advance ?? 0));
  /** Client 23-10-2026: header Net Loan for drawdown facilities = day 1 net + all agreed drawdowns net. */
  readonly netLoanTotal = computed(() => Number(this.position()?.net_loan_total ?? this.netLoan()));
  readonly grossLoan = computed(() => Number(this.facility()?.principal ?? 0));
  readonly totalInterestAll = computed(() => Number(this.facility()?.rolled_interest ?? 0));
  // ---- Drawdowns (client 09-10-2026) ----
  readonly drawdownSummary = computed(() => this.detail()?.drawdowns_summary ?? null);
  readonly isDrawdownFacility = computed(() => !!this.drawdownSummary()?.is_drawdown_facility);
  /** Client 12-10-2026: total agreed drawdowns from the indicative (all tranches). */
  readonly drawdownAgreed = computed(() => this.drawdownSummary()?.drawdowns_agreed ?? this.drawdownSummary()?.drawdowns ?? null);
  /** Gross loan + exit fee; for drawdown facilities, base + sent tranches + recalculated exit fee. */
  readonly amountOutstanding = computed(() => {
    // Client 13-10-2026: a redeemed / closed facility is settled — show nothing outstanding
    // (previously the exit fee still lingered in the header after Redeem Facility).
    const st = this.facility()?.status ?? '';
    if (st === 'Redeemed' || st === 'Recovered' || st === 'Written Off') return 0;
    // Client 23-10-2026: after Redeem Facility (maturity moved to the redemption date) show what is
    // left of the fixed redemption amount (principal + interest + fees - payments).
    const due = this.position()?.redemption_due;
    if (due != null) return Number(due);
    // Client 23-10-2026 (option A): Amount Outstanding = GROSS loan (incl. agreed drawdowns) - payments;
    // 0 = paid off -> the facility closes as Completed.
    const g = this.position()?.gross_outstanding;
    if (g != null) return Number(g);
    // Client 22-10-2026: same outstanding as the redemption calculator (net loan - payments).
    return this.currentBalance();
  });
  readonly redemptionAccrued = computed(() => this.dailyInterest() * this.redemptionDayCount());
  readonly redemptionTotal = computed(() => {
    const principal = Number(this.facility()?.principal ?? 0);
    const accrued = this.redemptionAccrued();
    const total = principal + (Number.isFinite(accrued) ? accrued : 0) + this.exitFeesDue() + this.otherFeesDue();
    return Number.isFinite(total) ? total : 0;
  });
  readonly latestQuotedRedemption = computed(() => {
    return (this.detail()?.redemptions ?? []).find((r) => String(r['status'] ?? '') === 'Quoted') ?? null;
  });

  /** Audit trail from dbo.audit_logs. */
  readonly auditRows = computed<
    { date: string; time: string; user: string; role: string; action: string; oldValue: string | null; newValue: string; reason: string }[]
  >(() => {
    return (this.detail()?.audit ?? []).map((a) => ({
      date: this.formatDate(String(a['audit_date'] ?? '')),
      time: String(a['audit_time'] ?? ''),
      user: String(a['user_name'] ?? 'System'),
      role: String(a['role_name'] ?? '—'),
      action: this.humanizeAction(String(a['action'] ?? 'Updated')),
      oldValue: null,
      newValue: String(a['entity_name'] ?? '—'),
      reason: this.summarizeDetails(a['details']),
    }));
  });

  private humanizeAction(code: string): string {
    return code
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private summarizeDetails(details: unknown): string {
    if (details == null || details === '') return '—';
    if (typeof details !== 'string') return '—';
    try {
      const obj = JSON.parse(details) as Record<string, unknown>;
      const parts = Object.entries(obj)
        .filter(([, v]) => v != null && v !== '')
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      const text = parts.join('; ');
      return text ? (text.length > 120 ? `${text.slice(0, 117)}…` : text) : '—';
    } catch {
      return details.length > 120 ? `${details.slice(0, 117)}…` : details;
    }
  }

  /** Facility documents from application_documents. */
  readonly documentsDisplay = computed<{ id: number; name: string; category: string; version: string; uploaded: string; uploadedBy: string; status: string }[]>(() => {
    const docs = this.detail()?.documents ?? [];
    return docs.map((d) => ({
      id: Number(d['app_document_id'] ?? 0),
      name: String(d['file_name'] ?? 'Document'),
      category: String(d['document_category'] ?? d['document_type_name'] ?? '—'),
      version: String(d['version'] ?? 'v1'),
      uploaded: this.formatDate(String(d['created_at'] ?? '').slice(0, 10)),
      uploadedBy: String(d['uploaded_by_name'] ?? '—'),
      status: String(d['verified_status'] ?? d['status'] ?? 'Pending'),
    }));
  });

  /** Open a facility document in a new tab (authenticated blob fetch). */
  viewDocument(docId: number): void {
    const f = this.facility();
    if (!f || !docId) return;
    this.api.downloadFacilityDocument(f.loan_number, docId).pipe(catchError(() => of(null))).subscribe((blob) => {
      if (blob) window.open(URL.createObjectURL(blob), '_blank');
    });
  }

  /** Download a facility document to disk. */
  downloadDocument(docId: number): void {
    const f = this.facility();
    if (!f || !docId) return;
    this.api.downloadFacilityDocument(f.loan_number, docId).pipe(catchError(() => of(null))).subscribe((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = ''; link.click();
      URL.revokeObjectURL(url);
    });
  }

  documentStatusClass(status: string): string {
    const s = status.toLowerCase();
    if (s.includes('execut') || s.includes('register') || s.includes('verifi') || s.includes('approv') || s.includes('complet')) return 'pill pill-paid';
    if (s.includes('pend') || s.includes('review') || s.includes('draft')) return 'pill pill-due';
    if (s.includes('reject') || s.includes('expir') || s.includes('fail')) return 'pill pill-overdue';
    return 'pill';
  }

  readonly covenantNotice = signal(false);

  // ---- Fees (record) ----
  readonly feeTypes = ['Arrangement', 'Broker', 'Document', 'Extension', 'Exit', 'Late', 'Default', 'Other'];
  // 'Capitalised' = a retained extension fee already added to the gross loan (client 28-10-2026).
  readonly feeStatuses = ['Due', 'Paid', 'Waived', 'Capitalised'];
  readonly feeOpen = signal(false);
  readonly feeSaving = signal(false);
  readonly feeError = signal<string | null>(null);
  editingFeeId: number | null = null;
  feeDraft = this.blankFee();
  private blankFee() {
    return { fee_type: 'Arrangement', amount: null as number | null, due_date: new Date().toISOString().slice(0, 10), status: 'Due', notes: '' };
  }
  openFee(): void { this.editingFeeId = null; this.feeError.set(null); this.feeDraft = this.blankFee(); this.feeOpen.set(true); }
  openFeeEdit(row: Record<string, unknown>): void {
    this.editingFeeId = Number(row['fee_id']) || null;
    this.feeError.set(null);
    this.feeDraft = {
      fee_type: String(row['fee_type'] ?? 'Arrangement'),
      amount: row['amount'] != null ? Number(row['amount']) : null,
      due_date: String(row['due_date'] ?? '').slice(0, 10),
      status: String(row['status'] ?? 'Due'),
      notes: String(row['notes'] ?? ''),
    };
    this.feeOpen.set(true);
  }
  removeFee(row: Record<string, unknown>): void {
    const f = this.facility();
    const id = Number(row['fee_id']) || 0;
    if (!f || !id) return;
    this.askConfirm('Delete this fee? This cannot be undone.', () => {
      this.api.deleteFee(f.loan_number, id).pipe(catchError(() => of(false))).subscribe((ok) => { if (ok) { this.toastr.success('Fee deleted.', 'Deleted'); this.loadFacility(true); } else { this.toastr.error('Could not delete fee.', 'Failed'); } });
    });
  }
  submitFee(): void {
    const f = this.facility();
    if (!f) return;
    if (!this.feeDraft.amount || this.feeDraft.amount <= 0) { this.toastr.error('Enter an amount greater than zero.', 'Validation Error'); return; }
    this.feeSaving.set(true); this.feeError.set(null);
    const req$ = this.editingFeeId
      ? this.api.updateFee(f.loan_number, this.editingFeeId, this.feeDraft)
      : this.api.recordFee(f.loan_number, this.feeDraft);
    req$.pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save fee.'), 'Validation Error'); this.feeSaving.set(false); return of(null); }),
    ).subscribe((r) => { this.feeSaving.set(false); if (!r) return; this.feeOpen.set(false); this.toastr.success('Fee saved.', 'Saved'); this.loadFacility(true); });
  }

  // ---- Covenants (add) ----
  readonly covenantStatuses = ['Upcoming', 'Future', 'Complied', 'Overdue', 'Breached', 'Waived'];
  readonly covenantOpen = signal(false);
  readonly covenantSaving = signal(false);
  readonly covenantError = signal<string | null>(null);
  covenantDraft = this.blankCovenant();
  private blankCovenant() {
    return { name: '', covenant_type: '', frequency: '', next_due: '', status: 'Upcoming', notes: '' };
  }
  openCovenant(): void { this.covenantError.set(null); this.covenantDraft = this.blankCovenant(); this.covenantOpen.set(true); }
  submitCovenant(): void {
    const f = this.facility();
    if (!f) return;
    if (!this.covenantDraft.name.trim()) { this.toastr.error('Covenant name is required.', 'Validation Error'); return; }
    this.covenantSaving.set(true); this.covenantError.set(null);
    this.api.createCovenant(f.loan_number, this.covenantDraft).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not add covenant.'), 'Validation Error'); this.covenantSaving.set(false); return of(null); }),
    ).subscribe((r) => { this.covenantSaving.set(false); if (!r) return; this.covenantOpen.set(false); this.toastr.success('Covenant added.', 'Saved'); this.loadFacility(true); });
  }

  // ---- Shared confirm dialog ----
  readonly confirmOpen = signal(false);
  readonly confirmMessage = signal('');
  private confirmFn: (() => void) | null = null;
  askConfirm(message: string, fn: () => void): void {
    this.confirmMessage.set(message);
    this.confirmFn = fn;
    this.confirmOpen.set(true);
  }
  confirmYes(): void {
    const fn = this.confirmFn;
    this.confirmOpen.set(false);
    this.confirmFn = null;
    if (fn) fn();
  }

  removeDocument(docId: number, name: string): void {
    const f = this.facility();
    if (!f || !docId) return;
    this.askConfirm(`Delete document "${name}"? This cannot be undone.`, () => {
      this.api.deleteFacilityDocument(f.loan_number, docId).pipe(catchError(() => of(false))).subscribe((ok) => { if (ok) { this.toastr.success('Document deleted.', 'Deleted'); this.loadFacility(true); } else { this.toastr.error('Could not delete document.', 'Failed'); } });
    });
  }
  readonly covenants = computed<{ name: string; type: string; frequency: string; nextDue: string; status: string }[]>(() => {
    return (this.detail()?.covenants ?? []).map((c) => ({
      name: String(c['name'] ?? 'Covenant'),
      type: String(c['covenant_type'] ?? '—'),
      frequency: String(c['frequency'] ?? '—'),
      nextDue: this.formatDate(String(c['next_due'] ?? '')),
      status: String(c['status'] ?? 'Upcoming'),
    }));
  });

  /** Schedule rows normalized for the Repayment / Interest Schedule table. */
  readonly scheduleDisplay = computed<
    {
      no: number; dueDate: string; opening: number; principal: number | null;
      interest: number | null; fees: number | null; total: number;
      paid: number | null; outstanding: number; closing: number; status: string;
    }[]
  >(() => {
    const rows = this.detail()?.schedule ?? [];
    const f = this.facility();
    const principal = Number(f?.principal ?? 0);
    if (rows.length) {
      // Waterfall allocation, oldest due first: each payment covers the
      // earliest unpaid instalments, so paid/outstanding stay truthful.
      const pool = (this.detail()?.payments ?? [])
        .map((p) => ({ on: String(p['paid_on'] ?? ''), amount: Number(p['amount'] ?? 0) }))
        .filter((p) => p.amount > 0)
        .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
      let remaining = pool.reduce((sum, p) => sum + p.amount, 0);
      const feesByRow = this.feesPerInstalment(rows);
      return rows.map((r, i) => {
        const p = Number(r['principal_due'] ?? 0);
        const iv = Number(r['interest_due'] ?? 0);
        const fee = feesByRow[i];
        const total = Number(r['total_due'] ?? p + iv) + fee;
        const paid = Math.min(total, remaining);
        remaining = Math.max(0, remaining - paid);
        const isLast = i === rows.length - 1;
        return {
          no: Number(r['installment_no'] ?? i + 1),
          dueDate: this.formatDate(String(r['due_date'] ?? '')),
          opening: principal,
          principal: p || null,
          interest: iv || null,
          fees: fee || null,
          total,
          paid: paid > 0 ? paid : null,
          outstanding: total - paid,
          closing: isLast ? 0 : principal,
          status: String(r['status'] ?? 'Future'),
        };
      });
    }
    return [];
  });

  /**
   * Fees column: loan_schedules has no fee field, so facility fees (loan_fees, not Waived)
   * are placed on the instalment whose period holds their due date
   * (previous due date < fee due <= this due date). Fees before the first instalment go
   * on #1; fees after the last instalment, or with no due date, go on the last one.
   */
  private feesPerInstalment(rows: Record<string, unknown>[]): number[] {
    const out = rows.map(() => 0);
    if (!rows.length) return out;
    const dues = rows.map((r) => String(r['due_date'] ?? '').slice(0, 10));
    for (const f of this.detail()?.fees ?? []) {
      if (String(f['status'] ?? '') === 'Waived') continue;
      const amt = Number(f['amount'] ?? 0);
      if (!(amt > 0)) continue;
      const on = String(f['due_date'] ?? '').slice(0, 10);
      let idx = on ? dues.findIndex((d) => d && on <= d) : -1;
      if (idx < 0) idx = rows.length - 1;
      out[idx] += amt;
    }
    return out;
  }

  ngOnInit(): void {
    this.loadFacility(false);
    this.loadLogLookups();
  }

  // ---- Customer logs (Contacts tab; moved here from the Portfolio list) ----
  readonly logMethods = signal<string[]>(['Phone', 'Email', 'SMS', 'Meeting']);
  readonly logStatuses = signal<string[]>(['Pending', 'Ringing', 'Connected', 'Busy', 'Not Reachable', 'Done', 'Overdue', 'Skipped']);
  readonly logOutcomes = signal<string[]>(['Contacted', 'No Answer', 'Promise to Pay', 'Paid', 'Left Message', 'Escalated']);
  readonly logOpen = signal(false);
  readonly logSaving = signal(false);
  editingLogId: number | null = null;
  logDraft: PortfolioContactPayload = this.blankLog();
  readonly contactLogs = computed<PortfolioContactLog[]>(() => this.detail()?.contacts ?? []);

  private loadLogLookups(): void {
    this.api.contactLookups().pipe(catchError(() => of(null))).subscribe((lk) => {
      if (!lk) return;
      // API answered -> masters rule, even if every value is deactivated (empty list).
      this.logMethods.set(lk.methods ?? []);
      this.logStatuses.set(lk.followupStatuses ?? []);
      this.logOutcomes.set(lk.contactOutcomes ?? []);
    });
  }

  private blankLog(): PortfolioContactPayload {
    const f = this.facility();
    return {
      loan_id: f?.loan_id ?? null,
      application_id: f?.application_id ?? null,
      applicant_id: f?.applicant_id ?? null,
      contact_date: new Date().toISOString().slice(0, 10),
      person: '',
      method: this.logMethods()[0] || 'Phone',
      contact_notes: '',
      followup_date: '',
      outlook_reminder: false,
      followup_status: 'Pending',
      contact_outcome: '',
      milestone_month: null,
    };
  }

  /** Add a log for this facility's customer; from a schedule row it is tied to that milestone. */
  /** Follow-up date the log had when the edit opened (an unchanged old date stays valid). */
  logOrigFollowup = '';

  beginLogAdd(milestone?: ContactScheduleMilestone): void {
    this.editingLogId = null;
    this.logOrigFollowup = '';
    this.logDraft = this.blankLog();
    if (milestone) this.logDraft.milestone_month = milestone.month;
    this.logOpen.set(true);
  }

  beginLogEdit(row: PortfolioContactLog): void {
    this.editingLogId = row.log_id;
    this.logOrigFollowup = String(row.followup_date || '').slice(0, 10);
    this.logDraft = {
      loan_id: row.loan_id,
      application_id: row.application_id,
      applicant_id: row.applicant_id,
      contact_date: row.contact_date || '',
      person: row.person || '',
      method: row.method || 'Phone',
      contact_notes: row.contact_notes || '',
      followup_date: row.followup_date || '',
      outlook_reminder: row.outlook_reminder === true || row.outlook_reminder === 1,
      followup_status: row.followup_status || 'Pending',
      contact_outcome: row.contact_outcome || '',
      milestone_month: row.milestone_month ?? null,
    };
    this.logOpen.set(true);
  }

  /** Contact Schedule row Edit: open the log that satisfied the milestone. */
  editMilestone(m: ContactScheduleMilestone): void {
    const row = this.contactLogs().find((c) => c.log_id === m.log_id);
    if (!row) { this.beginLogAdd(m); return; }
    this.beginLogEdit({ ...row, milestone_month: row.milestone_month ?? m.month });
  }

  saveLog(): void {
    const d = this.logDraft;
    if (!d.loan_id || !d.applicant_id) { this.toastr.error('Facility customer not found.', 'Validation Error'); return; }
    if (!d.contact_date) { this.toastr.error('Contact date is required.', 'Validation Error'); return; }
    if (!d.person.trim()) { this.toastr.error('Person is required.', 'Validation Error'); return; }
    // Tester 20-10-2026: person name - letters, spaces and . ' - only.
    if (!/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'\-]*$/.test(d.person.trim())) {
      this.toastr.error("Person: use letters, spaces and . ' - only.", 'Validation Error'); return;
    }
    // Tester 20-10-2026: follow-up date cannot be in the past.
    const fd = String(d.followup_date || '').slice(0, 10);
    if (fd && fd < this.todayLocal() && fd !== this.logOrigFollowup) {
      this.toastr.error('Follow-up date cannot be in the past.', 'Validation Error'); return;
    }
    this.logSaving.set(true);
    const req$ = this.editingLogId ? this.api.updateContact(this.editingLogId, d) : this.api.createContact(d);
    req$.pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save customer log.'), 'Validation Error'); this.logSaving.set(false); return of(null); }),
    ).subscribe((r) => {
      this.logSaving.set(false);
      if (!r) return;
      this.logOpen.set(false);
      this.toastr.success(this.editingLogId ? 'Customer log updated.' : 'Customer log added.', 'Saved');
      this.loadFacility(true);
    });
  }

  deleteLog(row: PortfolioContactLog): void {
    this.askConfirm('Delete this customer log? This cannot be undone.', () => {
      this.api.deleteContact(row.log_id).pipe(catchError(() => of(false))).subscribe((ok) => {
        if (ok) { this.toastr.success('Customer log deleted.', 'Deleted'); this.loadFacility(true); }
        else { this.toastr.error('Could not delete customer log.', 'Failed'); }
      });
    });
  }

  logStatusClass(status: string): string {
    const s = String(status || '').toLowerCase();
    if (s === 'done' || s === 'connected') return 'pill pill-paid';
    if (s === 'overdue') return 'pill pill-overdue';
    if (s === 'pending') return 'pill pill-due';
    return 'pill';
  }

  back(): void {
    void this.router.navigate(['/portfolio']);
  }

  // Client 06-10-2026: jump to the originating Application / Enquiry / Underwriting case.
  openApplication(): void { const id = this.facility()?.application_id; if (id) void this.router.navigate(['/applications', id]); }
  openEnquiry(): void { const id = this.facility()?.enquiry_id; if (id) void this.router.navigate(['/enquiries', id]); }
  openUnderwriting(): void { const id = this.facility()?.underwriting_case_id; if (id) void this.router.navigate(['/underwriting', id]); }
  milestoneFollowupStatus(m: ContactScheduleMilestone): string | null {
    if (!m.log_id) return null;
    const log = this.contactLogs().find((c) => c.log_id === m.log_id);
    return log?.followup_status || null;
  }

  goToTab(key: string): void {
    if (!this.canSeeTab(key)) return;
    this.activeTab.set(key);
    requestAnimationFrame(() => {
      document.querySelector('.facility-page .tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  openRequest(type: 'Extension' | 'Further Advance' = 'Extension'): void {
    // fall back to the type the role is allowed to raise
    if (type === 'Extension' && !this.canExtension()) type = 'Further Advance';
    if (type === 'Further Advance' && !this.canFurtherAdvance()) type = 'Extension';
    const f = this.facility();
    // One extension at a time: jump to the one already in progress.
    if (type === 'Extension' && this.openExtension() && !this.canFurtherAdvance()) {
      void this.router.navigate(['/extensions', this.openExtension()!.extension_id]);
      return;
    }
    this.requestError.set(null);
    this.requestNotice.set(null);
    this.requestDraft = {
      request_type: type,
      effective_date: new Date().toISOString().slice(0, 10),
      current_maturity: f?.maturity_date || '',
      proposed_maturity: '',
      new_amount: type === 'Further Advance' ? 0 : null,
      reason: '',
    };
    this.extDraft = { extension_months: 2, exit_plan: '' };
    this.extExitFile = null;
    this.requestOpen.set(true);
  }

  /** Extension request (client 30-09-2026): months + reason + exit plan; the rest is done on the extension page. */
  extDraft = { extension_months: 2 as number | null, exit_plan: '' };
  extExitFile: { file_name: string; content_base64: string } | null = null;
  readonly uploadAccept = UPLOAD_ACCEPT;
  onExtExitFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) { this.extExitFile = null; return; }
    const chk = filterUploads([file]); // client 21-10-2026: Word/PDF/image/Excel, 20MB (22-10-2026)
    if (chk.error) { this.toastr.error(chk.error, 'Validation Error'); input.value = ''; this.extExitFile = null; return; }
    const reader = new FileReader();
    reader.onload = () => { this.extExitFile = { file_name: file.name, content_base64: String(reader.result || '') }; };
    reader.readAsDataURL(file);
  }
  extNewMaturity(): string {
    const cur = this.facility()?.maturity_date;
    const m = Number(this.extDraft.extension_months || 0);
    return cur && m > 0 ? this.formatDate(this.addMonths(cur, m)) : '—';
  }

  submitRequest(): void {
    const f = this.facility();
    if (!f) return;
    if (this.requestDraft.request_type === 'Extension') { this.submitExtension(); return; }
    this.requestSaving.set(true);
    this.requestError.set(null);
    this.api.createFacilityRequest(f.loan_number, this.requestDraft).pipe(
      catchError((e) => {
        this.toastr.error(this.errText(e, 'Could not submit request.'), 'Validation Error');
        this.requestSaving.set(false);
        return of(null);
      }),
    ).subscribe((r) => {
      this.requestSaving.set(false);
      if (!r) return;
      this.requestOpen.set(false);
      // Request is recorded AND raised as an Enquiry. Stay on the facility and
      // show the new Enquiry reference — never navigate to a blank New Enquiry.
      if (this.canSeeTab('amendments')) this.activeTab.set('amendments');
      if (r.enquiry_ref) {
        this.toastr.success(`Request submitted. Enquiry ${r.enquiry_ref} raised in the Enquiries module.`, 'Submitted');
      } else if (r.enquiry_error) {
        this.toastr.warning(`Request saved, but the enquiry could not be raised: ${r.enquiry_error}`, 'Partly done');
      } else {
        this.toastr.success('Request submitted for credit review.', 'Submitted');
      }
      this.loadFacility(true);
    });
  }

  private submitExtension(): void {
    const f = this.facility();
    const months = Number(this.extDraft.extension_months || 0);
    if (!f) return;
    if (!Number.isInteger(months) || months < 1 || months > 60) { this.toastr.error('Enter the extension length in whole months (1–60).', 'Validation Error'); return; }
    if (!this.requestDraft.reason.trim()) { this.toastr.error('Give the reason for the extension.', 'Validation Error'); return; }
    this.requestSaving.set(true);
    this.extApi.create(f.loan_number, { extension_months: months, reason: this.requestDraft.reason, exit_plan: this.extDraft.exit_plan }).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not raise the extension.'), 'Validation Error'); this.requestSaving.set(false); return of(null); }),
    ).subscribe((r) => {
      if (!r) { this.requestSaving.set(false); return; }
      const finish = () => {
        this.requestSaving.set(false);
        this.requestOpen.set(false);
        this.toastr.success(`Extension ${r.ref} raised. Open it from the Extensions tab to set the fees and send the agreement.`, 'Extension raised');
        this.loadFacility(true);
      };
      // Client 13-10-2026: attach the exit evidence uploaded with the request.
      if (this.extExitFile) {
        this.extApi.upload(r.id, { kind: 'EXIT_EVIDENCE', file_name: this.extExitFile.file_name, content_base64: this.extExitFile.content_base64 })
          .pipe(catchError(() => of(null))).subscribe(() => finish());
      } else { finish(); }
    });
  }

  openExtensionPage(x: Extension): void { void this.router.navigate(['/extensions', x.extension_id]); }
  extTone(s: string) { return extensionTone(s); }

  // ---- Bad loans (client 30-09-2026) ----
  readonly recoveries = computed(() => this.detail()?.recoveries ?? []);
  readonly badModal = signal<'mark' | 'note' | 'recovery' | 'writeoff' | 'restore' | null>(null);
  readonly badSaving = signal(false);
  badNote = '';
  badReason = '';
  recoveryDraft = { received_on: new Date().toISOString().slice(0, 10), amount: null as number | null, method: 'Bank Transfer', reference: '', notes: '' };

  openBad(kind: 'mark' | 'note' | 'recovery' | 'writeoff' | 'restore'): void {
    const f = this.facility();
    this.badNote = kind === 'note' ? String(f?.bad_debt_note || '') : '';
    this.badReason = '';
    this.recoveryDraft = { received_on: new Date().toISOString().slice(0, 10), amount: null, method: 'Bank Transfer', reference: '', notes: '' };
    this.badModal.set(kind);
  }

  saveBad(): void {
    const f = this.facility();
    const kind = this.badModal();
    if (!f || !kind) return;
    let req$: Observable<unknown>;
    let ok = '';
    if (kind === 'mark' || kind === 'note') {
      if (!this.badNote.trim()) { this.toastr.error('Write what has been happening.', 'Validation Error'); return; }
      req$ = kind === 'mark' ? this.api.markBadDebt(f.loan_number, this.badNote) : this.api.updateBadDebtNote(f.loan_number, this.badNote);
      ok = kind === 'mark' ? 'Facility marked as bad debt.' : 'Bad debt note updated.';
    } else if (kind === 'recovery') {
      const amt = Number(this.recoveryDraft.amount || 0);
      if (!(amt > 0)) { this.toastr.error('Enter the amount received.', 'Validation Error'); return; }
      if (amt > Number(f.remaining_balance ?? 0) + 0.005) { this.toastr.error(`Amount cannot exceed the remaining ${this.money2(f.remaining_balance)}.`, 'Validation Error'); return; }
      req$ = this.api.recordRecovery(f.loan_number, this.recoveryDraft);
      ok = 'Money received recorded.';
    } else if (kind === 'writeoff') {
      if (!this.badReason.trim()) { this.toastr.error('Give the reason for writing off.', 'Validation Error'); return; }
      req$ = this.api.writeOff(f.loan_number, this.badReason);
      ok = 'Facility written off.';
    } else {
      req$ = this.api.restoreBadDebt(f.loan_number, this.badReason);
      ok = 'Facility restored to active.';
    }
    this.badSaving.set(true);
    req$.pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not save.'), 'Validation Error'); return of(null); }),
    ).subscribe((r) => {
      this.badSaving.set(false);
      if (r === null) return;
      this.badModal.set(null);
      const closed = (r as { closed?: boolean })?.closed;
      this.toastr.success(closed ? 'Full amount received - facility closed as Recovered.' : ok, 'Saved');
      if (this.canSeeTab('baddebt')) this.activeTab.set('baddebt');
      this.loadFacility(true);
    });
  }

  dateTime(iso: unknown): string {
    if (!iso) return '—';
    const d = new Date(String(iso));
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Amount due today (principal + interest + charges) - the most a payment can be. */
  readonly paymentDue = signal<number | null>(null);
  openPayment(): void {
    this.paymentError.set(null);
    this.paymentDraft = this.blankPayment();
    this.paymentDue.set(null);
    const f = this.facility();
    if (f) {
      this.api.redemptionPreview(f.loan_number, { redemption_date: this.todayLocal() })
        .pipe(catchError(() => of(null))).subscribe((r) => this.paymentDue.set(r ? r.figures.total_amount : null));
    }
    this.paymentOpen.set(true);
  }

  /** Client-side payment guard — mirrors the server rules incl. the outstanding-balance cap. */
  paymentErrorText(): string | null {
    const amt = Number(this.paymentDraft.amount || 0);
    if (!(amt > 0)) return 'Enter an amount greater than zero.';
    const paidOn = String(this.paymentDraft.paid_on || '').slice(0, 10);
    if (!paidOn) return 'Payment date is required.';
    if (paidOn > this.todayLocal()) return 'Payment date cannot be in the future.';
    if (paidOn < this.todayLocal()) return 'Payment date cannot be in the past.';
    const due = this.paymentDue();
    if (due != null && amt > due + 0.005) return `Payment cannot exceed the amount due of ${this.money2(due)}.`;
    return null;
  }

  /** Today as YYYY-MM-DD on the user's clock (date inputs are local, not UTC). */
  todayLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Tester 20-10-2026: no Record Payment on a closed facility or when nothing is owed. */
  // Client 22-10-2026: payments also clear interest / charges after the principal is repaid.
  readonly canRecordPayment = computed(() => this.canPayAdd() && this.isActive());

  paymentInvalid(): boolean {
    return this.paymentErrorText() != null;
  }

  submitPayment(): void {
    const f = this.facility();
    if (!f) return;
    if (this.paymentInvalid()) {
      this.toastr.error(this.paymentErrorText() || 'Please check the payment details.', 'Validation Error');
      return;
    }
    this.paymentSaving.set(true);
    this.paymentError.set(null);
    this.api.recordPayment(f.loan_number, this.paymentDraft).pipe(
      catchError((e) => {
        this.toastr.error(this.errText(e, 'Could not record payment.'), 'Validation Error');
        this.paymentSaving.set(false);
        return of(null);
      }),
    ).subscribe((r) => {
      this.paymentSaving.set(false);
      if (!r) return;
      this.paymentOpen.set(false);
      this.toastr.success('Payment recorded.', 'Saved');
      this.loadFacility(true);
    });
  }

  openDocumentUpload(): void {
    this.documentError.set(null);
    this.documentOpen.set(true);
  }

  // ---- Drawdown register (client 09-10-2026) ----
  readonly canDrawdownAdd = computed(() => this.pc('FACILITY_DRAWDOWNS', 'add'));
  readonly ddOpen = signal(false);
  readonly ddSaving = signal(false);
  ddDraft: { agreed_month: number | null; net: number | null; interest: number; amount: number | null; drawn_on: string; notes: string } =
    { agreed_month: null, net: null, interest: 0, amount: null, drawn_on: '', notes: '' };
  ddFile: { file_name: string; content_base64: string } | null = null;

  openDrawdownRegister(item: { month: number | null; gross: number; net: number; interest: number }): void {
    this.ddDraft = { agreed_month: item.month, net: item.net, interest: Number(item.interest || 0), amount: item.gross, drawn_on: new Date().toISOString().slice(0, 10), notes: '' };
    this.ddFile = null;
    this.ddOpen.set(true);
  }
  onDrawdownFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) { this.ddFile = null; return; }
    const chk = filterUploads([file]); // client 21-10-2026: Word/PDF/image/Excel, 20MB (22-10-2026)
    if (chk.error) { this.toastr.error(chk.error, 'Validation Error'); input.value = ''; this.ddFile = null; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      this.ddFile = { file_name: file.name, content_base64: base64 };
    };
    reader.readAsDataURL(file);
  }
  submitDrawdown(): void {
    const f = this.facility();
    if (!f) return;
    if (this.ddDraft.net == null || this.ddDraft.net <= 0) { this.toastr.error('Enter the net amount sent.', 'Validation Error'); return; }
    // Net is what leaves the lender; gross recorded = net + the tranche's retained interest.
    this.ddDraft.amount = Math.round((Number(this.ddDraft.net) + Number(this.ddDraft.interest || 0)) * 100) / 100;
    if (!this.ddDraft.drawn_on) { this.toastr.error('Enter the date it was sent.', 'Validation Error'); return; }
    this.ddSaving.set(true);
    const send = (documentId: number | null) => {
      this.api.releaseDrawdown(f.loan_number, {
        amount: this.ddDraft.amount, drawn_on: this.ddDraft.drawn_on, notes: this.ddDraft.notes,
        agreed_month: this.ddDraft.agreed_month, document_id: documentId, status: 'Released',
      }).pipe(catchError((e) => { this.toastr.error(this.errText(e, 'Could not register the drawdown.'), 'Failed'); this.ddSaving.set(false); return of(null); }))
        .subscribe((r) => { this.ddSaving.set(false); if (!r) return; this.ddOpen.set(false); this.toastr.success('Payment sent.', 'Saved'); this.loadFacility(true); });
    };
    if (this.ddFile) {
      this.api.uploadFacilityDocument(f.loan_number, { file_name: this.ddFile.file_name, content_base64: this.ddFile.content_base64 })
        .pipe(catchError(() => { this.toastr.error('Proof upload failed — drawdown not saved.', 'Upload failed'); this.ddSaving.set(false); return of(null); }))
        .subscribe((up) => { if (!up) return; send(up.id); });
    } else {
      send(null);
    }
  }

  onFacilityDocSubmit(payload: DocUploadResult): void {
    const f = this.facility();
    if (!f) return;
    this.documentSaving.set(true);
    this.documentError.set(null);
    this.api.uploadFacilityDocument(f.loan_number, {
      file_name: payload.file_name,
      content_base64: payload.content_base64,
      document_type_id: payload.document_type_id,
    }).pipe(
      catchError((e) => {
        this.toastr.error(this.errText(e, 'Upload failed.'), 'Upload failed');
        this.documentSaving.set(false);
        return of(null);
      }),
    ).subscribe((r) => {
      this.documentSaving.set(false);
      if (!r) return;
      this.documentOpen.set(false);
      this.toastr.success('Document uploaded.', 'Uploaded');
      this.loadFacility(true);
    });
  }


  // ---- Redemption (client 30-09-2026): day-by-day or full-month interest, minimum months,
  //      statement PDF e-mailed to chosen addresses (not saved to Documents). Figures come
  //      from the API so screen = statement. ----
  readonly redBasis = signal<'daily' | 'monthly'>('daily');
  readonly redMinMonths = signal<number | null>(null);
  // Client 12-10-2026: editable redemption fees (document / broker / arrangement).
  readonly redDocFee = signal<number | null>(null);
  readonly redBrokerFee = signal<number | null>(null);
  readonly redArrFee = signal<number | null>(null);
  private redFeesInit = false;
  // Client 16-10-2026: exit fee - '' = facility default / exit fee rows; else £, months' interest, % gross, % net.
  readonly redExitType = signal<RedExitType | ''>('');
  readonly redExitValue = signal<number | null>(null);
  /** £ exit fee shown in the box: auto-calculated, until the user types their own figure. */
  readonly redExitFee = signal<number | null>(null);
  readonly redExitFeeEdited = signal(false);
  readonly redExitTypes: { key: RedExitType; label: string }[] = [
    { key: 'amount', label: '£ amount' },
    { key: 'months', label: 'Months of interest' },
    { key: 'pct_gross', label: '% of gross loan' },
    { key: 'pct_net', label: '% of net loan' },
  ];
  readonly redFigures = signal<RedemptionFigures | null>(null);
  readonly redMinSource = signal('');
  readonly redSendOpen = signal(false);
  readonly redRecipients = signal<{ key: string; label: string; email: string }[]>([]);
  /** Resend an issued statement (id) or generate a new one (null). */
  redResendId: number | null = null;
  redSend = { to: '', cc: '', message: '' };
  private redInit = false;
  readonly statements = computed(() => this.detail()?.redemptions ?? []);
  toNum(v: unknown): number { return Number(v) || 0; }

  /** Recalculate the figures (date / basis / minimum changed). */
  refreshRedemption(): void {
    const f = this.facility();
    if (!f || !this.canSeeTab('redemption')) return;
    this.api.redemptionPreview(f.loan_number, {
      redemption_date: this.redemptionDateIso(),
      interest_basis: this.redInit ? this.redBasis() : undefined,
      min_interest_months: this.redInit ? this.redMinMonths() : undefined,
      document_fee: this.redFeesInit ? this.redDocFee() : undefined,
      broker_fee: this.redFeesInit ? this.redBrokerFee() : undefined,
      arrangement_fee: this.redFeesInit ? this.redArrFee() : undefined,
      exit_fee_type: this.redExitType() || undefined,
      exit_fee_value: this.redExitType() ? this.redExitValue() : undefined,
      exit_fee: this.redExitFeeEdited() ? this.redExitFee() : undefined,
    }).pipe(catchError(() => of(null))).subscribe((r) => {
      if (!r) return;
      this.redFigures.set(r.figures);
      if (!this.redExitFeeEdited()) this.redExitFee.set(r.figures.exit_fee ?? 0);
      if (!this.redInit) {
        this.redBasis.set(r.figures.interest_basis);
        this.redMinMonths.set(r.figures.min_interest_months);
        this.redInit = true;
      }
      if (!this.redFeesInit) {
        this.redDocFee.set(r.figures.document_fee ?? 0);
        this.redBrokerFee.set(r.figures.broker_fee ?? 0);
        this.redArrFee.set(r.figures.arrangement_fee ?? 0);
        this.redFeesInit = true;
      }
      this.redMinSource.set(r.settings.min_source);
    });
  }
  setRedBasis(v: 'daily' | 'monthly'): void { this.redBasis.set(v); this.refreshRedemption(); }
  setRedMin(v: unknown): void {
    const n = v === null || v === '' ? null : Number(v);
    this.redMinMonths.set(n === null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)));
    this.refreshRedemption();
  }
  setRedDate(v: string): void { this.redemptionDate.set(v); this.refreshRedemption(); }
  setRedExitType(v: string): void {
    const t = (this.redExitTypes.some((x) => x.key === v) ? v : '') as RedExitType | '';
    this.redExitType.set(t);
    if (t && this.redExitValue() === null) this.redExitValue.set(t === 'months' ? 1 : 0);
    this.redExitFeeEdited.set(false); // basis changed -> recalculate
    this.refreshRedemption();
  }
  setRedExitValue(v: unknown): void {
    const n = v === null || v === '' ? 0 : Number(v);
    this.redExitValue.set(!Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 10000) / 10000);
    this.redExitFeeEdited.set(false);
    this.refreshRedemption();
  }
  setRedExitFee(v: unknown): void {
    if (v === null || v === '') { this.resetRedExitFee(); return; }
    const n = Number(v);
    this.redExitFee.set(!Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 100) / 100);
    this.redExitFeeEdited.set(true);
    this.refreshRedemption();
  }
  /** Back to the calculated exit fee. */
  resetRedExitFee(): void { this.redExitFeeEdited.set(false); this.refreshRedemption(); }
  redExitHint(): string {
    const t = this.redExitType();
    return t === 'amount' ? '£' : t === 'months' ? 'months' : t ? '%' : '';
  }
  /** Exit fee fields sent with statement / redeem so they match the screen. */
  private redExitQ(): { exit_fee_type?: string; exit_fee_value?: number | null; exit_fee?: number | null } {
    return {
      ...(this.redExitType() ? { exit_fee_type: this.redExitType(), exit_fee_value: this.redExitValue() } : {}),
      ...(this.redExitFeeEdited() ? { exit_fee: this.redExitFee() } : {}),
    };
  }
  setRedFee(which: 'document' | 'broker' | 'arrangement', v: unknown): void {
    const n = v === null || v === '' ? 0 : Number(v);
    const val = !Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 100) / 100;
    if (which === 'document') this.redDocFee.set(val);
    else if (which === 'broker') this.redBrokerFee.set(val);
    else this.redArrFee.set(val);
    this.redFeesInit = true;
    this.refreshRedemption();
  }

  /** Save basis + minimum as this facility's defaults. */
  saveRedemptionDefaults(): void {
    const f = this.facility();
    if (!f) return;
    this.api.redemptionSettings(f.loan_number, { interest_basis: this.redBasis(), min_interest_months: this.redMinMonths() ?? 0, exit_fee_type: this.redExitType() || null, exit_fee_value: this.redExitType() ? this.redExitValue() : null })
      .pipe(catchError((e) => { this.toastr.error(this.errText(e, 'Could not save.'), 'Failed'); return of(null); }))
      .subscribe((r) => { if (r) { this.redMinSource.set('facility'); this.toastr.success('Saved as this facility\'s redemption defaults (interest & minimum).', 'Saved'); } });
  }

  previewStatement(rid?: number): void {
    const f = this.facility();
    if (!f) return;
    const req$ = rid
      ? this.api.redemptionStoredPdf(f.loan_number, rid)
      : this.api.redemptionStatementPdf(f.loan_number, { redemption_date: this.redemptionDateIso(), interest_basis: this.redBasis(), min_interest_months: this.redMinMonths(), document_fee: this.redDocFee(), broker_fee: this.redBrokerFee(), arrangement_fee: this.redArrFee(), ...this.redExitQ() });
    req$.pipe(catchError(() => of(null))).subscribe((blob) => {
      if (blob) window.open(URL.createObjectURL(blob), '_blank');
      else this.toastr.error('Could not build the statement.', 'Failed');
    });
  }

  /** Open the send modal: new statement (no id) or resend an issued one. */
  openRedemptionSend(rid: number | null = null): void {
    const f = this.facility();
    if (!f) return;
    this.redResendId = rid;
    this.redSend = { to: '', cc: '', message: '' };
    this.api.redemptionRecipients(f.loan_number).pipe(catchError(() => of(null))).subscribe((r) => {
      this.redRecipients.set(r?.recipients ?? []);
      if (r) {
        this.redSend.to = r.recipients[0]?.email ?? '';
        this.redSend.cc = r.cc.map((c) => c.email).join(', ');
      }
      this.redSendOpen.set(true);
    });
  }
  hasRecipient(email: string): boolean { return this.redSend.to.split(/[;,\s]+/).map((s) => s.trim().toLowerCase()).includes(email.toLowerCase()); }
  toggleRecipient(email: string): void {
    const list = this.redSend.to.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
    const i = list.findIndex((x) => x.toLowerCase() === email.toLowerCase());
    if (i >= 0) list.splice(i, 1); else list.push(email);
    this.redSend.to = list.join(', ');
  }

  generateRedemption(): void {
    const f = this.facility();
    if (!f) return;
    if (!this.redSend.to.trim()) { this.toastr.error('Choose who to send the statement to.', 'Validation Error'); return; }
    this.redemptionSaving.set(true);
    this.redemptionNotice.set(null);
    const req$: Observable<{ emailed: boolean; error?: string }> = this.redResendId
      ? this.api.redemptionResend(f.loan_number, this.redResendId, this.redSend)
      : this.api.createRedemption(f.loan_number, {
        redemption_date: this.redemptionDateIso(), interest_basis: this.redBasis(), min_interest_months: this.redMinMonths(),
        document_fee: this.redDocFee(), broker_fee: this.redBrokerFee(), arrangement_fee: this.redArrFee(), ...this.redExitQ(),
        send_email: true, ...this.redSend,
      });
    req$.pipe(
      catchError((e) => {
        this.toastr.error(this.errText(e, 'Could not send the redemption statement.'), 'Failed');
        this.redemptionSaving.set(false);
        return of(null);
      }),
    ).subscribe((r) => {
      this.redemptionSaving.set(false);
      if (!r) return;
      this.redSendOpen.set(false);
      if (r.emailed) {
        this.redemptionNotice.set(`Redemption statement e-mailed to ${this.redSend.to}.`);
        this.toastr.success(`Redemption statement e-mailed to ${this.redSend.to}.`, 'Sent');
      } else {
        this.toastr.warning(`Statement recorded, but the e-mail failed: ${r.error || 'unknown error'}`, 'Not sent');
      }
      this.loadFacility(true);
    });
  }

  // Client 26-10-2026: Redeem Facility sits on each sent statement and closes the facility on
  // THAT statement's terms in one go - the amount still owed is recorded as the redemption
  // payment and the facility moves to Redeemed Facilities. No separate Record Payment.
  readonly redeemTarget = signal<Record<string, unknown> | null>(null);
  readonly redeemConfirmOpen = computed(() => !!this.redeemTarget());
  redeemFacility(s: Record<string, unknown>): void { this.redeemTarget.set(s); }
  cancelRedeem(): void { if (!this.redemptionSaving()) this.redeemTarget.set(null); }
  /** A statement dated after today (redeeming it records the payment on that future date). */
  isFutureStatement(s: Record<string, unknown> | null): boolean {
    const d = this.str(s?.['redemption_date']);
    return !!d && d > new Date().toISOString().slice(0, 10);
  }
  confirmRedeem(): void {
    const f = this.facility();
    const s = this.redeemTarget();
    if (!f || !s) return;
    this.redemptionSaving.set(true);
    this.api.redeemFromStatement(f.loan_number, this.toNum(s['redemption_id'])).pipe(
      catchError((e) => { this.toastr.error(this.errText(e, 'Could not redeem facility.'), 'Failed'); return of(null); }),
    ).subscribe((r) => {
      this.redemptionSaving.set(false);
      if (!r) return;
      this.redeemTarget.set(null);
      const msg = `Facility redeemed on RS-${s['redemption_id']} - moved to Redeemed Facilities.`;
      this.redemptionNotice.set(msg);
      this.toastr.success(msg, 'Redeemed');
      this.activeTab.set('redeemed');
      this.loadFacility(true);
    });
  }

  /** Redemption Details tab: the statement the facility was closed on (latest Completed). */
  readonly closingStatement = computed(() => this.statements().find((s) => s['status'] === 'Completed') ?? null);
  /** Its saved calculation (fee split, interest basis, exit fee rule…), if stored. */
  readonly closingFigures = computed<Record<string, unknown>>(() => {
    const raw = this.closingStatement()?.['figures_json'];
    try { return raw ? JSON.parse(String(raw)) : {}; } catch { return {}; }
  });

  private loadFacility(silent = false): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    if (!silent) this.loading.set(true);
    this.api.facility(id).pipe(
      catchError((e) => {
        this.error.set(e?.error?.message || 'Could not load facility.');
        return of(null);
      }),
    ).subscribe((detail) => {
      this.detail.set(detail);
      if (!this.redemptionDate() && detail?.facility?.maturity_date) {
        this.redemptionDate.set(detail.facility.maturity_date);
      }
      const ln = detail?.facility?.loan_number;
      if (ln) this.loadContactExtras(ln);
      this.loading.set(false);
      this.refreshRedemption();
    });
  }

  activeTabLabel(): string {
    return this.tabs().find((t) => t.key === this.shownTab())?.label || 'Facility';
  }

  private loadContactExtras(id: string): void {
    this.api.contactSchedule(id).pipe(catchError(() => of(null))).subscribe((sc) => this.contactSchedule.set(sc));
    this.api.facilityNotes(id).pipe(catchError(() => of([]))).subscribe((n) => this.notes.set(n));
  }

  addNote(): void {
    const f = this.facility();
    const note = this.noteDraft.trim();
    if (!f || !note) return;
    this.noteSaving.set(true);
    this.api.addFacilityNote(f.loan_number, note).pipe(
      catchError(() => { this.noteSaving.set(false); return of(null); }),
    ).subscribe((r) => {
      this.noteSaving.set(false);
      if (!r) return;
      this.noteDraft = '';
      this.api.facilityNotes(f.loan_number).pipe(catchError(() => of([]))).subscribe((n) => this.notes.set(n));
    });
  }

  milestoneClass(status: string): string {
    const s = status.toLowerCase();
    if (s === 'done') return 'pill pill-paid';
    if (s === 'overdue') return 'pill pill-overdue';
    if (s === 'due') return 'pill pill-due';
    return 'pill';
  }

  /** Field-aware error line for toasts: names the offending field(s), never a bare 'Validation Error'. */
  private errText(e: unknown, fb: string): string {
    const list = toFieldErrorList(extractFieldErrors(e));
    if (list.length) return errorSummary(list, fb);
    const m = (e as { error?: { message?: string } })?.error?.message;
    return m && m !== 'Validation Error' ? m : fb;
  }

  money(v: unknown): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v || 0));
  }

  /** Two-decimal GBP for per-day figures (£202.63). */
  money2(v: unknown): string {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0));
  }

  /** Compact £ axis label (£800k, £1.4m). */
  axisK(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 1000000) {
      const m = v / 1000000;
      return `£${Number(m.toFixed(2))}m`;
    }
    if (abs >= 1000) {
      const k = v / 1000;
      return `£${Number(k.toFixed(k >= 100 ? 0 : 1))}k`;
    }
    return `£${Math.round(v)}`;
  }

  str(v: unknown): string {
    return v == null ? '' : String(v);
  }

  formatDate(iso: string): string {    if (!iso) return '—';
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private addDays(iso: string, days: number): string {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private addMonths(iso: string, months: number): string {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) return iso;
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d.toISOString().slice(0, 10);
  }

  private blankRequest(): PortfolioFacilityRequestPayload {
    return {
      request_type: 'Extension',
      effective_date: '',
      current_maturity: '',
      proposed_maturity: '',
      new_amount: null,
      reason: '',
    };
  }

  private blankPayment(): PortfolioPaymentPayload {
    return {
      paid_on: this.todayLocal(),
      amount: null,
      method: 'Bank Transfer',
      reference: '',
      schedule_id: null,
    };
  }
}
