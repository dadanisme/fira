import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import { badRequest, HttpError } from './http.js';

export interface UploadedFile {
  name: string;
  contentType: string;
  data: Buffer;
}

/** Collects the raw request body. Vercel pre-reads it but replays `data`/`end` events, so this works there too. */
function rawBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
    });
    req.on('end', () => (size > max ? reject(tooLarge(max)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const tooLarge = (max: number) => new HttpError(413, 'payload_too_large', `File exceeds ${max / 1024 / 1024} MB`);

/** Parses `multipart/form-data` and returns the single file in field `field` (at most `maxBytes`). */
export async function readFile(req: IncomingMessage, field: string, maxBytes: number): Promise<UploadedFile> {
  const type = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data/i.test(type)) throw badRequest(`Expected multipart/form-data with a "${field}" file`);
  // Multipart framing adds a little overhead on top of the file itself.
  const body = await rawBody(req, maxBytes + 64 * 1024);

  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes } });
    } catch (err) {
      reject(badRequest(`Invalid multipart body: ${(err as Error).message}`));
      return;
    }
    let file: UploadedFile | undefined;
    let truncated = false;
    bb.on('file', (name, stream, info) => {
      if (name !== field) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => (truncated = true));
      stream.on('end', () => {
        file = {
          name: info.filename || 'file',
          contentType: info.mimeType || 'application/octet-stream',
          data: Buffer.concat(chunks),
        };
      });
    });
    bb.on('error', (err) => reject(badRequest(`Invalid multipart body: ${(err as Error).message}`)));
    bb.on('close', () => {
      if (truncated) reject(tooLarge(maxBytes));
      else if (!file) reject(badRequest(`Missing "${field}" file in multipart body`));
      else resolve(file);
    });
    bb.end(body);
  });
}
