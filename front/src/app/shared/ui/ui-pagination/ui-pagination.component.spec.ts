import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPaginationComponent } from './ui-pagination.component';

describe('UiPaginationComponent', () => {
  let fixture: ComponentFixture<UiPaginationComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiPaginationComponent] });
    fixture = TestBed.createComponent(UiPaginationComponent);
    fixture.componentRef.setInput('summary', 'Showing 1–10 of 42');
  });

  it('renders the summary text', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Showing 1–10 of 42');
  });

  it('defaults hasPrevious/hasNext to false', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.hasPrevious()).toBe(false);
    expect(fixture.componentInstance.hasNext()).toBe(false);
  });

  it('emits previous/next through its outputs', () => {
    const prev = jest.fn();
    const next = jest.fn();
    fixture.componentInstance.previous.subscribe(prev);
    fixture.componentInstance.next.subscribe(next);
    fixture.componentInstance.previous.emit();
    fixture.componentInstance.next.emit();
    expect(prev).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
