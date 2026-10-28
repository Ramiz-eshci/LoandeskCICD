import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiProgressComponent } from './ui-progress.component';

describe('UiProgressComponent', () => {
  let fixture: ComponentFixture<UiProgressComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiProgressComponent] });
    fixture = TestBed.createComponent(UiProgressComponent);
  });

  it('creates with a required value', () => {
    fixture.componentRef.setInput('value', 42);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.value()).toBe(42);
  });

  it('renders a value over 100 without crashing (clamped internally)', () => {
    fixture.componentRef.setInput('value', 150);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });
});
