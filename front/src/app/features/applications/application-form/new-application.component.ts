import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { ApplicationsService } from '../applications.service';
import { ApplicationFormOptions } from '../applications-list/application.model';
import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiFormFieldComponent } from '../../../shared/ui/ui-form-field/ui-form-field.component';
import { UiSegmentedComponent } from '../../../shared/ui/ui-segmented/ui-segmented.component';
import { UiWizardStepsComponent } from '../../../shared/ui/ui-wizard-steps/ui-wizard-steps.component';
import {
  APPLICANT_TYPES,
  APPLICATION_STEPS,
  BANKRUPTCY_OPTIONS,
  CHARGE_OPTIONS,
  CREDIT_SCORES,
  EXIT_STRATEGIES,
  LOAN_PURPOSES,
  PRODUCTS,
  REQUIRED_DOCUMENTS,
  SCREENING_OPTIONS,
  TENURES,
  TITLES,
} from './application-form.options';

/** New Application — nine-step origination form on its own page. */
@Component({
  selector: 'app-new-application',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    UiButtonDirective,
    UiCardComponent,
    UiFormFieldComponent,
    UiSegmentedComponent,
    UiWizardStepsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-application.component.html',
  styleUrl: './new-application.component.scss',
})
export class NewApplicationComponent implements OnInit {
  /** Max for date-of-birth pickers: today (yyyy-mm-dd, local). A DOB can never be in the future. */
  readonly today = new Date().toLocaleDateString('en-CA');

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly api = inject(ApplicationsService);
  private readonly toastr = inject(ToastrService);
  private readonly destroyRef = inject(DestroyRef);

  readonly options = signal<ApplicationFormOptions | null>(null);
  readonly saving = signal(false);

  ngOnInit(): void {
    this.api.formOptions()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((o) => this.options.set(o));
  }

  /** Resolve a picklist to a real DB id by label match, else first option. */
  private resolveId(list: { id: number; name: string }[] | undefined, ...contains: string[]): number | null {
    if (!list || !list.length) return null;
    for (const c of contains) {
      const hit = list.find((x) => x.name.toLowerCase().includes(c.toLowerCase()));
      if (hit) return hit.id;
    }
    return list[0].id;
  }
  private productId(): number | null {
    const map: Record<string, string[]> = { bridge: ['bridge'], development: ['development'], term: ['term'], commercial: ['commercial'] };
    return this.resolveId(this.options()?.products, ...(map[this.productType()] || []));
  }
  private purposeId(): number | null {
    const map: Record<string, string[]> = { purchase: ['purchase'], refinance: ['refinance'], development: ['develop', 'renovat'], 'working-capital': ['working'], 'bridge-to-sale': ['bridge', 'sale'], auction: ['auction'] };
    return this.resolveId(this.options()?.purposes, ...(map[this.purpose()] || []));
  }
  private applicantTypeId(): number | null {
    const map: Record<string, string[]> = { individual: ['individual'], company: ['compan'], joint: ['individual'], 'multi-party': ['individual'] };
    return this.resolveId(this.options()?.applicantTypes, ...(map[this.applicantType()] || []));
  }
  private applicantTypeCode(): string { return this.applicantType() === 'company' ? 'COMPANY' : 'INDIVIDUAL'; }
  private branchId(): number | null {
    return this.resolveId(this.options()?.branches, this.session.branchName());
  }

  readonly steps = APPLICATION_STEPS;
  readonly applicantTypes = APPLICANT_TYPES;
  readonly products = PRODUCTS;
  readonly purposes = LOAN_PURPOSES;
  readonly exitStrategies = EXIT_STRATEGIES;
  readonly creditScores = CREDIT_SCORES;
  readonly bankruptcyOptions = BANKRUPTCY_OPTIONS;
  readonly tenures = TENURES;
  readonly titles = TITLES;
  readonly chargeOptions = CHARGE_OPTIONS;
  readonly screeningOptions = SCREENING_OPTIONS;
  readonly requiredDocuments = REQUIRED_DOCUMENTS;

  readonly feeFields = [
    { control: 'monthlyRate', label: 'Monthly interest rate (%)' },
    { control: 'arrangementFee', label: 'Arrangement fee (%)' },
    { control: 'exitFee', label: 'Exit fee (%)' },
    { control: 'brokerCommission', label: 'Broker commission (%)' },
    { control: 'documentationFee', label: 'Documentation fee (£)' },
    { control: 'loandeskFee', label: 'LoanDesk broker fee (%)' },
  ];

  readonly step = signal(0);
  readonly received = signal(new Set<string>());

  readonly applicantType = signal('individual');
  readonly hasGuarantor = signal(false);
  readonly productType = signal('bridge');
  readonly purpose = signal('purchase');
  readonly creditScore = signal('good');
  readonly bankruptcy = signal('no');
  readonly tenure = signal('freehold');
  readonly title = signal('registered');
  readonly charge = signal('first');
  readonly sanctions = signal('pending');
  readonly pep = signal('pending');
  readonly aml = signal('pending');

  /** Client 20-10-2026: same number limits as the New Enquiry form (amount / value >= 1,
   *  term 1-600). Accepts "250,000" / "£250,000" as typed here. */
  private range(min: number, max: number) {
    return (c: AbstractControl) => {
      const raw = String(c.value ?? '').replace(/[£,\s]/g, '');
      if (raw === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return { number: true };
      if (n < min) return { min: { min } };
      if (n > max) return { max: { max } };
      return null;
    };
  }
  private readonly phoneV = (c: AbstractControl) =>
    (c.value && !/^\+?[0-9]+$/.test(String(c.value).replace(/[\s()-]/g, '')) ? { phone: true } : null);

  readonly applicant = this.fb.nonNullable.group({
    fullName: ['', Validators.required],
    email: ['', Validators.email],
    phone: ['', this.phoneV],
    dateOfBirth: ['', (c: AbstractControl) => (c.value && String(c.value) > this.today ? { future: true } : null)],
    guarantorName: [''],
  });

  readonly product = this.fb.nonNullable.group({
    monthlyRate: ['1.05'],
    arrangementFee: ['2'],
    exitFee: ['1'],
    brokerCommission: ['1'],
    documentationFee: ['500'],
    loandeskFee: ['0.5'],
  });

  readonly request = this.fb.nonNullable.group({
    amount: ['', [Validators.required, this.range(1, 999999999999)]],
    term: ['12', [Validators.required, this.range(1, 600)]],
    completion: [''],
    exitStrategy: ['Sale of property'],
  });

  readonly financial = this.fb.nonNullable.group({
    income: [''],
    netWorth: [''],
    liabilities: [''],
  });

  readonly security = this.fb.nonNullable.group({
    address: ['', Validators.required],
    value: ['', [Validators.required, this.range(1, 999999999999)]],
  });

  readonly kyc = this.fb.nonNullable.group({ sourceOfFunds: [''] });
  readonly structure = this.fb.nonNullable.group({ notes: [''] });

  private readonly amountValue = computed(() => this.numeric(this.request.controls.amount.value));
  private readonly propertyValue = computed(() => this.numeric(this.security.controls.value.value));

  readonly ltv = computed(() => {
    const amount = this.amountValue();
    const value = this.propertyValue();
    if (!amount || !value) return '—';
    return `${Math.round((amount / value) * 100)}%`;
  });

  /** Indicative structure figures derived from the entered amount and fee rates. */
  readonly structureMetrics = computed(() => {
    const gross = this.amountValue();
    const rate = Number(this.product.controls.monthlyRate.value) || 0;
    const term = Number(this.request.controls.term.value) || 0;
    const arrangement = (gross * (Number(this.product.controls.arrangementFee.value) || 0)) / 100;
    const exit = (gross * (Number(this.product.controls.exitFee.value) || 0)) / 100;
    const docFee = Number(this.product.controls.documentationFee.value) || 0;
    const rolledInterest = (gross * rate * term) / 100;

    return [
      { label: 'Net advance', value: this.money(gross - arrangement - docFee - rolledInterest) },
      { label: 'Rolled interest', value: this.money(rolledInterest) },
      { label: 'Gross redemption', value: this.money(gross + exit) },
      { label: 'Arrangement fee', value: this.money(arrangement) },
      { label: 'Exit fee', value: this.money(exit) },
      { label: 'Lender income', value: this.money(arrangement + exit + docFee + rolledInterest) },
      { label: 'LTV', value: this.ltv() },
      { label: 'Monthly rate', value: `${rate}%` },
      { label: 'Approx. IRR', value: gross ? `${(rate * 12).toFixed(1)}%` : '0%' },
    ];
  });

  readonly reviewRows = computed(() => {
    const productLabel = this.products.find((p) => p.key === this.productType())?.label ?? '';
    const gross = this.amountValue();
    return [
      {
        label: 'Applicant',
        value: this.applicant.controls.fullName.value || this.applicantLabel(),
        hint: this.applicantLabel(),
      },
      { label: 'Product', value: productLabel, hint: `${this.product.controls.monthlyRate.value}% pm` },
      {
        label: 'Gross loan',
        value: this.money(gross),
        hint: `${this.ltv()} LTV · ${this.request.controls.term.value} months`,
      },
      { label: 'Net advance', value: this.structureMetrics()[0].value, hint: 'After fees' },
      {
        label: 'Gross redemption',
        value: this.structureMetrics()[2].value,
        hint: 'Capital + interest + exit fee',
      },
      { label: 'Security', value: `Est. ${this.money(this.propertyValue())}`, hint: this.security.controls.address.value },
      { label: 'Exit strategy', value: this.request.controls.exitStrategy.value, hint: '' },
      { label: 'Assigned UW', value: 'Daniel Hayes', hint: this.session.branchName() },
    ];
  });

  toggleDocument(doc: string): void {
    this.received.update((set) => {
      const next = new Set(set);
      if (next.has(doc)) next.delete(doc);
      else next.add(doc);
      return next;
    });
  }

  errorFor(group: { controls: Record<string, { invalid: boolean; touched: boolean; errors?: Record<string, unknown> | null }> }, name: string): string {
    const control = group.controls[name];
    if (!control || !control.invalid || !control.touched) return '';
    const e = control.errors || {};
    if (e['required']) return 'This field is required.';
    if (e['number']) return 'Enter a number.';
    if (e['min']) return `Must be ${(e['min'] as { min: number }).min} or more.`;
    if (e['max']) return `Must be ${(e['max'] as { max: number }).max} or less.`;
    if (e['email']) return 'Enter a valid email address.';
    if (e['phone']) return 'Digits only (optional leading +).';
    if (e['future']) return 'Date cannot be in the future.';
    return 'This field is required.';
  }

  goTo(index: number): void {
    if (index <= this.step()) this.step.set(index);
  }

  next(): void {
    const blocking: Record<number, { invalid: boolean; markAllAsTouched: () => void }> = {
      0: this.applicant,
      2: this.request,
      4: this.security,
    };
    const group = blocking[this.step()];
    if (group?.invalid) {
      group.markAllAsTouched();
      return;
    }
    this.step.update((s) => Math.min(this.steps.length - 1, s + 1));
  }

  back(): void {
    this.step.update((s) => Math.max(0, s - 1));
  }

  cancel(): void {
    void this.router.navigate(['/applications']);
  }

  submit(): void {
    // Validate every required group; jump to the first invalid step.
    const groups: { step: number; group: { invalid: boolean; markAllAsTouched: () => void } }[] = [
      { step: 0, group: this.applicant },
      { step: 2, group: this.request },
      { step: 4, group: this.security },
    ];
    for (const g of groups) {
      if (g.group.invalid) {
        g.group.markAllAsTouched();
        this.step.set(g.step);
        this.toastr.error('Please complete the required fields.', 'Missing information');
        return;
      }
    }
    if (this.saving()) return;
    this.saving.set(true);

    const isCompany = this.applicantType() === 'company';
    const fullName = this.applicant.controls.fullName.value.trim();
    const payload: Record<string, unknown> = {
      applicant_name: isCompany ? '' : fullName,
      company_name: isCompany ? fullName : '',
      applicant_type_id: this.applicantTypeId(),
      applicant_type_code: this.applicantTypeCode(),
      email: this.applicant.controls.email.value.trim() || null,
      phone: this.applicant.controls.phone.value.trim() || null,
      dob: this.applicant.controls.dateOfBirth.value || null,
      guarantor_name: this.hasGuarantor() ? (this.applicant.controls.guarantorName.value.trim() || null) : null,
      branch_id: this.branchId(),
      product_id: this.productId(),
      loan_purpose_id: this.purposeId(),
      amount_requested: this.numeric(this.request.controls.amount.value),
      term_months: Number(this.request.controls.term.value) || null,
      completion_date: this.request.controls.completion.value || null,
      property_address: this.security.controls.address.value.trim(),
      estimated_value: this.numeric(this.security.controls.value.value),
      charge_type: this.charge() === 'first' ? '1st Legal Charge' : '2nd Legal Charge',
      monthly_fee_pct: Number(this.product.controls.monthlyRate.value) || 0,
      arrangement_fee_pct: Number(this.product.controls.arrangementFee.value) || 0,
      exit_fee_pct: Number(this.product.controls.exitFee.value) || 0,
      doc_fee: Number(this.product.controls.documentationFee.value) || 0,
      loandesk_broker_fee_pct: Number(this.product.controls.loandeskFee.value) || 0,
      borrower_broker_fee_pct: Number(this.product.controls.brokerCommission.value) || 0,
      kyc_aml_status: this.capitalize(this.aml()),
      kyc_pep_status: this.capitalize(this.pep()),
      kyc_identity_status: this.capitalize(this.sanctions()),
      financial: {
        income: this.numeric(this.financial.controls.income.value),
        net_worth: this.numeric(this.financial.controls.netWorth.value),
        liabilities: this.numeric(this.financial.controls.liabilities.value),
      },
      documents: this.requiredDocuments.map((d) => ({ name: d, received: this.received().has(d) })),
      exit_strategy: this.request.controls.exitStrategy.value || null,
      source_of_funds: this.kyc.controls.sourceOfFunds.value || null,
      credit_score: this.creditScores.find((c) => c.key === this.creditScore())?.label || null,
    };

    this.api.create(payload)
      .pipe(catchError((e: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.toastr.error(e?.error?.message || 'Could not create application.', 'Failed');
        return of(null);
      }), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => {
        if (r === null) return;
        this.saving.set(false);
        this.toastr.success('Application ' + r.application_ref + ' created.', 'Created');
        void this.router.navigate(['/applications', r.id]);
      });
  }

  private capitalize(v: string): string {
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  }

  private applicantLabel(): string {
    return this.applicantTypes.find((t) => t.key === this.applicantType())?.label ?? '';
  }

  private numeric(value: string): number {
    return Number(String(value).replace(/[^0-9.]/g, '')) || 0;
  }

  private money(value: number): string {
    return `£${Math.round(value).toLocaleString('en-GB')}`;
  }
}
