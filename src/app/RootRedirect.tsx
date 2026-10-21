import { Navigate } from 'react-router';
import { wsPath } from '@shared/workspaces';
import { useMyMemberships } from '../data/members';
import { readLastWorkspace } from '../data/workspace';
import { useUser } from '../lib/auth';

/** `/`: the last-used workspace on this device (if still a member), else the landing page. */
export function RootRedirect() {
  const user = useUser();
  const { data, loading, fromCache } = useMyMemberships(user.uid);
  const last = readLastWorkspace();
  const target = last ? data.find((m) => m.workspaceId === last) : undefined;
  if (target) return <Navigate to={wsPath(target.workspaceSlug)} replace />;
  // The cache may not have it yet; wait for the server before giving up on it.
  if (loading || (last && fromCache)) return null;
  return <Navigate to="/workspaces" replace />;
}
