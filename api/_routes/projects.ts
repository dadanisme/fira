import type { Label } from '../../shared/types.js';
import { byRank } from '../../shared/rank.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import { allProjects, col, projectByKey } from '../_lib/store.js';

export const projectRoutes = [
  route('GET', '/projects', 'token', async ({ query, workspaceId }) => {
    const projects = (await allProjects(workspaceId)).sort(byRank);
    return paginate(projects, query);
  }),

  route('GET', '/projects/:key', 'token', async ({ params, workspaceId }) => projectByKey(workspaceId, params.key)),

  route('GET', '/labels', 'token', async ({ query, workspaceId }) => {
    const labels = (await col.labels(workspaceId).get()).docs.map((d) => fromDoc<Label>(d));
    return paginate(
      labels.sort((a, b) => a.name.localeCompare(b.name)),
      query,
    );
  }),
];
