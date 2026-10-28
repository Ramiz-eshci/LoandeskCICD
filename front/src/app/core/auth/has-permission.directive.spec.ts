import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HasPermissionDirective } from './has-permission.directive';
import { PermissionsStore } from '../session/permissions.store';

@Component({
  standalone: true,
  imports: [HasPermissionDirective],
  template: `<button *appHasPermission="'APPLICATION.add'" id="btn">New</button>`,
})
class HostComponent {}

describe('HasPermissionDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let perms: PermissionsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    perms = TestBed.inject(PermissionsStore);
    fixture = TestBed.createComponent(HostComponent);
  });

  const btn = () => fixture.nativeElement.querySelector('#btn');

  it('shows content while permissions have not loaded', () => {
    fixture.detectChanges();
    expect(btn()).toBeTruthy();
  });

  it('hides content when loaded without the required permission', () => {
    perms.set(['APPLICATION.view']);
    fixture.detectChanges();
    expect(btn()).toBeNull();
  });

  it('shows content when the required permission is present', () => {
    perms.set(['APPLICATION.add']);
    fixture.detectChanges();
    expect(btn()).toBeTruthy();
  });
});
