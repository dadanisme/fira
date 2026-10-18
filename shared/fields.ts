import type { FieldDef, FieldValue } from './types.js';

/** `YYYY-MM-DD` that is a real calendar date. */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type Coerced = { ok: true; value: FieldValue } | { ok: false; error: string };

/**
 * Validates and normalizes a custom field value for its definition:
 * text → string, number → finite number (numeric strings accepted), checkbox →
 * boolean (`"true"`/`"false"` accepted), select → one of `options` (matched
 * case-insensitively, stored as the option), multiselect → de-duplicated options
 * (a single string is wrapped), date → `YYYY-MM-DD`, url → absolute http(s) URL.
 */
export function coerceFieldValue(def: FieldDef, value: unknown): Coerced {
  const fail = (expected: string): Coerced => ({ ok: false, error: `${def.key} must be ${expected}` });
  const option = (v: unknown) =>
    typeof v === 'string' ? def.options?.find((o) => o.toLowerCase() === v.trim().toLowerCase()) : undefined;
  const optionList = () => (def.options?.length ? `one of: ${def.options.join(', ')}` : 'an option (none are defined)');

  switch (def.type) {
    case 'text':
      if (typeof value === 'string') return { ok: true, value };
      if (typeof value === 'number' || typeof value === 'boolean') return { ok: true, value: String(value) };
      return fail('a string');
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : fail('a number');
    }
    case 'checkbox':
      if (typeof value === 'boolean') return { ok: true, value };
      if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
      return fail('a boolean');
    case 'select': {
      const o = option(value);
      return o !== undefined ? { ok: true, value: o } : fail(optionList());
    }
    case 'multiselect': {
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list)) return fail(`an array of ${optionList()}`);
      const out: string[] = [];
      for (const v of list) {
        const o = option(v);
        if (o === undefined) return fail(`an array of ${optionList()}`);
        if (!out.includes(o)) out.push(o);
      }
      return { ok: true, value: out };
    }
    case 'date':
      return typeof value === 'string' && isDateString(value) ? { ok: true, value } : fail('a date (YYYY-MM-DD)');
    case 'url':
      if (typeof value === 'string') {
        try {
          const url = new URL(value);
          if (url.protocol === 'http:' || url.protocol === 'https:') return { ok: true, value };
        } catch {
          // fall through
        }
      }
      return fail('an absolute http(s) URL');
  }
}

/** Whether a stored field value matches a filter string (as used by `field.<key>=` search params). */
export function fieldMatches(def: FieldDef | undefined, stored: FieldValue | undefined, filter: string): boolean {
  if (stored === undefined) return filter === '';
  const needle = filter.trim().toLowerCase();
  if (Array.isArray(stored)) return stored.some((v) => v.toLowerCase() === needle);
  if (typeof stored === 'number') return def?.type === 'number' ? stored === Number(filter) : String(stored) === filter.trim();
  if (typeof stored === 'boolean') return String(stored) === needle;
  return stored.toLowerCase() === needle;
}
