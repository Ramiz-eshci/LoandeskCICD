import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiBadgeComponent } from './ui-badge.component';

describe('UiBadgeComponent', () => {
  let fixture: ComponentFixture<UiBadgeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiBadgeComponent] });
    fixture = TestBed.createComponent(UiBadgeComponent);
  });

  it('creates with the default "info" tone', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.status()).toBe('info');
  });

  it('accepts a status input', () => {
    fixture.componentRef.setInput('status', 'approved');
    fixture.detectChanges();
    expect(fixture.componentInstance.status()).toBe('approved');
  });
});
