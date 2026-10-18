import { statusName } from './status.js';
import type { ActivityDraft, ActivityValue, Card, Column, DateString, FieldValue, Priority } from './types.js';

/**
 * A change to a card. Omitted keys are untouched. `null` clears an optional value.
 * `fields` is merged per key (null removes the key); `labels` replaces the list.
 */
export interface CardPatch {
  title?: string;
  description?: string;
  /** Column id. */
  status?: string;
  rank?: string;
  priority?: Priority;
  labels?: string[];
  dueDate?: DateString | null;
  parentId?: string | null;
  fields?: Record<string, FieldValue | null>;
  archived?: boolean;
  pageId?: string | null;
}

export interface ActivityContext {
  columns: readonly Column[];
  /** Resolves a card id to its key for `parent` entries; defaults to the id. */
  cardKey?: (id: string) => string | undefined;
}

/**
 * The activity entries a patch produces against the current card. Unchanged values
 * produce nothing; `rank` never produces an entry. Used by both the SPA and the API
 * so every writer logs identically.
 */
export function cardPatchActivity(card: Card, patch: CardPatch, ctx: ActivityContext): ActivityDraft[] {
  const out: ActivityDraft[] = [];
  const push = (kind: ActivityDraft['kind'], from: ActivityValue, to: ActivityValue, field?: string) => {
    if (!sameValue(from, to)) out.push(field ? { kind, field, from, to } : { kind, from, to });
  };
  const key = (id: string | null | undefined) => (id ? (ctx.cardKey?.(id) ?? id) : null);

  if (patch.title !== undefined) push('title', card.title, patch.title);
  if (patch.description !== undefined && patch.description !== card.description) {
    out.push({ kind: 'description', from: card.descriptionVersion, to: card.descriptionVersion + 1 });
  }
  if (patch.status !== undefined) {
    push('status', statusName(ctx.columns, card.status), statusName(ctx.columns, patch.status));
  }
  if (patch.priority !== undefined) push('priority', card.priority, patch.priority);
  if (patch.labels !== undefined) push('labels', card.labels, patch.labels);
  if (patch.dueDate !== undefined) push('dueDate', card.dueDate ?? null, patch.dueDate);
  if (patch.parentId !== undefined) push('parent', key(card.parentId), key(patch.parentId));
  if (patch.archived !== undefined) push('archived', card.archived, patch.archived);
  if (patch.pageId !== undefined) push('page', card.pageId ?? null, patch.pageId);
  for (const [field, value] of Object.entries(patch.fields ?? {})) {
    push('field', card.fields[field] ?? null, value, field);
  }
  return out;
}

function sameValue(a: ActivityValue, b: ActivityValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
  }
  return a === b;
}
