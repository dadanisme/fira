import type { Column } from './types.js';

/** Finds a column by exact id, else by name (case-insensitive, trimmed). */
export function resolveStatus(columns: readonly Column[], idOrName: string): Column | undefined {
  const name = idOrName.trim().toLowerCase();
  return columns.find((c) => c.id === idOrName) ?? columns.find((c) => c.name.toLowerCase() === name);
}

/** Column name for a status id (falls back to the id for deleted columns). */
export function statusName(columns: readonly Column[], id: string): string {
  return columns.find((c) => c.id === id)?.name ?? id;
}

/** The last column is the "done" column. */
export function doneColumn(columns: readonly Column[]): Column | undefined {
  return columns.at(-1);
}
