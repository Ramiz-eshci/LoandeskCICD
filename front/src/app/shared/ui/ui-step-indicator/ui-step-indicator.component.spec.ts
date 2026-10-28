import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiStepIndicatorComponent } from './ui-step-indicator.component';

describe('UiStepIndicatorComponent', () => {
  let fixture: ComponentFixture<UiStepIndicatorComponent>;
  let cmp: UiStepIndicatorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiStepIndicatorComponent] });
    fixture = TestBed.createComponent(UiStepIndicatorComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('steps', [{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
  });

  it('progress variant: done before current, active at current, upcoming after', () => {
    fixture.componentRef.setInput('current', 1);
    fixture.detectChanges();
    expect(cmp.state(0)).toBe('done');
    expect(cmp.state(1)).toBe('active');
    expect(cmp.state(2)).toBe('upcoming');
  });

  it('pipeline variant: every step is done', () => {
    fixture.componentRef.setInput('variant', 'pipeline');
    fixture.detectChanges();
    expect(cmp.state(0)).toBe('done');
    expect(cmp.state(2)).toBe('done');
  });
});
