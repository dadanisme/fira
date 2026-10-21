import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import type { Membership } from '@shared/types';
import { wsPath } from '@shared/workspaces';
import { useMyMemberships } from '../data/members';
import {
  clearActiveWorkspace,
  setActiveWorkspace,
  useWsPath,
  WorkspaceContext,
  writeLastWorkspace,
  type ActiveWorkspace,
} from '../data/workspace';
import { useUser } from '../lib/auth';

/** `location.state` of the redirect to `/workspaces` after losing access to a workspace. */
export interface WorkspaceNoticeState {
  notice?: string;
}

/**
 * `/w/:slug/*`: resolves the slug against the user's memberships (cache first, so the
 * workspace renders instantly), makes it the active workspace (context + the module-level
 * copy mutations use) and remembers it as last used. The subtree is keyed by workspace id,
 * so switching remounts everything below.
 *
 * - Unknown slug (or not a member): "Workspace not found".
 * - Membership gone while mounted (removed, workspace deleted): to `/workspaces` with a notice.
 * - Slug renamed while mounted: same place under the new slug.
 */
export function WorkspaceRoute() {
  const { slug = '' } = useParams();
  const user = useUser();
  const memberships = useMyMemberships(user.uid);
  const location = useLocation();
  const navigate = useNavigate();
  const membership = memberships.data.find((m) => m.workspaceSlug === slug);
  const ws = useActiveWorkspace(membership);
  /** The workspace shown last, to tell "lost access" and "renamed" from a mistyped slug. */
  const [shown, setShown] = useState<{ id: string; slug: string; name: string } | null>(null);
  if (ws && (shown?.id !== ws.id || shown.slug !== ws.slug || shown.name !== ws.name)) {
    setShown({ id: ws.id, slug: ws.slug, name: ws.name });
  }

  // Set before the children render, so their first effects and handlers see it.
  if (ws) setActiveWorkspace(ws);
  useLayoutEffect(() => {
    if (!ws) return;
    setActiveWorkspace(ws);
    return () => clearActiveWorkspace(ws);
  }, [ws]);

  const wid = ws?.id;
  useEffect(() => {
    if (wid) writeLastWorkspace(wid);
  }, [wid]);

  const settled = !memberships.loading && !memberships.fromCache;
  // Only while the URL still has the slug we were showing (not after following a link elsewhere).
  const prev = !ws && shown?.slug === slug ? shown : null;
  const renamed = prev ? memberships.data.find((m) => m.workspaceId === prev.id) : undefined;
  const lost = prev !== null && settled && !renamed;

  useEffect(() => {
    if (renamed) {
      const rest = location.pathname.slice(wsPath(slug).length);
      navigate({ pathname: wsPath(renamed.workspaceSlug, rest), search: location.search, hash: location.hash }, { replace: true });
    } else if (lost && prev) {
      const state: WorkspaceNoticeState = { notice: `You no longer have access to ${prev.name}.` };
      navigate('/workspaces', { replace: true, state });
    }
  }, [renamed, lost, prev, slug, location, navigate]);

  if (ws) {
    return (
      <WorkspaceContext key={ws.id} value={ws}>
        <Outlet />
      </WorkspaceContext>
    );
  }
  // Still loading, possibly missing a just-joined workspace (cache), or about to redirect.
  if (!settled || renamed || lost) return null;
  return <WorkspaceNotFound slug={slug} />;
}

/** A stable ActiveWorkspace for a membership: a new object only when a field we expose changes. */
function useActiveWorkspace(m: Membership | undefined): ActiveWorkspace | null {
  const key = m ? [m.workspaceId, m.workspaceSlug, m.workspaceName, m.role, m.name, m.photoURL].join('\u0000') : '';
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` covers every field used
  return useMemo(() => (m ? { id: m.workspaceId, slug: m.workspaceSlug, name: m.workspaceName, role: m.role, member: m } : null), [key]);
}

function WorkspaceNotFound({ slug }: { slug: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-80 space-y-3 text-center">
        <h1 className="text-lg font-semibold">Workspace not found</h1>
        <p className="text-fg-muted">
          There is no workspace <span className="font-mono">{slug}</span>, or you aren't a member of it.
        </p>
        <Link to="/workspaces" className="text-accent hover:underline">
          Your workspaces
        </Link>
      </div>
    </div>
  );
}

/** Unknown paths inside a workspace go to its home. */
export function WorkspaceIndexRedirect() {
  return <Navigate to={useWsPath()()} replace />;
}
