import { createContext, useCallback, useContext } from 'react';
import type { Membership, WorkspaceRole } from '@shared/types';
import { isAdminRole, wsPath } from '@shared/workspaces';

/**
 * The active workspace. Hooks read it from React context (`useWorkspaceId()`, a memo
 * dependency, so switching resubscribes); mutations and editor plugins read the
 * module-level copy (`currentWorkspaceId()`), the same pattern as `currentActor()`.
 * Both are set by `WorkspaceRoute` (src/app/WorkspaceRoute.tsx), whose subtree is keyed by
 * workspace id, so a switch remounts everything below it.
 */
export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  /** The signed-in user's member doc in this workspace. */
  member: Membership;
}

export const WorkspaceContext = createContext<ActiveWorkspace | null>(null);

/** localStorage key holding the last-used workspace id (this device). */
export const LAST_WORKSPACE_KEY = 'fira:last-workspace';

/** The active workspace; throws outside `WorkspaceRoute`. */
export function useWorkspace(): ActiveWorkspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace must be used below WorkspaceRoute');
  return ws;
}

export function useWorkspaceId(): string {
  return useWorkspace().id;
}

/** Whether the signed-in user is an owner or admin of the active workspace. */
export function useIsAdmin(): boolean {
  return isAdminRole(useWorkspace().role);
}

/** `wsPath` bound to the active workspace: `useWsPath()('/p/NI')` → `/w/<slug>/p/NI`. */
export function useWsPath(): (path?: string) => string {
  const { slug } = useWorkspace();
  return useCallback((path?: string) => wsPath(slug, path), [slug]);
}

let active: ActiveWorkspace | null = null;

/** Non-React access (mutations, editor plugins); throws when no workspace is active. */
export function currentWorkspace(): ActiveWorkspace {
  if (!active) throw new Error('No active workspace');
  return active;
}

export function currentWorkspaceId(): string {
  return currentWorkspace().id;
}

/** WorkspaceRoute only. */
export function setActiveWorkspace(ws: ActiveWorkspace | null): void {
  active = ws;
}

/** WorkspaceRoute only: clears the active workspace if it is still `ws` (a switch already replaced it otherwise). */
export function clearActiveWorkspace(ws: ActiveWorkspace): void {
  if (active === ws) active = null;
}

/** The last-used workspace id on this device, or null (storage may be unavailable). */
export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function writeLastWorkspace(wid: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, wid);
  } catch {
    // Private mode or blocked storage: remembering is a convenience.
  }
}
