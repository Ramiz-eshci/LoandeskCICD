import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiAvatarComponent } from './ui-avatar.component';

describe('UiAvatarComponent', () => {
  let fixture: ComponentFixture<UiAvatarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiAvatarComponent] });
    fixture = TestBed.createComponent(UiAvatarComponent);
  });

  it('renders two-letter initials from the name', () => {
    fixture.componentRef.setInput('name', 'Ramiz Khan');
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('RK');
  });

  it('takes only the first two words for the initials', () => {
    fixture.componentRef.setInput('name', 'John Michael Smith');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('JM');
  });
});
