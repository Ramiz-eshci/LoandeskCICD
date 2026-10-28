import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTagComponent } from './ui-tag.component';

describe('UiTagComponent', () => {
  let fixture: ComponentFixture<UiTagComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiTagComponent] });
    fixture = TestBed.createComponent(UiTagComponent);
  });

  it('creates with the default "neutral" tone', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('neutral');
  });

  it('accepts a tone input', () => {
    fixture.componentRef.setInput('tone', 'danger');
    fixture.detectChanges();
    expect(fixture.componentInstance.tone()).toBe('danger');
  });
});
