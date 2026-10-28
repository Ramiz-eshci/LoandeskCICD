import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSearchInputComponent } from './ui-search-input.component';

describe('UiSearchInputComponent', () => {
  let fixture: ComponentFixture<UiSearchInputComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [UiSearchInputComponent] });
    fixture = TestBed.createComponent(UiSearchInputComponent);
  });

  it('creates with the default placeholder and header variant', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance.placeholder()).toBe('Search');
    expect(fixture.componentInstance.variant()).toBe('header');
    expect(fixture.componentInstance.value()).toBe('');
  });

  it('reflects a set value model', () => {
    fixture.componentRef.setInput('value', 'acme');
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('acme');
  });
});
