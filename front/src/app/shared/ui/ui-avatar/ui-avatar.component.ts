import { Component, ChangeDetectionStrategy, computed, input } from '@angular/core';

/** Navy avatar with gold initials (header) or gold avatar with navy initials (sidebar). */
export type AvatarTone = 'navy' | 'gold';

@Component({
  selector: 'ui-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-avatar.component.html',
  styleUrl: './ui-avatar.component.scss',
})
export class UiAvatarComponent {
  readonly name = input.required<string>();
  readonly size = input(34);
  readonly tone = input<AvatarTone>('navy');
  /** Profile picture (data URL / URL); falls back to the initials when empty. */
  readonly src = input<string | null | undefined>(null);

  protected readonly fontSize = computed(() => Math.round(this.size() * 0.38));

  protected readonly initials = computed(() =>
    this.name()
      .split(/[\s&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join(''),
  );
}
