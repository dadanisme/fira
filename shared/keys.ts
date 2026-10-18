/** Project keys: uppercase letter followed by 1–9 uppercase letters/digits (`NI`, `WEB2`). */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** Matches card keys inside free text (e.g. mentions in Markdown). Global: reset `lastIndex` or use `matchAll`. */
export const CARD_KEY_IN_TEXT_RE = /\b[A-Z][A-Z0-9]{1,9}-[1-9]\d*\b/g;

const CARD_KEY_RE = /^([A-Z][A-Z0-9]{1,9})-([1-9]\d*)$/;

export function isProjectKey(value: string): boolean {
  return PROJECT_KEY_RE.test(value);
}

export function formatCardKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/** `ni-12` / `NI-12` → `{ projectKey: 'NI', number: 12 }`; null if malformed. */
export function parseCardKey(key: string): { projectKey: string; number: number } | null {
  const match = CARD_KEY_RE.exec(key.trim().toUpperCase());
  return match ? { projectKey: match[1], number: Number(match[2]) } : null;
}

/** Normalizes user input to a canonical card key, or null. */
export function normalizeCardKey(key: string): string | null {
  const parsed = parseCardKey(key);
  return parsed && formatCardKey(parsed.projectKey, parsed.number);
}
