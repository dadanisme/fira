import { FieldValue as Fv, Timestamp } from 'firebase-admin/firestore';
import { isWorkspaceSlug, LIMITS, normalizeWorkspaceName } from '../../shared/workspaces.js';
import { firestore } from '../_lib/admin.js';
import { requireRole } from '../_lib/auth.js';
import { badRequest, coded, created, jsonBody, noContent, notFound, unprocessable } from '../_lib/http.js';
import { route } from '../_lib/router.js';
import { col } from '../_lib/store.js';
import { onlyKeys, optString } from '../_lib/validate.js';
import { countOwned, deleteWorkspaceData, workspaceJson } from '../_lib/workspaces.js';

function readName(body: Record<string, unknown>): string | undefined {
  const raw = optString(body, 'name');
  if (raw === undefined) return undefined;
  const name = normalizeWorkspaceName(raw);
  if (name === null) throw unprocessable(`name must be 1–${LIMITS.workspaceName} characters`);
  return name;
}

function readSlug(body: Record<string, unknown>): string | undefined {
  const raw = optString(body, 'slug');
  if (raw === undefined) return undefined;
  const slug = raw.trim().toLowerCase();
  if (!isWorkspaceSlug(slug)) {
    throw unprocessable(
      'slug must be 3–32 characters: lowercase letters, digits and single hyphens, starting with a letter and not ending with a hyphen (some words are reserved)',
    );
  }
  return slug;
}

const slugTaken = (slug: string) => coded(409, 'slug_taken', `The slug "${slug}" is taken`);
const workspaceLimit = (who: string) => coded(422, 'workspace_limit', `${who} at most ${LIMITS.ownedWorkspaces} workspaces`);

export const workspaceRoutes = [
  route('POST', '/workspaces', 'user', async ({ req, user }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['name', 'slug']);
    const name = readName(body);
    const slug = readSlug(body);
    if (name === undefined || slug === undefined) throw badRequest('name and slug are required');

    const wsRef = col.workspaces().doc();
    const slugRef = col.slugs().doc(slug);
    await firestore().runTransaction(async (tx) => {
      if ((await tx.get(slugRef)).exists) throw slugTaken(slug);
      if ((await countOwned(tx, user.uid)) >= LIMITS.ownedWorkspaces) throw workspaceLimit('You can own');
      tx.create(wsRef, { name, slug, ownerUid: user.uid, createdBy: user.uid, createdAt: Fv.serverTimestamp() });
      tx.create(slugRef, { workspaceId: wsRef.id });
      tx.create(col.members(wsRef.id).doc(user.uid), {
        uid: user.uid,
        email: user.email,
        name: user.name,
        photoURL: user.photoURL,
        role: 'owner',
        joinedAt: Fv.serverTimestamp(),
        lastSignInAt: Timestamp.fromDate(user.authTime),
        workspaceName: name,
        workspaceSlug: slug,
      });
    });
    return created(workspaceJson(await wsRef.get()));
  }),

  route('PATCH', '/workspaces/:wid', 'member', async ({ req, member, workspaceId: wid }) => {
    requireRole(member, 'owner');
    const body = jsonBody(req);
    onlyKeys(body, ['name', 'slug']);
    const name = readName(body);
    const slug = readSlug(body);
    const wsRef = col.workspaces().doc(wid);

    await firestore().runTransaction(async (tx) => {
      const ws = await tx.get(wsRef);
      if (!ws.exists) throw notFound('Workspace not found');
      const current = workspaceJson(ws);
      const nextName = name ?? current.name;
      const nextSlug = slug ?? current.slug;
      if (nextName === current.name && nextSlug === current.slug) return;
      const newSlugRef = col.slugs().doc(nextSlug);
      if (nextSlug !== current.slug && (await tx.get(newSlugRef)).exists) throw slugTaken(nextSlug);
      // All reads before any write. ≤ 50 members + invites, so this stays far below 500 writes.
      const [members, invites] = await Promise.all([tx.get(col.members(wid)), tx.get(col.invites(wid))]);

      tx.update(wsRef, { name: nextName, slug: nextSlug });
      if (nextSlug !== current.slug) {
        tx.delete(col.slugs().doc(current.slug));
        tx.create(newSlugRef, { workspaceId: wid });
      }
      for (const m of members.docs) tx.update(m.ref, { workspaceName: nextName, workspaceSlug: nextSlug });
      if (nextName !== current.name) for (const i of invites.docs) tx.update(i.ref, { workspaceName: nextName });
    });
    return workspaceJson(await wsRef.get());
  }),

  route('DELETE', '/workspaces/:wid', 'member', async ({ req, member, workspaceId: wid }) => {
    requireRole(member, 'owner');
    const body = jsonBody(req);
    onlyKeys(body, ['confirm']);
    const confirm = optString(body, 'confirm');
    const ws = await col.workspaces().doc(wid).get();
    if (!ws.exists) throw notFound('Workspace not found');
    if (confirm !== ws.get('slug')) throw unprocessable("confirm must be the workspace's current slug");
    await deleteWorkspaceData(wid);
    return noContent();
  }),

  route('POST', '/workspaces/:wid/transfer', 'member', async ({ req, member, workspaceId: wid }) => {
    requireRole(member, 'owner');
    const body = jsonBody(req);
    onlyKeys(body, ['uid']);
    const uid = optString(body, 'uid');
    if (!uid) throw badRequest('uid (the member who becomes owner) is required');
    if (uid === member.uid) throw unprocessable('You already own this workspace');
    const wsRef = col.workspaces().doc(wid);
    const targetRef = col.members(wid).doc(uid);

    await firestore().runTransaction(async (tx) => {
      const [ws, target] = await Promise.all([tx.get(wsRef), tx.get(targetRef)]);
      if (!ws.exists) throw notFound('Workspace not found');
      if (!target.exists) throw notFound('Member not found');
      if (ws.get('ownerUid') !== member.uid) throw coded(403, 'forbidden', 'Only the workspace owner can do this');
      if ((await countOwned(tx, uid)) >= LIMITS.ownedWorkspaces) throw workspaceLimit('The new owner already owns');
      tx.update(wsRef, { ownerUid: uid });
      tx.update(targetRef, { role: 'owner' });
      tx.update(col.members(wid).doc(member.uid), { role: 'admin' });
    });
    return workspaceJson(await wsRef.get());
  }),
];
