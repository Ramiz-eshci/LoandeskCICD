import { Component, ChangeDetectionStrategy, computed } from '@angular/core';

import { UiButtonDirective } from '../../../shared/ui/ui-button/ui-button.directive';
import { UiPageHeaderComponent } from '../../../shared/ui/ui-page-header/ui-page-header.component';
import { TASKS, TASK_BUCKETS } from './tasks.data';
import { TaskBucket, WorkTask } from './task.model';

/** My Tasks — the personal action queue as an overdue / today / upcoming board. */
@Component({
  selector: 'app-tasks-list',
  standalone: true,
  imports: [UiButtonDirective, UiPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tasks-list.component.html',
  styleUrl: './tasks-list.component.scss',
})
export class TasksListComponent {
  readonly rows = TASKS;

  readonly columns = computed(() =>
    TASK_BUCKETS.map((b) => ({
      key: b.key as TaskBucket,
      label: b.label,
      tasks: this.rows.filter((t) => t.bucket === b.key) as WorkTask[],
    })),
  );

  readonly subtitle = computed(() => `${this.rows.length} tasks`);
}
