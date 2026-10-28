import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPillTabsComponent } from './ui-pill-tabs.component';

describe('UiPillTabsComponent', () => {
  let fixture: ComponentFixture<UiPillTabsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiPillTabsComponent] });
    fixture = TestBed.createComponent(UiPillTabsComponent);
    fixture.componentRef.setInput('tabs', [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
  });

  it('renders the tab labels', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A');
    expect(fixture.nativeElement.textContent).toContain('B');
  });

  it('exposes the active model (two-way)', () => {
    fixture.componentRef.setInput('active', 'b');
    fixture.detectChanges();
    expect(fixture.componentInstance.active()).toBe('b');
  });
});
