import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { TokenStore } from './token.store';

/**
 * Blocks a route unless an access token is present; redirects to /login otherwise.
 *
 * While `environment.designMode` is on (development builds only) the guard lets
 * everything through so the screens can be reviewed without a live API. The
 * production environment hard-codes designMode:false, so the guard always
 * enforces authentication in a production build.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const tokens = inject(TokenStore);
  const router = inject(Router);

  if (!environment.production && environment.designMode) return true;
  if (tokens.isAuthenticated()) return true;

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
