import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { HeaderComponent } from './header/header.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { UiUploadProgressComponent } from '../../shared/ui/ui-upload-progress/ui-upload-progress.component';

/** Authenticated shell: fixed sidebar + sticky header + routed page content. */
@Component({
  selector: 'app-main',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, UiUploadProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main.component.html',
})
export class MainComponent {}
