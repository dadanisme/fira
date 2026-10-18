import { openapi } from '../_lib/openapi.js';
import { route } from '../_lib/router.js';

export const openapiRoutes = [route('GET', '/openapi.json', 'public', async () => openapi)];
