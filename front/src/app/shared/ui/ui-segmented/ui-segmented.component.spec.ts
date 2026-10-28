import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSegmentedComponent } from './ui-segmented.component';

describe('UiSegmentedComponent', () => {
  let fixture: ComponentFixture<UiSegmentedComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiSegmentedComponent] });
    fixture = TestBed.createComponent(UiSegmentedComponent);
    fixture.componentRef.setInput('options', [{ key: 'ind', label: 'Individual' }, { key: 'co', label: 'Company' }]);
  });

  it('renders the option labels', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Individual');
    expect(fixture.nativeElement.textContent).toContain('Company');
  });

  it('defaults value to empty and reflects a set value', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('');
    fixture.componentRef.setInput('value', 'co');
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('co');
  });
});
