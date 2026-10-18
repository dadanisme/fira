import { isDateString } from '../../shared/fields.js';
import { badRequest, unprocessable } from './http.js';

/**
 * Body/query field readers. Wrong JSON types are 400 (`bad_request`); well-typed but
 * semantically invalid values (unknown status, bad option, ...) are 422 (`unprocessable`).
 */

type Body = Record<string, unknown>;

/** Rejects keys outside `allowed` (catches typos such as `label` for `labels`). */
export function onlyKeys(body: Body, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`);
}

export function optString(body: Body, key: string): string | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  return v;
}

/** A trimmed, non-empty string with a maximum length. */
export function optText(body: Body, key: string, max: number): string | undefined {
  const v = optString(body, key);
  if (v === undefined) return undefined;
  const t = v.trim();
  if (!t) throw unprocessable(`${key} must not be empty`);
  if (t.length > max) throw unprocessable(`${key} must be at most ${max} characters`);
  return t;
}

export function reqText(body: Body, key: string, max: number): string {
  const v = optText(body, key, max);
  if (v === undefined) throw badRequest(`${key} is required`);
  return v;
}

/** A string or `null` (to clear). */
export function optNullableString(body: Body, key: string): string | null | undefined {
  const v = body[key];
  if (v === undefined || v === null) return v;
  if (typeof v !== 'string') throw badRequest(`${key} must be a string or null`);
  return v;
}

export function optBoolean(body: Body, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`${key} must be a boolean`);
  return v;
}

export function optInteger(body: Body, key: string): number | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw badRequest(`${key} must be an integer`);
  return v;
}

export function optEnum<T extends string>(body: Body, key: string, values: readonly T[]): T | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !values.includes(v as T)) throw unprocessable(`${key} must be one of: ${values.join(', ')}`);
  return v as T;
}

export function optStringArray(body: Body, key: string): string[] | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${key} must be an array of strings`);
  return v as string[];
}

/** `YYYY-MM-DD`, or `null` to clear. */
export function optDate(body: Body, key: string): string | null | undefined {
  const v = optNullableString(body, key);
  if (typeof v === 'string' && !isDateString(v)) throw unprocessable(`${key} must be a date (YYYY-MM-DD)`);
  return v;
}

export function optObject(body: Body, key: string): Record<string, unknown> | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${key} must be an object`);
  return v as Record<string, unknown>;
}

/** Boolean query param (`true`/`false`); `fallback` when absent. */
export function queryBool(query: URLSearchParams, key: string, fallback: boolean): boolean;
export function queryBool(query: URLSearchParams, key: string, fallback: undefined): boolean | undefined;
export function queryBool(query: URLSearchParams, key: string, fallback: boolean | undefined): boolean | undefined {
  const v = query.get(key);
  if (v === null || v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw badRequest(`${key} must be true or false`);
}

/** Repeatable query param (`?a=x&a=y`); with `comma`, also splits `?a=x,y`. Blank values are dropped. */
export function queryList(query: URLSearchParams, key: string, comma = false): string[] {
  return query
    .getAll(key)
    .flatMap((v) => (comma ? v.split(',') : [v]))
    .map((v) => v.trim())
    .filter(Boolean);
}
