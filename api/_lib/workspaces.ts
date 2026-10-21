import type { DocumentReference, DocumentSnapshot, Transaction, WriteBatch } from 'firebase-admin/firestore';
import type { Invite, Member, Workspace } from '../../shared/types.js';
import { workspaceStoragePrefix } from '../../shared/workspaces.js';
import { bucket, firestore } from './admin.js';
import { fromDoc } from './serialize.js';
import { col } from './store.js';

/** Workspace, member and invite helpers for the management routes (workspaces.ts, members.ts, invites.ts). */

export function workspaceJson(snap: DocumentSnapshot): Workspace {
  // `migration` is bookkeeping of scripts/migrate-workspaces.ts, not part of the API shape.
  const { migration: _migration, ...ws } = fromDoc<Workspace & { migration?: unknown }>(snap);
  return ws;
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

/** Queues `revoked: true` on every live token of `uid` in `wid`. Returns how many. */
export async function revokeMemberTokens(batch: WriteBatch, wid: string, uid: string): Promise<number> {
  const snap = await col.tokens().where('workspaceId', '==', wid).where('userId', '==', uid).get();
  const live = snap.docs.filter((d) => d.get('revoked') !== true);
  for (const d of live) batch.update(d.ref, { revoked: true });
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
 */
export async function deleteWorkspaceData(wid: string): Promise<void> {
  const wsRef = col.workspaces().doc(wid);
  const ws = await wsRef.get();
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
}
