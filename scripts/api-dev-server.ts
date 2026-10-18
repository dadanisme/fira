import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Tiny Node http adapter around the single API function (`api/index.ts`), mimicking
 * the Vercel Node runtime: the body is read up front and replayed to stream readers,
 * `req.body` parses JSON lazily, and `res.status().json()` helpers exist.
 * Used by scripts/api-smoke.ts; run standalone with `tsx scripts/api-dev-server.ts`.
 */

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function replay(req: IncomingMessage, body: Buffer) {
  const copy = new PassThrough();
  const on = copy.on.bind(copy);
  const originalOn = req.on.bind(req);
  req.read = copy.read.bind(copy);
  req.on = req.addListener = ((name: string, cb: (...args: unknown[]) => void) =>
    name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb)) as typeof req.on;
  copy.end(body);
}

function parseBody(body: Buffer, contentType: string | undefined): unknown {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (type === 'application/json') {
    const text = body.toString();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Invalid JSON');
    }
  }
  if (type === 'text/plain') return body.toString();
  if (type === 'application/octet-stream') return body;
  return undefined;
}

export async function startServer(port = 0): Promise<{ server: Server; url: string }> {
  const { default: handler } = (await import('../api/index.js')) as { default: Handler };
  const server = createServer(async (rawReq: IncomingMessage, rawRes: ServerResponse) => {
    const body = rawReq.headers['content-type'] === undefined ? Buffer.alloc(0) : await readBody(rawReq);
    replay(rawReq, body);
    let parsed: { value: unknown } | undefined;
    Object.defineProperty(rawReq, 'body', {
      get: () => (parsed ??= { value: parseBody(body, rawReq.headers['content-type']) }).value,
    });
    const res = rawRes as VercelResponse;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (value: unknown) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(value));
      return res;
    };
    try {
      await handler(rawReq as VercelRequest, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: { code: 'internal', message: 'Adapter error' } });
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { server, url: `http://127.0.0.1:${actualPort}/api/v1` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startServer(Number(process.env.PORT ?? 3100));
  console.log(`fira API listening on ${url}`);
}
