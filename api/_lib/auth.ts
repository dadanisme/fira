import { createHash } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Actor, WorkspaceRole } from '../../shared/types.js';
import { randomId } from '../../shared/ids.js';
import { isAdminRole } from '../../shared/workspaces.js';
import { adminAuth, firestore } from './admin.js';
import { forbidden, HttpError, notFound, unauthorized } from './http.js';

const SECRET_RE = /^fira_[0-9A-Za-z]{32}$/;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** A new token secret, `fira_<32 base62>`. Shown once; only its hash is stored. */
export function generateSecret(): string {
  return `fira_${randomId(32)}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function bearer(req: VercelRequest): string {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) throw unauthorized('Missing Authorization: Bearer header');
  return match[1];
}

/** A signed-in Google account (Firebase ID token), member of any workspace or none. */
export interface Caller {
  uid: string;
  /** Lowercased. */
  email: string;
  name: string;
  photoURL?: string;
  /** When the user signed in (`auth_time`). */
  authTime: Date;
}

/** A caller who is a member of `workspaceId`. */
export interface MemberCaller extends Caller {
  workspaceId: string;
  role: WorkspaceRole;
}

/** An API token: its actor (with `via`, its creator) and the workspace it is scoped to. */
export interface TokenCaller {
  actor: Actor;
  workspaceId: string;
  tokenId: string;
  userId: string;
}

/** The actor of a signed-in user (writes made through the app's API calls). */
export function userActor(caller: Caller): Actor {
  return { type: 'user', id: caller.uid, name: caller.name };
}

/** Verifies a Firebase ID token (`Bearer <idToken>`): 401 when invalid, 403 without a verified email. */
export async function userAuth(req: VercelRequest): Promise<Caller> {
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(bearer(req));
  } catch {
    throw unauthorized('Invalid Firebase ID token');
  }
  const email = decoded.email?.trim().toLowerCase();
  if (!email || decoded.email_verified !== true) throw forbidden('A verified email address is required');
  return {
    uid: decoded.uid,
    email,
    name: ((decoded.name as string | undefined) ?? '').trim() || email,
    photoURL: (decoded.picture as string | undefined) || undefined,
    authTime: new Date(decoded.auth_time * 1000),
  };
}

/** `caller` as a member of `workspaceId`; 404 (so workspaces don't leak) when not a member. */
export async function memberOf(caller: Caller, workspaceId: string): Promise<MemberCaller> {
  const snap = await firestore().collection('workspaces').doc(workspaceId).collection('members').doc(caller.uid).get();
  if (!snap.exists) throw notFound('Workspace not found');
  return { ...caller, workspaceId, role: snap.get('role') as WorkspaceRole };
}

/** A Firebase ID token of a member of `workspaceId` (management routes under `/workspaces/:wid`). */
export async function memberAuth(req: VercelRequest, workspaceId: string): Promise<MemberCaller> {
  return memberOf(await userAuth(req), workspaceId);
}

/** 403 unless the member's role is at least `min`. */
export function requireRole(member: MemberCaller, min: 'admin' | 'owner'): void {
  const ok = min === 'owner' ? member.role === 'owner' : isAdminRole(member.role);
  if (!ok) throw forbidden(min === 'owner' ? 'Only the workspace owner can do this' : 'Only workspace admins can do this');
}

/**
 * Authenticates an API token (`Bearer fira_...`). Rejects revoked tokens, tokens without a
 * workspace, and tokens whose creator is no longer a member of it (checked on every request).
 * Updates `lastUsedAt` (throttled).
 */
export async function tokenAuth(req: VercelRequest): Promise<TokenCaller> {
  const secret = bearer(req);
  if (!SECRET_RE.test(secret)) throw unauthorized('Invalid API token');
  const found = await firestore().collection('tokens').where('hash', '==', hashSecret(secret)).limit(1).get();
  const doc = found.docs[0];
  if (!doc || doc.get('revoked') === true) throw unauthorized('Invalid or revoked API token');
  const workspaceId = doc.get('workspaceId') as string | undefined;
  const userId = doc.get('userId') as string | undefined;
  if (!workspaceId || !userId) throw unauthorized('Invalid or revoked API token');
  const wsRef = firestore().collection('workspaces').doc(workspaceId);
  const [member, ws] = await firestore().getAll(wsRef.collection('members').doc(userId), wsRef);
  if (!member.exists) throw unauthorized("The token's creator is no longer a member of its workspace");
  // A token from an earlier membership (created while its creator was being removed, so the
  // revoke missed it) stays dead after a re-invite. Tokens older than the workspace itself are
  // exempt: only scripts/migrate-workspaces.ts makes those, for members it dates to the migration.
  const createdMs = (doc.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;
  const joinedMs = (member.get('joinedAt') as Timestamp | undefined)?.toMillis() ?? 0;
  const wsCreatedMs = (ws.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;
  if (createdMs < joinedMs && createdMs >= wsCreatedMs) {
    throw unauthorized('This token was created before its creator (re)joined the workspace');
  }
  if (ws.get('deleting') === true) throw new HttpError(409, 'workspace_deleting', 'This workspace is being deleted');

  const lastUsedAt = doc.get('lastUsedAt') as Timestamp | undefined;
  if (!lastUsedAt || Date.now() - lastUsedAt.toMillis() > LAST_USED_THROTTLE_MS) {
    await doc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() });
  }
  const viaName = (doc.get('userName') as string | undefined) ?? (member.get('name') as string | undefined) ?? 'Member';
  return {
    actor: { type: 'token', id: doc.id, name: doc.get('name') as string, via: { id: userId, name: viaName } },
    workspaceId,
    tokenId: doc.id,
    userId,
  };
}
