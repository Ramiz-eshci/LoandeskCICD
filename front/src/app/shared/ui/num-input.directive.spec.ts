import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { NumInputDirective } from './num-input.directive';

@Component({
  standalone: true,
  imports: [FormsModule, NumInputDirective],
  template: `
    <input id="money" type="text" numInput [(ngModel)]="money" />
    <input id="int" type="text" numInput integer [(ngModel)]="whole" />
    <input id="neg" type="text" numInput allowNegative [(ngModel)]="neg" />
  `,
})
class HostComponent {
  money: number | null = null;
  whole: number | null = null;
  neg: number | null = null;
}

describe('NumInputDirective', () => {
  let host: HostComponent;
  let el: (id: string) => HTMLInputElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    el = (id) => fixture.debugElement.query(By.css('#' + id)).nativeElement;
  });

  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const key = (input: HTMLInputElement, k: string) => {
    const ev = new KeyboardEvent('keydown', { key: k, cancelable: true });
    input.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('blocks minus / plus / exponent keys', () => {
    for (const k of ['-', '+', 'e', 'E']) expect(key(el('money'), k)).toBe(true);
    expect(key(el('money'), '5')).toBe(false);
    expect(key(el('money'), '.')).toBe(false);
  });

  it('caps money at two decimals and writes the number to the model', () => {
    type(el('money'), '1234.5678');
    expect(el('money').value).toBe('1234.56');
    expect(host.money).toBe(1234.56);
    type(el('money'), '1.2.3');
    expect(el('money').value).toBe('1.23');
  });

  it('integer mode drops decimals and blocks the dot key', () => {
    expect(key(el('int'), '.')).toBe(true);
    type(el('int'), '12.9');
    expect(el('int').value).toBe('12');
    expect(host.whole).toBe(12);
  });

  it('allowNegative keeps a leading minus', () => {
    expect(key(el('neg'), '-')).toBe(false);
    type(el('neg'), '-15.555');
    expect(el('neg').value).toBe('-15.55');
    expect(host.neg).toBe(-15.55);
  });
});
