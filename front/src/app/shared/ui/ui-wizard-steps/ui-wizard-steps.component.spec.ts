import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiWizardStepsComponent } from './ui-wizard-steps.component';

describe('UiWizardStepsComponent', () => {
  let fixture: ComponentFixture<UiWizardStepsComponent>;
  let cmp: UiWizardStepsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiWizardStepsComponent] });
    fixture = TestBed.createComponent(UiWizardStepsComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('steps', [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
  });

  it('classifies steps relative to the current index', () => {
    fixture.componentRef.setInput('current', 1);
    fixture.detectChanges();
    expect(cmp.state(0)).toBe('done');
    expect(cmp.state(1)).toBe('current');
    expect(cmp.state(2)).toBe('upcoming');
  });

  it('emits the selected step index', () => {
    const spy = jest.fn();
    cmp.stepSelected.subscribe(spy);
    cmp.stepSelected.emit(0);
    expect(spy).toHaveBeenCalledWith(0);
  });
});
