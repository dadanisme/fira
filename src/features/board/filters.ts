import { PRIORITIES, type Card, type FieldDef, type Priority } from '@shared/types';

/**
 * Board filters, kept in URL search params so views are linkable and survive reloads:
 * `q`, `label` (repeat), `priority` (repeat), `epic` (repeat; epic key or `none`),
 * `f.<fieldKey>` (repeat; select/multiselect options), `subtasks=1`, `archived=1`.
 * Values OR within a param and AND across params.
 */
export interface Filters {
  q: string;
  labels: string[];
  priorities: Priority[];
  epics: string[];
  fields: Record<string, string[]>;
  subtasks: boolean;
  archived: boolean;
}

export const NO_EPIC = 'none';

export function parseFilters(params: URLSearchParams): Filters {
  const fields: Record<string, string[]> = {};
  for (const [k, v] of params) {
    if (k.startsWith('f.') && v) (fields[k.slice(2)] ??= []).push(v);
  }
  return {
    q: params.get('q') ?? '',
    labels: params.getAll('label'),
    priorities: params.getAll('priority').filter((p): p is Priority => (PRIORITIES as readonly string[]).includes(p)),
    epics: params.getAll('epic'),
    fields,
    subtasks: params.get('subtasks') === '1',
    archived: params.get('archived') === '1',
  };
}

/** Returns new params with one multi-value filter replaced (empty removes it). */
export function withValues(params: URLSearchParams, name: string, values: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(name);
  for (const v of values) next.append(name, v);
  return next;
}

export function withFlag(params: URLSearchParams, name: string, on: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  if (on) next.set(name, '1');
  else next.delete(name);
  return next;
}

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(f.q || f.labels.length || f.priorities.length || f.epics.length || Object.keys(f.fields).length);
}

export function clearFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const [k, v] of params) {
    if (k === 'subtasks' || k === 'archived') next.append(k, v);
  }
  return next;
}

/**
 * A predicate for the board. `epicKeyOf` maps a card to the key of its epic
 * (subtasks inherit their parent card's epic).
 */
export function cardMatcher(f: Filters, fieldDefs: readonly FieldDef[], epicKeyOf: (card: Card) => string | undefined) {
  const q = f.q.trim().toLowerCase();
  const labels = new Set(f.labels.map((l) => l.toLowerCase()));
  const priorities = new Set<string>(f.priorities);
  const epics = new Set(f.epics);
  const fieldFilters = Object.entries(f.fields)
    .filter(([key]) => fieldDefs.some((d) => d.key === key))
    .map(([key, values]) => [key, new Set(values)] as const);

  return (card: Card): boolean => {
    if (card.archived && !f.archived) return false;
    if (card.type === 'subtask' && !f.subtasks) return false;
    if (q && !card.title.toLowerCase().includes(q) && !card.key.toLowerCase().includes(q)) return false;
    if (labels.size && !card.labels.some((l) => labels.has(l.toLowerCase()))) return false;
    if (priorities.size && !priorities.has(card.priority)) return false;
    if (epics.size) {
      const epic = card.type === 'epic' ? card.key : epicKeyOf(card);
      if (!(epic ? epics.has(epic) : epics.has(NO_EPIC))) return false;
    }
    for (const [key, values] of fieldFilters) {
      const v = card.fields[key];
      const hit = Array.isArray(v) ? v.some((x) => values.has(x)) : typeof v === 'string' && values.has(v);
      if (!hit) return false;
    }
    return true;
  };
}
