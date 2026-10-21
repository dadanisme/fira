import { wsPath } from '@shared/workspaces';
import { currentWorkspace } from '../../data/workspace';

/** Workspace sections; an un-prefixed link to one (`/d/<id>`, `/p/NI/NI-12`) means "in this workspace". */
const WORKSPACE_SECTION = /^\/(?:d|p|trash|settings)(?=[/?#]|$)/;
/** Other routes of the app (anything else under `/`, such as `/api/...`, is not an app page). */
const APP_ROUTE = /^\/(?:w|workspaces)(?=[/?#]|$)|^\/(?=[?#]|$)/;

/** The active workspace's slug, or null outside a workspace. */
export function activeSlug(): string | null {
  try {
    return currentWorkspace().slug;
  } catch {
    return null;
  }
}

/** The app's public origins; absolute links on any of them stay in the app. */
const APP_ORIGINS = ['https://fira.muhammadramdan.com', 'https://fira-six.vercel.app'];

/**
 * The in-app path a Markdown link points to, or null when it leaves the app (other sites,
 * `mailto:`, `/api/...`). In-app links are root-relative paths or absolute URLs on this
 * origin. Workspace-relative ones (`/d/<id>`, `/p/NI/NI-12`, as agents and older pages
 * write them) resolve within the active workspace; `/w/<slug>/...` stays as it is.
 * Render/click time only: the stored Markdown keeps its href.
 */
export function inAppPath(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const raw = href.trim();
  if (!raw || raw.startsWith('//')) return null;
  let path = raw;
  if (!raw.startsWith('/')) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.origin !== window.location.origin && !APP_ORIGINS.includes(url.origin)) return null;
    path = url.pathname + url.search + url.hash;
  }
  if (WORKSPACE_SECTION.test(path)) {
    const slug = activeSlug();
    return slug ? wsPath(slug, path) : null;
  }
  return APP_ROUTE.test(path) ? path : null;
}
