import { createRouter } from './_lib/router.js';
import { routes } from './_routes/index.js';

/** The single Vercel function serving `/api/v1/*` (see vercel.json and _lib/router.ts). */
export default createRouter(routes);
