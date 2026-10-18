import type { Label } from '../../shared/types.js';
import { byRank } from '../../shared/rank.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import { allProjects, col, projectByKey } from '../_lib/store.js';

export const projectRoutes = [
  route('GET', '/projects', 'token', async ({ query }) => {
    const projects = (await allProjects()).sort(byRank);
    return paginate(projects, query);
  }),

  route('GET', '/projects/:key', 'token', async ({ params }) => projectByKey(params.key)),

  route('GET', '/labels', 'token', async ({ query }) => {
    const labels = (await col.labels().get()).docs.map((d) => fromDoc<Label>(d));
    return paginate(
      labels.sort((a, b) => a.name.localeCompare(b.name)),
      query,
    );
  }),
];
