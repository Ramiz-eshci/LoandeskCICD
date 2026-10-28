import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideToastr } from 'ngx-toastr';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { cryptoInterceptor } from './core/crypto/crypto.interceptor';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { uploadProgressInterceptor } from './core/upload/upload-progress.interceptor';
import { CryptoService } from './core/crypto/crypto.service';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),

    // Toast notifications (ngx-toastr) — global config.
    provideAnimations(),
    provideToastr({
      positionClass: 'toast-top-right',
      timeOut: 3500,
      progressBar: true,
      closeButton: true,
      newestOnTop: true,
      preventDuplicates: true,
    }),

    // Interceptor order matters (request flows top->bottom, response bottom->top):
    //   upload (file uploads -> global progress panel; needs the PLAIN body)
    //   crypto (seal body / open response, re-handshake)
    //   auth   (attach Bearer)
    //   error  (401 -> login, rethrow original error)
    provideHttpClient(withXhr(), withInterceptors([uploadProgressInterceptor, cryptoInterceptor, authInterceptor, errorInterceptor])),

    // On boot: learn whether encryption is on, and try a silent refresh so a
    // returning user (httpOnly refresh cookie) lands authenticated.
    provideAppInitializer(async () => {
      const crypto = inject(CryptoService);
      const auth = inject(AuthService);
      try {
        await crypto.probe();
      } catch {
        /* API may be down; app still loads */
      }
      try {
        await firstValueFrom(auth.refresh());
        // Load the current user's roles + permissions so the shell/nav is
        // correctly scoped after a hard refresh (not just authenticated).
        await firstValueFrom(auth.loadMe());
      } catch {
        /* no valid refresh cookie -> stay logged out */
      }
    }),
  ],
};
