import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Plain text of a ProseMirror document with whitespace collapsed (runs of
 * spaces/newlines → one space; blocks are separated by a space), plus a mapping
 * back to document positions. Inline comment threads are anchored against this
 * text, so quotes match no matter how the Markdown is formatted or reflowed.
 */
export interface TextIndex {
  text: string;
  /** Document position of a text offset (0 … text.length). */
  posAt(offset: number): number;
  /** Text offset of a document position (nearest preceding character). */
  offsetAt(pos: number): number;
}

export function buildTextIndex(doc: PMNode): TextIndex {
  let text = '';
  // positions[i] = document position of text[i]; ends[i] = position right after it.
  const positions: number[] = [];
  const ends: number[] = [];
  const pushSpace = (pos: number) => {
    if (text.length === 0 || text.endsWith(' ')) return;
    text += ' ';
    positions.push(pos);
    ends.push(pos);
  };
  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text ?? '';
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i])) pushSpace(pos + i);
        else {
          text += t[i];
          positions.push(pos + i);
          ends.push(pos + i + 1);
        }
      }
    } else if (node.isBlock || node.type.name === 'hardBreak') {
      pushSpace(pos);
    }
    return true;
  });

  return {
    text,
    posAt(offset) {
      if (positions.length === 0) return 1;
      if (offset <= 0) return positions[0];
      if (offset >= positions.length) return ends[ends.length - 1];
      return positions[offset];
    },
    offsetAt(pos) {
      // Binary search for the first character at or after pos.
      let lo = 0;
      let hi = positions.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (positions[mid] < pos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ');
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 32;

/** Quote and ≤ 32 chars of surrounding plain text for the document range from…to. */
export function anchorForRange(index: TextIndex, from: number, to: number): TextAnchor | null {
  const start = index.offsetAt(from);
  const end = index.offsetAt(to);
  const quote = index.text.slice(start, end).trim();
  if (!quote) return null;
  const qStart = index.text.indexOf(quote, start);
  const qEnd = qStart + quote.length;
  return {
    quote,
    prefix: index.text.slice(Math.max(0, qStart - CONTEXT), qStart),
    suffix: index.text.slice(qEnd, qEnd + CONTEXT),
  };
}

/**
 * Finds a quote in the document: every occurrence of the quote is scored by how
 * much of its prefix/suffix context matches, and the best wins. Null when the
 * quote no longer appears (orphaned thread).
 */
export function findAnchor(index: TextIndex, anchor: TextAnchor): { from: number; to: number } | null {
  const quote = normalizeText(anchor.quote).trim();
  if (!quote) return null;
  const prefix = normalizeText(anchor.prefix);
  const suffix = normalizeText(anchor.suffix);
  const { text } = index;
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
    const score = commonSuffix(prefix, text.slice(Math.max(0, i - prefix.length), i)) + commonPrefix(suffix, text.slice(i + quote.length, i + quote.length + suffix.length));
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best === -1) return null;
  return { from: index.posAt(best), to: index.posAt(best + quote.length - 1) + 1 };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
