import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Shown when the active role has no permission on a module and the user tries
 * to reach it directly (e.g. by typing the URL). Route-level RBAC only —
 * the backend is the real authority and would reject the API call regardless.
 */
@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-denied.component.html',
  styleUrl: './access-denied.component.scss',
})
export class AccessDeniedComponent {}
