import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Actor } from '../../shared/types.js';
import { memberAuth, tokenAuth, userActor, userAuth, type Caller, type MemberCaller, type TokenCaller } from './auth.js';
import { HttpError, notFound, send, sendError } from './http.js';

/**
 * Minimal router behind the single function `api/index.ts`. vercel.json rewrites
 * `/api/v1/:__route*` to `/api?__route=:__route*`, which keeps the deployment at one
 * function (Hobby plan limit) and avoids relying on catch-all filenames.
 */

/**
 * `token`: API token (`fira_...`), scoped to its workspace. `member`: Firebase ID token of a member
 * of the route's `:wid` (non-members get 404). `user`: Firebase ID token of any verified account.
 * `public`: none.
 */
export type AuthMode = 'token' | 'member' | 'user' | 'public';

export interface RequestContext<A extends AuthMode = AuthMode> {
  req: VercelRequest;
  /** Decoded `:param` segments. */
  params: Record<string, string>;
  /** Query string (repeatable params supported via `getAll`). */
  query: URLSearchParams;
  /** user/member: `{ type: 'user', id: uid, name }`; token: the token (with `via`). */
  actor: A extends 'public' ? null : Actor;
  /** token: the token's workspace; member: `params.wid`. */
  workspaceId: A extends 'token' | 'member' ? string : null;
  /** The caller as a member of `params.wid`, for `member` routes. */
  member: A extends 'member' ? MemberCaller : null;
  /** The signed-in account, for `member` and `user` routes. */
  user: A extends 'member' | 'user' ? Caller : null;
  /** The API token, for `token` routes. */
  token: A extends 'token' ? TokenCaller : null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Route {
  method: Method;
  segments: string[];
  auth: AuthMode;
  handler: (ctx: RequestContext) => Promise<unknown>;
}

/**
 * Declares a route. `pattern` is relative to `/api/v1`, e.g. `/cards/:key/comments`; `member`
 * routes must have a `:wid` segment.
 * The handler returns a JSON-able value (200), or a `Reply` (see http.ts), or throws `HttpError`.
 */
export function route<A extends AuthMode>(
  method: Method,
  pattern: string,
  auth: A,
  handler: (ctx: RequestContext<A>) => Promise<unknown>,
): Route {
  if (auth === 'member' && !pattern.includes('/:wid')) throw new Error(`member route ${pattern} needs a :wid segment`);
  return { method, segments: split(pattern), auth, handler: handler as Route['handler'] };
}

export function createRouter(routes: readonly Route[]) {
  return async (req: VercelRequest, res: VercelResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const routeParam = url.searchParams.get('__route');
      url.searchParams.delete('__route');
      // Rewritten requests carry the path in `__route`; direct hits (e.g. `vercel dev`) keep it in the URL.
      const path = routeParam ?? url.pathname.replace(/^\/api\/v1/, '');
      const segments = split(path);

      const matches = routes.flatMap((r) => {
        const params = match(r.segments, segments);
        return params ? [{ route: r, params }] : [];
      });
      if (matches.length === 0) throw notFound(`No route for ${req.method} /api/v1/${segments.join('/')}`);
      const hit = matches.find((m) => m.route.method === req.method);
      if (!hit) {
        res.setHeader('Allow', [...new Set(matches.map((m) => m.route.method))].join(', '));
        throw new HttpError(405, 'method_not_allowed', `${req.method} not allowed`);
      }

      const { auth } = hit.route;
      const member = auth === 'member' ? await memberAuth(req, hit.params.wid) : null;
      const user = auth === 'user' ? await userAuth(req) : member;
      const token = auth === 'token' ? await tokenAuth(req) : null;
      const ctx: RequestContext = {
        req,
        params: hit.params,
        query: url.searchParams,
        actor: token?.actor ?? (user && userActor(user)),
        workspaceId: token?.workspaceId ?? member?.workspaceId ?? null,
        member,
        user,
        token,
      };
      send(res, await hit.route.handler(ctx));
    } catch (err) {
      sendError(res, err);
    }
  };
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function match(pattern: readonly string[], segments: readonly string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [i, p] of pattern.entries()) {
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segments[i]);
    else if (p !== segments[i]) return null;
  }
  return params;
}
