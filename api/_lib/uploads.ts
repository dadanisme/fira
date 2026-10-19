import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { bucket } from './admin.js';
import { readFile } from './multipart.js';

/** Card and page attachments: one `multipart/form-data` part named `file`, any content type. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Storage object names may not contain path separators from the client file name. */
export function safeName(name: string): string {
  const cleaned = [...name.replace(/[/\\]/g, '_')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim();
  return cleaned.slice(-200) || 'file';
}

export interface StoredUpload {
  name: string;
  size: number;
  contentType: string;
  storagePath: string;
  /** Firebase download-token URL (only with `downloadToken: true`). */
  url?: string;
}

/**
 * Reads the request's `file` part (≤ 4 MB, else 413) and saves it to the default
 * bucket at `pathFor(safeName)`. With `downloadToken`, the object gets a Firebase
 * download token (custom metadata `firebaseStorageDownloadTokens`, like the client
 * SDK's uploads) and the result a non-expiring `url` that bypasses Storage rules.
 */
export async function storeUpload(
  req: IncomingMessage,
  pathFor: (name: string) => string,
  opts: { downloadToken?: boolean } = {},
): Promise<StoredUpload> {
  const file = await readFile(req, 'file', MAX_UPLOAD_BYTES);
  const name = safeName(file.name);
  const storagePath = pathFor(name);
  const token = opts.downloadToken ? randomUUID() : undefined;
  await bucket()
    .file(storagePath)
    .save(file.data, {
      contentType: file.contentType,
      resumable: false,
      ...(token && { metadata: { metadata: { firebaseStorageDownloadTokens: token } } }),
    });
  return {
    name,
    size: file.data.length,
    contentType: file.contentType,
    storagePath,
    ...(token && { url: downloadUrl(storagePath, token) }),
  };
}

/**
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=<uuid>`,
 * the URL `getDownloadURL` returns (the Storage emulator's host when it is in use).
 * The path is fully percent-encoded, parentheses included, so it is safe in Markdown `![alt](url)`.
 */
export function downloadUrl(storagePath: string, token: string): string {
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const origin = emulator ? (/^https?:\/\//.test(emulator) ? emulator : `http://${emulator}`) : 'https://firebasestorage.googleapis.com';
  const path = encodeURIComponent(storagePath).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${origin}/v0/b/${bucket().name}/o/${path}?alt=media&token=${token}`;
}
