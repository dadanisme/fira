import { FieldValue, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { LABEL_COLORS, type LabelColor } from '../../shared/types.js';
import { colorFor } from '../../shared/labels.js';
import { firestore } from '../_lib/admin.js';
import { generateSecret, hashSecret, type Member } from '../_lib/auth.js';
import { created, jsonBody, notFound, unprocessable } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { tokenJson } from '../_lib/serialize.js';

const tokens = () => firestore().collection('tokens');
const millis = (d: DocumentSnapshot) => (d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0;

/** Whether `member` may see/revoke this token: the owner sees all, members their own. */
function canManage(member: Member, token: DocumentSnapshot): boolean {
  return member.isOwner || token.get('userEmail') === member.email;
}

/**
 * Token management: Firebase ID token of a member (used by Settings → API tokens).
 * Members manage their own tokens; the owner sees and revokes all (legacy tokens without a creator are the owner's).
 */
export const tokenRoutes = [
  route('GET', '/tokens', 'member', async ({ query, member }) => {
    // Sorted in memory: equality + orderBy on another field would need a composite index.
    const snap = member.isOwner ? await tokens().get() : await tokens().where('userEmail', '==', member.email).get();
    const docs = snap.docs.sort((a, b) => millis(b) - millis(a));
    return paginate(docs.map(tokenJson), query);
  }),

  route('POST', '/tokens', 'member', async ({ req, member }) => {
    const body = jsonBody(req);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 40) throw unprocessable('name is required (1–40 characters)');
    if (body.color !== undefined && !LABEL_COLORS.includes(body.color as LabelColor)) {
      throw unprocessable(`color must be one of ${LABEL_COLORS.join(', ')}`);
    }
    const secret = generateSecret();
    const ref = tokens().doc();
    await ref.set({
      name,
      color: (body.color as LabelColor | undefined) ?? colorFor(name),
      hash: hashSecret(secret),
      prefix: secret.slice(0, 8),
      createdAt: FieldValue.serverTimestamp(),
      revoked: false,
      userEmail: member.email,
      userId: member.actor.id,
      userName: member.actor.name,
    });
    return created({ token: tokenJson(await ref.get()), secret });
  }),

  route('DELETE', '/tokens/:id', 'member', async ({ params, member }) => {
    const ref = tokens().doc(params.id);
    const snap = await ref.get();
    // Other members' tokens are reported as missing rather than forbidden.
    if (!snap.exists || !canManage(member, snap)) throw notFound('Token not found');
    await ref.update({ revoked: true });
    return tokenJson(await ref.get());
  }),
];
