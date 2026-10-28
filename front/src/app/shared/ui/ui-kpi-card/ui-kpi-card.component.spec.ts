import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiKpiCardComponent } from './ui-kpi-card.component';

describe('UiKpiCardComponent', () => {
  let fixture: ComponentFixture<UiKpiCardComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiKpiCardComponent] });
    fixture = TestBed.createComponent(UiKpiCardComponent);
    fixture.componentRef.setInput('label', 'Portfolio Value');
    fixture.componentRef.setInput('value', '£12.4m');
  });

  it('renders the label and value', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Portfolio Value');
    expect(text).toContain('£12.4m');
  });

  it('defaults tone to "default" and labelStyle to "caps"', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('default');
    expect(fixture.componentInstance.labelStyle()).toBe('caps');
  });
});
