import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';

import { ChartValueFormat, formatTooltipValue } from './chart-theme';

export interface SankeyNode {
  id: string;
  label: string;
  color?: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

interface LaidNode extends SankeyNode {
  col: number;
  labelW: number;
  x: number;
  y: number;
  h: number;
  value: number;
  color: string;
}

interface LaidLink {
  d: string;
  color: string;
  title: string;
}

const NODE_W = 14;
const PAD = 42;
const VIEW_W = 1000;
const MARGIN_L = 170;
const MARGIN_R = 200;

/**
 * Flow (Sankey) diagram drawn as plain SVG - no chart library. Columns come from the
 * link graph (a node sits one column right of its furthest source); node height is
 * proportional to max(in, out); bands are filled bezier ribbons tinted with the
 * target node colour. Used by the Pipeline Summary report.
 */
@Component({
  selector: 'ui-sankey',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sankey-wrap">
      <svg class="sankey" [attr.viewBox]="'0 0 ' + viewW + ' ' + layout().height" role="img" [attr.aria-label]="ariaLabel()">
        <g class="links">
          @for (l of layout().links; track $index) {
            <path class="link" [attr.d]="l.d" [attr.fill]="l.color"><title>{{ l.title }}</title></path>
          }
        </g>
        <g class="nodes">
          @for (nd of layout().nodes; track nd.id) {
            <g class="node" (click)="nodeClick.emit(nd.id)">
              <rect [attr.x]="nd.x" [attr.y]="nd.y" [attr.width]="nodeW" [attr.height]="nd.h" [attr.fill]="nd.color" rx="2">
                <title>{{ nd.label }}: {{ fmt(nd.value) }}</title>
              </rect>
              <!-- Label on a white pill so it stays readable over the ribbons. -->
              <rect class="pill" [attr.x]="nd.col === 0 ? nd.x - 10 - nd.labelW : nd.x + nodeW + 6" [attr.y]="nd.y + nd.h / 2 - 19"
                    [attr.width]="nd.labelW + 8" height="38" rx="6" />
              <text class="label" [attr.x]="nd.col === 0 ? nd.x - 10 : nd.x + nodeW + 10" [attr.y]="nd.y + nd.h / 2 - 5"
                    [attr.text-anchor]="nd.col === 0 ? 'end' : 'start'" dominant-baseline="middle">
                <tspan class="label-name">{{ nd.label }}</tspan>
              </text>
              <text class="label" [attr.x]="nd.col === 0 ? nd.x - 10 : nd.x + nodeW + 10" [attr.y]="nd.y + nd.h / 2 + 10"
                    [attr.text-anchor]="nd.col === 0 ? 'end' : 'start'" dominant-baseline="middle">
                <tspan class="label-value">{{ fmt(nd.value) }}</tspan>
                @if (nd.col > 0 && total() > 0) { <tspan class="label-pct" dx="5">{{ share(nd.value) }}</tspan> }
              </text>
            </g>
          }
        </g>
      </svg>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sankey-wrap { width: 100%; overflow-x: auto; }
    .sankey { display: block; width: 100%; min-width: 680px; height: auto; font-family: 'Inter', system-ui, sans-serif; }
    .link { opacity: 0.38; transition: opacity 0.15s; }
    .link:hover { opacity: 0.7; }
    .node { cursor: pointer; }
    .pill { fill: rgba(255, 255, 255, 0.92); stroke: #e2e8f0; }
    .label { font-size: 12.5px; fill: #0f2244; pointer-events: none; }
    .label-name { font-weight: 600; }
    .label-value { font-family: 'DM Mono', ui-monospace, monospace; fill: #334155; }
    .label-pct { fill: #64748b; font-size: 11.5px; }
  `],
})
export class UiSankeyComponent {
  readonly nodes = input.required<SankeyNode[]>();
  readonly links = input.required<SankeyLink[]>();
  readonly valueFormat = input<ChartValueFormat>('number');
  readonly ariaLabel = input('Flow diagram');
  /** Emits the clicked node id (report drill-down). */
  readonly nodeClick = output<string>();

  protected readonly viewW = VIEW_W;
  protected readonly nodeW = NODE_W;

  /** Total entering the diagram (sum of first-column nodes). */
  protected readonly total = computed(() =>
    this.layout().nodes.filter((nd) => nd.col === 0).reduce((a, nd) => a + nd.value, 0));

  protected fmt(v: number): string {
    return formatTooltipValue(v, this.valueFormat());
  }

  protected share(v: number): string {
    const t = this.total();
    return t ? `(${Math.round((v / t) * 1000) / 10}%)` : '';
  }

  protected readonly layout = computed(() => {
    const links = this.links().filter((l) => l.value > 0);
    const ids = new Set<string>();
    links.forEach((l) => { ids.add(l.source); ids.add(l.target); });
    const nodes = this.nodes().filter((nd) => ids.has(nd.id));
    const inV = new Map<string, number>();
    const outV = new Map<string, number>();
    links.forEach((l) => {
      outV.set(l.source, (outV.get(l.source) ?? 0) + l.value);
      inV.set(l.target, (inV.get(l.target) ?? 0) + l.value);
    });

    // Column = longest path from a source node.
    const col = new Map<string, number>();
    nodes.forEach((nd) => col.set(nd.id, 0));
    for (let i = 0; i < nodes.length; i += 1) {
      links.forEach((l) => {
        const c = (col.get(l.source) ?? 0) + 1;
        if (c > (col.get(l.target) ?? 0)) col.set(l.target, c);
      });
    }
    const cols = Math.max(0, ...[...col.values()]) + 1;
    const byCol: SankeyNode[][] = Array.from({ length: cols }, () => []);
    nodes.forEach((nd) => byCol[col.get(nd.id) ?? 0].push(nd));

    const valueOf = (id: string) => Math.max(inV.get(id) ?? 0, outV.get(id) ?? 0);
    const tallest = Math.max(1, ...byCol.map((c) => c.length));
    const height = Math.max(380, tallest * 64);
    const ky = Math.min(...byCol.map((c) => {
      const v = c.reduce((a, nd) => a + valueOf(nd.id), 0);
      // Client 22-10-2026: keep 30px top + bottom so the first / last label pill is never cut off.
      return v > 0 ? (height - 60 - PAD * (c.length - 1)) / v : Infinity;
    }).filter((x) => Number.isFinite(x)), 1e9);

    const innerW = VIEW_W - MARGIN_L - MARGIN_R;
    const laid = new Map<string, LaidNode>();
    byCol.forEach((c, ci) => {
      const hs = c.map((nd) => Math.max(2, valueOf(nd.id) * ky));
      const used = hs.reduce((a, h) => a + h, 0) + PAD * (c.length - 1);
      let y = Math.max(30, (height - used) / 2);
      c.forEach((nd, i) => {
        laid.set(nd.id, {
          ...nd, col: ci, value: valueOf(nd.id), h: hs[i], y,
          labelW: Math.max(nd.label.length * 7.4, (this.fmt(valueOf(nd.id)) + ' (100.0%)').length * 6.6),
          x: MARGIN_L + (cols > 1 ? (ci * (innerW - NODE_W)) / (cols - 1) : 0),
          color: nd.color || '#94a3b8',
        });
        y += hs[i] + PAD;
      });
    });

    // Ribbons: stack outgoing by target y, incoming by source y.
    const outOff = new Map<string, number>();
    const inOff = new Map<string, number>();
    const sorted = links.slice().sort((a, b) =>
      (laid.get(a.source)!.y - laid.get(b.source)!.y) || (laid.get(a.target)!.y - laid.get(b.target)!.y));
    const outOrder = links.slice().sort((a, b) => laid.get(a.target)!.y - laid.get(b.target)!.y);
    const sy = new Map<SankeyLink, number>();
    outOrder.forEach((l) => {
      const s = laid.get(l.source)!;
      const off = outOff.get(l.source) ?? 0;
      sy.set(l, s.y + off);
      outOff.set(l.source, off + l.value * ky);
    });
    const out: LaidLink[] = sorted.map((l) => {
      const s = laid.get(l.source)!;
      const t = laid.get(l.target)!;
      const w = Math.max(1, l.value * ky);
      const y0 = sy.get(l)!;
      const toff = inOff.get(l.target) ?? 0;
      const y1 = t.y + toff;
      inOff.set(l.target, toff + l.value * ky);
      const x0 = s.x + NODE_W;
      const x1 = t.x;
      const xm = (x0 + x1) / 2;
      return {
        d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + w} C${xm},${y1 + w} ${xm},${y0 + w} ${x0},${y0 + w} Z`,
        color: t.color,
        title: `${s.label} → ${t.label}: ${this.fmt(l.value)}`,
      };
    });

    // Grow the drawing if a label pill would still go past the bottom edge.
    const bottom = Math.max(...[...laid.values()].map((nd) => nd.y + nd.h / 2 + 24));
    return { height: Math.max(height, Math.ceil(bottom + 6)), nodes: [...laid.values()], links: out };
  });
}
