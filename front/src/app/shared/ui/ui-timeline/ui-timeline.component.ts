import { Component, ChangeDetectionStrategy, input } from '@angular/core';

export interface TimelineEntry {
  title: string;
  meta?: string;
  detail?: string;
}

/** Vertical activity trail with accent dots. */
@Component({
  selector: 'ui-timeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-timeline.component.html',
  styleUrl: './ui-timeline.component.scss',
})
export class UiTimelineComponent {
  readonly items = input.required<TimelineEntry[]>();
}
