/** Workspace rules and paths shared by the SPA and the API (pure; see SPEC.md "Workspaces"). */
import type { WorkspaceRole } from './types.js';

export const LIMITS = {
  /** Workspaces one user may own (transfers count for the receiver). */
  ownedWorkspaces: 3,
  /** Per workspace: members + pending invites. */
  seats: 50,
  /** Per Storage object; enforced by storage.rules, pre-checked by the SPA. */
  fileBytes: 10 * 1024 * 1024,
  /** API uploads (Vercel's request body limit is 4.5 MB). */
  apiUploadBytes: 4 * 1024 * 1024,
  /** Max workspace name length. */
  workspaceName: 60,
  /** Minimum time between two sends of the same invite. */
  resendCooldownMs: 60_000,
} as const;

/** 3–32 chars: starts with a-z, ends with a-z0-9, a-z0-9 and single hyphens inside. */
export const WORKSPACE_SLUG_RE = /^[a-z](?:[a-z0-9]|-(?!-)){1,30}[a-z0-9]$/;

/** Slugs that would clash with app routes or look official. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'w',
  'workspaces',
  'docs',
  'settings',
  'new',
  'admin',
  'app',
  'www',
  'assets',
  'static',
  'login',
  'signin',
  'invite',
  'invites',
]);

/** A valid, non-reserved workspace slug (it may still be taken). */
export function isWorkspaceSlug(slug: string): boolean {
  return WORKSPACE_SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Slug suggestion for a workspace name ("Ramdan's Team" → `ramdan-s-team`); may still be invalid or taken. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** The trimmed name when it is 1–60 characters, else null. */
export function normalizeWorkspaceName(name: string): string | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= LIMITS.workspaceName ? trimmed : null;
}

export const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/** Owner or admin. */
export function isAdminRole(role: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.admin;
}

/** Whether `actor` may change the role of / remove `target` (never the owner; admin+ only). */
export function canManageMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return isAdminRole(actor) && target !== 'owner';
}

/** SPA path inside a workspace: wsPath('ramdan', '/p/NI') → '/w/ramdan/p/NI'; wsPath('ramdan') → '/w/ramdan'. */
export function wsPath(slug: string, path = ''): string {
  const rest = !path || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  return `/w/${slug}${rest}`;
}

/** Storage prefix of everything a workspace stores: `workspaces/{wid}/`. */
export function workspaceStoragePrefix(wid: string): string {
  return `workspaces/${wid}/`;
}

/** `workspaces/{wid}/cards/{cardId}/{attachmentId}/{name}`. */
export function cardAttachmentPath(wid: string, cardId: string, attachmentId: string, name: string): string {
  return `${workspaceStoragePrefix(wid)}cards/${cardId}/${attachmentId}/${name}`;
}

/** `workspaces/{wid}/pages/{pageId}/{attachmentId}/{name}`. */
export function pageAttachmentPath(wid: string, pageId: string, attachmentId: string, name: string): string {
  return `${workspaceStoragePrefix(wid)}pages/${pageId}/${attachmentId}/${name}`;
}
