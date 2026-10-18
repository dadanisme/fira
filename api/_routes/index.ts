import type { Route } from '../_lib/router.js';
import { meRoutes } from './me.js';
import { tokenRoutes } from './tokens.js';

/** Every API route. Add resource modules (cards, pages, ...) here. */
export const routes: Route[] = [...meRoutes, ...tokenRoutes];
