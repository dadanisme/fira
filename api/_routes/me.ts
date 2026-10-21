import type { MeResult } from '../../shared/api.js';
import { notFound } from '../_lib/http.js';
import { route } from '../_lib/router.js';
import { col } from '../_lib/store.js';

export const meRoutes = [
  route('GET', '/me', 'token', async ({ actor, workspaceId }): Promise<MeResult> => {
    const ws = await col.workspaces().doc(workspaceId).get();
    if (!ws.exists) throw notFound('Workspace not found');
    return { ...actor, workspace: { id: ws.id, name: ws.get('name') as string, slug: ws.get('slug') as string } };
  }),
];
