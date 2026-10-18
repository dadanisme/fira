import { route } from '../_lib/router.js';

export const meRoutes = [route('GET', '/me', 'token', async ({ actor }) => actor)];
