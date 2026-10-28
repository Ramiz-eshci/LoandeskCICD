import { Component, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
})
export class AppComponent {
  /**
   * App-wide guard (client 15-10-2026): an <input type="number"> lets the browser accept
   * "e" / "E" (exponent) and "+" - e.g. "9e" in Years remaining. No numeric field in the app
   * takes scientific notation, so those keys are blocked on every number input. The minus
   * key is left to [numInput] (some underwriter fields allow negatives).
   */
  @HostListener('document:keydown', ['$event'])
  blockExponentKeys(ev: KeyboardEvent): void {
    const t = ev.target as HTMLInputElement | null;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'number') return;
    if (ev.key === 'e' || ev.key === 'E' || ev.key === '+') ev.preventDefault();
  }
}
