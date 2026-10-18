import type { VercelRequest, VercelResponse } from '@vercel/node';

/** An error with an HTTP status, sent as `{ error: { code, message } }`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra members of the `error` object (e.g. `current` for version conflicts). */
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const unauthorized = (message = 'Missing or invalid credentials') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
export const unprocessable = (message: string, details?: Record<string, unknown>) =>
  new HttpError(422, 'unprocessable', message, details);
/** 409 for a stale `version` / `descriptionVersion`; `current` is the resource as it is now. */
export const versionConflict = (message: string, current: unknown) =>
  new HttpError(409, 'version_conflict', message, { current });

/** A response with an explicit status. Handlers return plain values for 200 JSON. */
export class Reply {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body?: unknown) {
    this.status = status;
    this.body = body;
  }
}

export const created = (body: unknown) => new Reply(201, body);
export const noContent = () => new Reply(204);

export function send(res: VercelResponse, result: unknown) {
  const reply = result instanceof Reply ? result : new Reply(200, result);
  if (reply.body === undefined) res.status(reply.status).end();
  else res.status(reply.status).json(reply.body);
}

export function sendError(res: VercelResponse, err: unknown) {
  const error = err instanceof HttpError ? err : new HttpError(500, 'internal', 'Internal error');
  if (!(err instanceof HttpError)) console.error(err);
  res.status(error.status).json({ error: { ...error.details, code: error.code, message: error.message } });
}

/** The parsed JSON object body (Vercel parses `application/json`); `{}` when empty. */
export function jsonBody(req: VercelRequest): Record<string, unknown> {
  let body: unknown;
  try {
    body = req.body;
  } catch {
    throw badRequest('Invalid JSON body');
  }
  if (body === undefined || body === null || body === '') return {};
  if (typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    throw badRequest('Expected a JSON object body (Content-Type: application/json)');
  }
  return body as Record<string, unknown>;
}
