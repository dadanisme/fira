import { FieldValue, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import type { CreateTokenResult } from '../../shared/api.js';
import { LABEL_COLORS, type LabelColor } from '../../shared/types.js';
import { colorFor } from '../../shared/labels.js';
import { isAdminRole } from '../../shared/workspaces.js';
import { generateSecret, hashSecret } from '../_lib/auth.js';
import { created, jsonBody, notFound, unprocessable } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { tokenJson } from '../_lib/serialize.js';
import { col } from '../_lib/store.js';
import { firestore } from '../_lib/admin.js';
import { assertLiveWorkspace } from '../_lib/workspaces.js';

const millis = (d: DocumentSnapshot) => (d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;

/**
 * Token management for one workspace (Settings → API tokens), by a member's Firebase ID token.
 * Members see and revoke their own tokens there; admins and the owner see and revoke all of them.
 */
export const tokenRoutes = [
  route('GET', '/workspaces/:wid/tokens', 'member', async ({ query, member, workspaceId: wid }) => {
    let q = col.tokens().where('workspaceId', '==', wid);
    if (!isAdminRole(member.role)) q = q.where('userId', '==', member.uid);
    // Sorted in memory: equality + orderBy on another field would need a composite index.
    const docs = (await q.get()).docs.sort((a, b) => millis(b) - millis(a));
    return paginate(docs.map(tokenJson), query);
  }),

  route('POST', '/workspaces/:wid/tokens', 'member', async ({ req, member, workspaceId: wid }) => {
    const body = jsonBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 40) throw unprocessable('name is required (1–40 characters)');
    if (body.color !== undefined && !LABEL_COLORS.includes(body.color as LabelColor)) {
      throw unprocessable(`color must be one of ${LABEL_COLORS.join(', ')}`);
    }
    const secret = generateSecret();
    const ref = col.tokens().doc();
    const wsRef = col.workspaces().doc(wid);
    await firestore().runTransaction(async (tx) => {
      // A token made after the deletion swept the tokens would outlive the workspace.
      assertLiveWorkspace(await tx.get(wsRef));
      tx.create(ref, {
        workspaceId: wid,
        name,
        color: (body.color as LabelColor | undefined) ?? colorFor(name),
        hash: hashSecret(secret),
        prefix: secret.slice(0, 8),
        createdAt: FieldValue.serverTimestamp(),
        revoked: false,
        userId: member.uid,
        userEmail: member.email,
        userName: member.name,
      });
    });
    const result: CreateTokenResult = { token: tokenJson(await ref.get()), secret };
    return created(result);
  }),

  route('DELETE', '/workspaces/:wid/tokens/:tid', 'member', async ({ params, member, workspaceId: wid }) => {
    const ref = col.tokens().doc(params.tid);
    const snap = await ref.get();
    // Tokens of other workspaces, and other members' tokens for non-admins, are reported as missing.
    const visible = snap.exists && snap.get('workspaceId') === wid && (isAdminRole(member.role) || snap.get('userId') === member.uid);
    if (!visible) throw notFound('Token not found');
    await ref.update({ revoked: true });
    return tokenJson(await ref.get());
  }),
];
