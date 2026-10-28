import { Directive, TemplateRef, inject, input } from '@angular/core';

/**
 * Marks an <ng-template> as the renderer for one column of <ui-data-table>.
 *
 *   <ng-template uiCell="status" let-row>
 *     <ui-badge [status]="row.tone">{{ row.status }}</ui-badge>
 *   </ng-template>
 */
@Directive({
  selector: 'ng-template[uiCell]',
  standalone: true,
})
export class UiCellDirective {
  /** Must match a TableColumn.key. */
  readonly uiCell = input.required<string>();
  readonly template = inject<TemplateRef<{ $implicit: unknown; index: number }>>(TemplateRef);
}
