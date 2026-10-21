import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import type { Invite, Member, Workspace } from '../../shared/types.js';
import { LIMITS, workspaceStoragePrefix } from '../../shared/workspaces.js';
import { bucket, firestore } from './admin.js';
import { coded, notFound, tooManyRequests } from './http.js';
import { fromDoc } from './serialize.js';
import { col } from './store.js';

/** Workspace, member and invite helpers for the management routes (workspaces.ts, members.ts, invites.ts). */

export function workspaceJson(snap: DocumentSnapshot): Workspace {
  // `migration` is bookkeeping of scripts/migrate-workspaces.ts, `deleting`/`deletingAt` of
  // deleteWorkspaceData; neither is part of the API shape.
  const {
    migration: _migration,
    deleting: _deleting,
    deletingAt: _deletingAt,
    ...ws
  } = fromDoc<Workspace & { migration?: unknown; deleting?: unknown; deletingAt?: unknown }>(snap);
  return ws;
}

/**
 * 404 when the workspace doc is missing, 409 `workspace_deleting` once its deletion has started.
 * Called inside the transactions that add to a workspace (invite, accept, token, card, rename,
 * transfer), so they serialize with the `deleting` flag.
 */
export function assertLiveWorkspace(ws: DocumentSnapshot): void {
  if (!ws.exists) throw notFound('Workspace not found');
  if (ws.get('deleting') === true) throw coded(409, 'workspace_deleting', 'This workspace is being deleted');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Checks the server-side invite email limits inside `tx` and records the send. It reads, then
 * writes, so call it after the transaction's other reads. Throws 429:
 * - `too_many_requests`: an email went to `email` from `wid` less than `LIMITS.resendCooldownMs`
 *   ago. Kept in `inviteSends/{sha256(wid + "\n" + email)}`, apart from the invite, so revoking and
 *   re-inviting does not reset it.
 * - `invite_limit`: `inviterUid` already sent `LIMITS.inviteSendsPerDay` invite emails this UTC day
 *   (`inviteQuotas/{uid}`: `{ day, count }`), across all workspaces.
 */
export async function reserveInviteSend(tx: Transaction, wid: string, email: string, inviterUid: string): Promise<void> {
  const now = Date.now();
  const sendRef = col.inviteSends().doc(sha256(`${wid}\n${email}`));
  const quotaRef = col.inviteQuotas().doc(inviterUid);
  const [send, quota] = await tx.getAll(sendRef, quotaRef);
  const last = send.get('lastSentAt') as Timestamp | undefined;
  if (last && now - last.toMillis() < LIMITS.resendCooldownMs) {
    throw tooManyRequests('An invite was just emailed to this address; try again in a minute');
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const count = quota.get('day') === day ? ((quota.get('count') as number | undefined) ?? 0) : 0;
  if (count >= LIMITS.inviteSendsPerDay) {
    throw coded(429, 'invite_limit', `You can send at most ${LIMITS.inviteSendsPerDay} invite emails a day; try again tomorrow`);
  }
  tx.set(sendRef, { lastSentAt: Timestamp.fromMillis(now) });
  tx.set(quotaRef, { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
}

export const memberJson = (snap: DocumentSnapshot): Member => fromDoc<Member>(snap);
export const inviteJson = (snap: DocumentSnapshot): Invite => fromDoc<Invite>(snap);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The lowercased, trimmed email when it looks like one, else null. Invites match exactly this form. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/**
 * Seats in use: members + pending invites. Counted in the transaction without a stored counter, so
 * two exactly simultaneous invites could exceed the limit by one (acceptable at this scale).
 */
export async function countSeats(tx: Transaction, wid: string): Promise<number> {
  const [members, invites] = await Promise.all([tx.get(col.members(wid).count()), tx.get(col.invites(wid).count())]);
  return members.data().count + invites.data().count;
}

/** Workspaces `uid` owns. */
export async function countOwned(tx: Transaction, uid: string): Promise<number> {
  return (await tx.get(col.workspaces().where('ownerUid', '==', uid).count())).data().count;
}

/**
 * Reads `uid`'s tokens in `wid` through `tx` and queues `revoked: true` on the live ones (call it
 * after the transaction's other reads). Returns how many. Best effort for tokens created
 * concurrently: tokenAuth also rejects tokens older than the member's current `joinedAt`.
 */
export async function revokeMemberTokens(tx: Transaction, wid: string, uid: string): Promise<number> {
  const snap = await tx.get(col.tokens().where('workspaceId', '==', wid).where('userId', '==', uid));
  const live = snap.docs.filter((d) => d.get('revoked') !== true);
  for (const d of live) tx.update(d.ref, { revoked: true });
  return live.length;
}

/** Deletes `refs` in batches of 500. */
async function deleteAll(refs: readonly DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 500) {
    const batch = firestore().batch();
    for (const ref of refs.slice(i, i + 500)) batch.delete(ref);
    await batch.commit();
  }
}

/** Collections under a workspace that `deleteWorkspaceData` removes recursively (members go separately). */
const CONTENT_COLLECTIONS = ['projects', 'labels', 'cards', 'pages', 'invites'] as const;

/**
 * Hard-deletes a workspace and everything it owns. Ordered so that a run cut short (function
 * timeout) can simply be retried by the owner: their member doc, which authorizes the retry, and
 * the workspace doc, which holds the slug the retry confirms, go last.
 *
 * First it sets `deleting: true` on the workspace doc. From then on the API refuses to add to it
 * (invites, accepts, tokens, API-token requests, card creation, rename, transfer: 409
 * `workspace_deleting`) and the rules deny content writes, so nothing new appears behind the sweep.
 */
export async function deleteWorkspaceData(wid: string): Promise<void> {
  const wsRef = col.workspaces().doc(wid);
  const ws = await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(wsRef);
    if (snap.exists && snap.get('deleting') !== true) tx.update(wsRef, { deleting: true, deletingAt: FieldValue.serverTimestamp() });
    return snap;
  });
  if (!ws.exists) return;
  const ownerUid = ws.get('ownerUid') as string;
  const slug = ws.get('slug') as string;

  // 1. Storage objects (card attachments, page files).
  await bucket().deleteFiles({ prefix: workspaceStoragePrefix(wid) });
  // 2. Its API tokens.
  await deleteAll((await col.tokens().where('workspaceId', '==', wid).get()).docs.map((d) => d.ref));
  // 3. Content and invites, with all subcollections.
  for (const name of CONTENT_COLLECTIONS) await firestore().recursiveDelete(wsRef.collection(name));
  // 4. Members other than the owner.
  await deleteAll((await col.members(wid).get()).docs.filter((d) => d.id !== ownerUid).map((d) => d.ref));
  // 5. The slug reservation (only if it is still ours).
  const slugRef = col.slugs().doc(slug);
  if ((await slugRef.get()).get('workspaceId') === wid) await slugRef.delete();
  // 6. The workspace and its owner's membership, together.
  const batch = firestore().batch();
  batch.delete(col.members(wid).doc(ownerUid));
  batch.delete(wsRef);
  await batch.commit();
  // 7. Anything a request that was already past its checks wrote during the sweep.
  await firestore().recursiveDelete(wsRef);
}
