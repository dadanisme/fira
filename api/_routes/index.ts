import type { Route } from '../_lib/router.js';
import { accountRoutes } from './account.js';
import { cardItemRoutes } from './cardItems.js';
import { cardRoutes } from './cards.js';
import { inviteRoutes } from './invites.js';
import { memberRoutes } from './members.js';
import { meRoutes } from './me.js';
import { openapiRoutes } from './openapi.js';
import { pageAttachmentRoutes } from './pageAttachments.js';
import { pageRoutes } from './pages.js';
import { projectRoutes } from './projects.js';
import { tokenRoutes } from './tokens.js';
import { workspaceRoutes } from './workspaces.js';

/** Every API route. Add resource modules (cards, pages, ...) here. */
export const routes: Route[] = [
  ...openapiRoutes,
  ...meRoutes,
  ...workspaceRoutes,
  ...memberRoutes,
  ...inviteRoutes,
  ...accountRoutes,
  ...tokenRoutes,
  ...projectRoutes,
  ...cardRoutes,
  ...cardItemRoutes,
  ...pageRoutes,
  ...pageAttachmentRoutes,
];
