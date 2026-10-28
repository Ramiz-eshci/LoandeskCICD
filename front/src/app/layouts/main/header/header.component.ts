import { Component, ChangeDetectionStrategy, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, of, interval, startWith, switchMap } from 'rxjs';

import { AuthService } from '../../../core/auth/auth.service';
import { SessionStore } from '../../../core/session/session.store';
import { NotificationsService, AppNotification } from '../../../features/notifications/notifications.service';
import { UiAvatarComponent } from '../../../shared/ui/ui-avatar/ui-avatar.component';

/** Sticky 56px top bar: global search, workspace context chips, utilities, account menu. */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, UiAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent implements OnInit {
  readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notif = inject(NotificationsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);
  readonly loading = signal(false);

  ngOnInit(): void {
    // Poll the unread count every 60s (and once immediately). Silent on error (e.g. design mode / not logged in).
    interval(60000)
      .pipe(
        startWith(0),
        switchMap(() => this.notif.unreadCount().pipe(catchError(() => of(this.unread())))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((n) => this.unread.set(n));
  }

  /** Load the feed when the bell is opened. */
  onOpen(): void {
    this.loading.set(true);
    this.notif.list(30)
      .pipe(catchError(() => of([] as AppNotification[])), takeUntilDestroyed(this.destroyRef))
      .subscribe((rows) => {
        this.items.set(rows);
        this.unread.set(rows.filter((r) => !r.is_read).length);
        this.loading.set(false);
      });
  }

  open(n: AppNotification): void {
    if (!n.is_read) {
      this.notif.markRead(n.notification_id).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe();
      this.items.update((list) => list.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: 1 } : x)));
      this.unread.update((u) => Math.max(0, u - 1));
    }
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  markAll(ev: Event): void {
    ev.stopPropagation();
    this.notif.markAllRead().pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef)).subscribe();
    this.items.update((list) => list.map((x) => ({ ...x, is_read: 1 })));
    this.unread.set(0);
  }

  ago(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  switchWorkspace(): void {
    void this.router.navigate(['/workspace']);
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
