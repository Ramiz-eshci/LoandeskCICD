import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiFilterChipsComponent } from './ui-filter-chips.component';

describe('UiFilterChipsComponent', () => {
  let fixture: ComponentFixture<UiFilterChipsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiFilterChipsComponent] });
    fixture = TestBed.createComponent(UiFilterChipsComponent);
    fixture.componentRef.setInput('chips', [{ key: 'all', label: 'All', count: 10 }, { key: 'new', label: 'New', count: 3 }]);
  });

  it('renders chip labels and counts', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('All');
    expect(text).toContain('New');
  });

  it('defaults active to "all"', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.active()).toBe('all');
  });
});
