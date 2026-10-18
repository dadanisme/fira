import { CARD_KEY_IN_TEXT_RE, parseCardKey } from '@shared/keys';

/** App URL of a card key mention (`NI-12` → `/p/NI/NI-12`). */
export function cardHref(key: string): string {
  const parsed = parseCardKey(key);
  return parsed ? `/p/${parsed.projectKey}/${key}` : '#';
}

/** Card-key matches in a string: `[start, end, key]`. */
export function cardKeyMatches(text: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (const m of text.matchAll(CARD_KEY_IN_TEXT_RE)) out.push([m.index, m.index + m[0].length, m[0]]);
  return out;
}
