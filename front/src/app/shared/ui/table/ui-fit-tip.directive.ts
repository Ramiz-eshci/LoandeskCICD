import { Directive, HostListener } from '@angular/core';

/**
 * Client 20-10-2026: put on a <table>. Any cell text cut off with an ellipsis shows its full
 * value as a native tooltip on hover. An element that already has its own title keeps it.
 */
@Directive({ selector: '[uiFitTip]', standalone: true })
export class UiFitTipDirective {
  @HostListener('mouseover', ['$event'])
  onHover(ev: MouseEvent): void {
    let el = ev.target as HTMLElement | null;
    while (el && el.tagName !== 'TABLE') {
      const auto = el.hasAttribute('data-uitip');
      if (!auto && el.title) return; // own tooltip wins
      if (el.scrollWidth > el.clientWidth + 1) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t) { el.title = t; el.setAttribute('data-uitip', '1'); }
        return;
      }
      if (auto) { el.removeAttribute('title'); el.removeAttribute('data-uitip'); }
      if (el.tagName === 'TD' || el.tagName === 'TH') return;
      el = el.parentElement;
    }
  }
}
