import { Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { ApiToken } from '../../shared/types.js';

/** Recursively converts Firestore Timestamps to ISO strings (JSON-safe API values). */
export function toJson(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  }
  return value;
}

/**
 * A document as its shared/types.ts shape: data with ISO timestamps plus `id`.
 * The cast is trusted: documents are only written by the SPA and this API.
 */
export function fromDoc<T extends { id: string }>(snap: DocumentSnapshot): T {
  if (!snap.exists) throw new Error(`Document ${snap.ref.path} does not exist`);
  return { ...(toJson(snap.data()) as object), id: snap.id } as T;
}

/** A token without its secret hash. */
export function tokenJson(snap: DocumentSnapshot): ApiToken {
  const { hash: _hash, ...token } = fromDoc<ApiToken & { hash: string }>(snap);
  return token;
}
