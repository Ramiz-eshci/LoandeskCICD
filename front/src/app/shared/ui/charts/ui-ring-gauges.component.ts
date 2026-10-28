import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface RingGauge {
  label: string;
  /** 0-100 */
  value: number;
  display?: string;
  color?: string;
}

/** Row of percentage rings (conversion / approval rates). Plain SVG, no chart library. */
@Component({
  selector: 'ui-ring-gauges',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rings">
      @for (g of items(); track g.label) {
        <div class="ring">
          <svg viewBox="0 0 120 120" role="img" [attr.aria-label]="g.label + ' ' + g.value + '%'">
            <circle cx="60" cy="60" r="50" class="track" />
            <circle cx="60" cy="60" r="50" class="arc" [attr.stroke]="g.color || '#0f2244'"
                    [attr.stroke-dasharray]="dash(g.value)" transform="rotate(-90 60 60)" />
            <text x="60" y="60" class="pct" text-anchor="middle" dominant-baseline="central">{{ g.value }}%</text>
          </svg>
          <b>{{ g.label }}</b>
          @if (g.display) { <small>{{ g.display }}</small> }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .rings { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; padding: 8px 0; }
    .ring { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; }
    svg { width: 120px; height: 120px; }
    .track { fill: none; stroke: #eef2f7; stroke-width: 12; }
    .arc { fill: none; stroke-width: 12; stroke-linecap: round; transition: stroke-dasharray 0.4s; }
    .pct { font-family: 'DM Mono', ui-monospace, monospace; font-size: 20px; font-weight: 700; fill: #0f2244; }
    b { font-size: 12.5px; color: #0f2244; }
    small { font-size: 11.5px; color: #64748b; }
  `],
})
export class UiRingGaugesComponent {
  readonly items = input.required<RingGauge[]>();
  dash(v: number): string {
    const c = 2 * Math.PI * 50;
    const p = Math.max(0, Math.min(100, Number(v) || 0));
    return `${(c * p) / 100} ${c}`;
  }
}
