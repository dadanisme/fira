import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS, RESERVED_SLUGS, WORKSPACE_SLUG_RE, normalizeWorkspaceName, wsPath } from '@shared/workspaces';
import { useMyMemberships } from '../data/members';

/** Why a workspace name can't be used, or null. */
export function nameProblem(name: string): string | null {
  if (normalizeWorkspaceName(name) !== null) return null;
  return name.trim() ? `Name: at most ${LIMITS.workspaceName} characters` : 'Enter a name';
}

/** Why a slug can't be used (format or reserved; "taken" only the server knows), or null. */
export function slugProblem(slug: string): string | null {
  if (!slug) return 'Enter a slug';
  if (slug.length < 3 || slug.length > 32) return 'Slug: 3–32 characters';
  if (!/^[a-z]/.test(slug)) return 'Slug: start with a letter';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug: lowercase letters, digits and hyphens only';
  if (!WORKSPACE_SLUG_RE.test(slug)) return 'Slug: no hyphen at the end or two in a row';
  if (RESERVED_SLUGS.has(slug)) return `“${slug}” is reserved`;
  return null;
}

/** Keeps what the user types inside the slug alphabet. */
export const cleanSlug = (s: string) => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

/**
 * Navigates into a workspace the user just created or joined, once it shows up in their
 * memberships (WorkspaceRoute resolves slugs from them, so going earlier would flash
 * "Workspace not found"). Falls back to navigating after a few seconds.
 */
export function useEnterWorkspace(uid: string): (target: { id: string; slug: string }) => void {
  const navigate = useNavigate();
  const { data } = useMyMemberships(uid);
  const [target, setTarget] = useState<{ id: string; slug: string } | null>(null);
  const arrived = target ? data.find((m) => m.workspaceId === target.id) : undefined;

  useEffect(() => {
    if (!target) return;
    if (arrived) {
      navigate(wsPath(arrived.workspaceSlug));
      return;
    }
    const t = setTimeout(() => navigate(wsPath(target.slug)), 4000);
    return () => clearTimeout(t);
  }, [target, arrived, navigate]);

  return setTarget;
}
