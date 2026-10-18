import { FieldValue } from 'firebase-admin/firestore';
import { LABEL_COLORS, type LabelColor } from '../../shared/types.js';
import { colorFor } from '../../shared/labels.js';
import { firestore } from '../_lib/admin.js';
import { generateSecret, hashSecret } from '../_lib/auth.js';
import { created, jsonBody, notFound, unprocessable } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { tokenJson } from '../_lib/serialize.js';

const tokens = () => firestore().collection('tokens');

/** Token management: owner Firebase ID token only (used by Settings → API tokens). */
export const tokenRoutes = [
  route('GET', '/tokens', 'owner', async ({ query }) => {
    const snap = await tokens().orderBy('createdAt', 'desc').get();
    return paginate(snap.docs.map(tokenJson), query);
  }),

  route('POST', '/tokens', 'owner', async ({ req }) => {
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
    });
    return created({ token: tokenJson(await ref.get()), secret });
  }),

  route('DELETE', '/tokens/:id', 'owner', async ({ params }) => {
    const ref = tokens().doc(params.id);
    if (!(await ref.get()).exists) throw notFound('Token not found');
    await ref.update({ revoked: true });
    return tokenJson(await ref.get());
  }),
];
