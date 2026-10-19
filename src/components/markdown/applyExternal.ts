import type { Editor } from '@tiptap/core';
import type { Fragment, Node as PMNode } from '@tiptap/pm/model';

/** Above this many top-level block pairs, skip the block diff and replace one changed range. */
const MAX_DIFF_CELLS = 400_000;

/**
 * Replaces the document with `markdown` (an external change: a remote save, a version
 * restore, a template) by changing only what differs, so the selection, scroll position
 * and comment highlights in untouched blocks stay put. Top-level blocks are matched with
 * an LCS diff; a block changed in place is narrowed to the characters that differ.
 * Not added to undo history (undo shouldn't revert someone else's edit); no update event.
 */
export function applyExternal(editor: Editor, markdown: string) {
  try {
    const next = editor.schema.nodeFromJSON(editor.markdown!.parse(markdown));
    const { doc } = editor.state;
    if (doc.eq(next)) return;
    const tr = editor.state.tr;
    // Hunks are applied from the end, so earlier positions in `doc` stay valid.
    for (const h of blockHunks(doc, next).reverse()) {
      const [fromA, toA, fromB, toB] = h.single ? narrow(doc.content.cut(h.fromA, h.toA), next.content.cut(h.fromB, h.toB), h) : [h.fromA, h.toA, h.fromB, h.toB];
      tr.replace(fromA, toA, next.slice(fromB, toB));
    }
    editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true));
  } catch {
    // Fall back to a full replace, keeping the caret where it was as far as the new document allows.
    const { from, to } = editor.state.selection;
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    const max = editor.state.doc.content.size;
    try {
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    } catch {
      // Selection not valid in the new document: leave the default.
    }
  }
}

interface Hunk {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
  /** One block replaced by one block: worth narrowing to the changed characters. */
  single: boolean;
}

/** Runs of top-level blocks that differ between `a` and `b`, as position ranges, in document order. */
function blockHunks(a: PMNode, b: PMNode): Hunk[] {
  const as = children(a);
  const bs = children(b);
  const n = as.length;
  const m = bs.length;
  if (n * m > MAX_DIFF_CELLS) return [{ fromA: 0, toA: a.content.size, fromB: 0, toB: b.content.size, single: true }];
  const offA = offsets(as);
  const offB = offsets(bs);
  // lcs[i][j] = LCS length of as[i..] and bs[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = as[i].eq(bs[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let si = 0;
  let sj = 0;
  const close = () => {
    if (i > si || j > sj) hunks.push({ fromA: offA[si], toA: offA[i], fromB: offB[sj], toB: offB[j], single: i - si === 1 && j - sj === 1 });
  };
  while (i < n || j < m) {
    if (i < n && j < m && as[i].eq(bs[j])) {
      close();
      i++;
      j++;
      si = i;
      sj = j;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) j++;
    else i++;
  }
  close();
  return hunks;
}

function children(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

function offsets(nodes: PMNode[]): number[] {
  const out = [0];
  for (const node of nodes) out.push(out[out.length - 1] + node.nodeSize);
  return out;
}

/** The sub-range of a one-block hunk that actually differs. */
function narrow(fa: Fragment, fb: Fragment, h: Hunk): [number, number, number, number] {
  const start = fa.findDiffStart(fb);
  const end = fa.findDiffEnd(fb);
  if (start === null || !end) return [h.fromA, h.toA, h.fromB, h.toB];
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return [h.fromA + start, h.fromA + endA, h.fromB + start, h.fromB + endB];
}
