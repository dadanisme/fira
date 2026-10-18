import { createHash } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Actor } from '../../shared/types.js';
import { randomId } from '../../shared/ids.js';
import { adminAuth, firestore } from './admin.js';
import { forbidden, unauthorized } from './http.js';

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

/** Authenticates an API token (`Bearer fira_...`) and returns it as the Actor. Updates `lastUsedAt` (throttled). */
export async function tokenActor(req: VercelRequest): Promise<Actor> {
  const secret = bearer(req);
  if (!SECRET_RE.test(secret)) throw unauthorized('Invalid API token');
  const found = await firestore().collection('tokens').where('hash', '==', hashSecret(secret)).limit(1).get();
  const doc = found.docs[0];
  if (!doc || doc.get('revoked') === true) throw unauthorized('Invalid or revoked API token');

  const lastUsedAt = doc.get('lastUsedAt') as Timestamp | undefined;
  if (!lastUsedAt || Date.now() - lastUsedAt.toMillis() > LAST_USED_THROTTLE_MS) {
    await doc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() });
  }
  return { type: 'token', id: doc.id, name: doc.get('name') as string };
}

/** Authenticates the owner by Firebase ID token (`Bearer <idToken>`), for token management. */
export async function ownerActor(req: VercelRequest): Promise<Actor> {
  const owner = process.env.OWNER_EMAIL;
  if (!owner) throw new Error('OWNER_EMAIL is not set');
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(bearer(req));
  } catch {
    throw unauthorized('Invalid Firebase ID token');
  }
  if (decoded.email?.toLowerCase() !== owner.toLowerCase() || !decoded.email_verified) throw forbidden('Owner only');
  return { type: 'user', id: decoded.uid, name: (decoded.name as string | undefined) ?? decoded.email };
}
