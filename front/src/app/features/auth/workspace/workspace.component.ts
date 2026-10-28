import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/auth/auth.service';
import { SessionStore } from '../../../core/session/session.store';
import { AuthBrandComponent } from '../auth-brand/auth-brand.component';

/** Step 3 of the sign-in journey — pick the role/scope to work under. */
@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [AuthBrandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace.component.html',
  styleUrl: '../auth.css',
})
export class WorkspaceComponent {
  readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  choose(id: string): void {
    const ws = this.session.workspaces().find((w) => w.id === id);

    // Design stage (dev only): just switch and go.
    if (!environment.production && environment.designMode) {
      this.session.selectWorkspace(id);
      void this.router.navigate(['/dashboard']);
      return;
    }

    if (ws?.roleId != null) {
      this.auth.selectRole(ws.roleId).subscribe({
        next: () => void this.router.navigate(['/dashboard']),
        error: () => {
          this.session.selectWorkspace(id);
          void this.router.navigate(['/dashboard']);
        },
      });
    } else {
      this.session.selectWorkspace(id);
      void this.router.navigate(['/dashboard']);
    }
  }
}
