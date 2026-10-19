import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { OutlineHeading } from '../MarkdownEditor';

export interface HeadingFoldsOptions {
  /** localStorage key for this document's folds (per device). */
  storageKey: string;
  /** The document's top-level headings, debounced. */
  onOutline: (headings: OutlineHeading[]) => void;
}

interface Heading {
  pos: number;
  /** Position after the heading node: its section's content starts here. */
  end: number;
  /** Position of the next heading of the same or a higher level, or the document end. */
  sectionEnd: number;
  level: number;
  text: string;
  /** Stable id: occurrence index among headings with the same text, plus the text. */
  key: string;
}

interface State {
  headings: Heading[];
  /** Positions of folded headings. */
  folded: Set<number>;
  /** Stored keys not found in the document (yet), e.g. while the content is still empty. */
  unresolved: string[];
  decorations: DecorationSet;
}

type Meta = { toggle: number } | { unfold: number[] };

const foldsKey = new PluginKey<State>('headingFolds');

function scan(doc: PMNode): Heading[] {
  const out: Heading[] = [];
  const seen = new Map<string, number>();
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return;
    const text = node.textContent.trim();
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    out.push({ pos, end: pos + node.nodeSize, sectionEnd: doc.content.size, level: node.attrs.level as number, text, key: `${n}|${text}` });
  });
  const open: Heading[] = [];
  for (const h of out) {
    while (open.length > 0 && open[open.length - 1].level >= h.level) open.pop()!.sectionEnd = h.pos;
    open.push(h);
  }
  return out;
}

/** Folded headings whose hidden range contains `pos` (outermost first). `to` treats the range end as inside. */
function covering(s: State, pos: number, side: 'from' | 'to' = 'from'): Heading[] {
  return s.headings.filter(
    (h) => s.folded.has(h.pos) && (side === 'from' ? h.end <= pos && pos < h.sectionEnd : h.end < pos && pos <= h.sectionEnd),
  );
}

function decorationsFor(doc: PMNode, headings: Heading[], folded: Set<number>) {
  const decos: Decoration[] = [];
  // Outermost folded sections; nested ones lie inside them.
  const hidden: [number, number][] = [];
  for (const h of headings) {
    const isFolded = folded.has(h.pos);
    let cls = 'md-heading';
    if (h.sectionEnd > h.end) cls += ' md-foldable';
    if (isFolded) cls += ' is-folded';
    decos.push(Decoration.node(h.pos, h.end, { class: cls, 'data-outline-id': h.key }));
    if (isFolded && h.sectionEnd > h.end && !(hidden.length > 0 && h.pos < hidden[hidden.length - 1][1])) hidden.push([h.end, h.sectionEnd]);
  }
  if (hidden.length > 0) {
    doc.forEach((node, pos) => {
      if (hidden.some(([from, to]) => pos >= from && pos < to)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-fold-hidden' }));
    });
  }
  return DecorationSet.create(doc, decos);
}

function build(doc: PMNode, headings: Heading[], folded: Set<number>, unresolved: string[]): State {
  return { headings, folded, unresolved, decorations: decorationsFor(doc, headings, folded) };
}

function readStored(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const keys: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function storedKeys(s: State): string[] {
  return [...s.headings.filter((h) => s.folded.has(h.pos)).map((h) => h.key), ...s.unresolved];
}

/** Resolves stored keys against the headings: found ones are folded, the rest stay unresolved. */
function resolve(keys: string[], headings: Heading[], folded: Set<number>): string[] {
  if (keys.length === 0) return keys;
  const byKey = new Map(headings.map((h) => [h.key, h]));
  return keys.filter((k) => {
    const h = byKey.get(k);
    if (h) folded.add(h.pos);
    return !h;
  });
}

function apply(tr: Transaction, prev: State, state: EditorState): State {
  const meta = tr.getMeta(foldsKey) as Meta | undefined;
  if (!meta && !tr.docChanged) return prev;
  let { headings, folded, unresolved } = prev;
  if (tr.docChanged) {
    // Follow folded headings through the edit; a heading whose block was replaced
    // (e.g. a remote save, a full content replace) is found again by its key.
    headings = scan(state.doc);
    const byPos = new Map(headings.map((h) => [h.pos, h]));
    const byKey = new Map(headings.map((h) => [h.key, h]));
    const prevByPos = new Map(prev.headings.map((h) => [h.pos, h]));
    folded = new Set();
    for (const pos of prev.folded) {
      const mapped = tr.mapping.mapResult(pos, 1);
      const h = (!mapped.deleted && byPos.get(mapped.pos)) || byKey.get(prevByPos.get(pos)?.key ?? '');
      if (h) folded.add(h.pos);
    }
    unresolved = resolve(unresolved, headings, folded);
  }
  if (meta) {
    folded = new Set(folded);
    if ('toggle' in meta) {
      if (!folded.delete(meta.toggle)) folded.add(meta.toggle);
    } else for (const pos of meta.unfold) folded.delete(pos);
  }
  return build(state.doc, headings, folded, unresolved);
}

/** Folds or unfolds the heading at `pos`; a selection inside the section being folded moves to the heading. */
function toggleFold(view: EditorView, pos: number) {
  const s = foldsKey.getState(view.state);
  const h = s?.headings.find((x) => x.pos === pos);
  if (!s || !h) return;
  const tr = view.state.tr.setMeta(foldsKey, { toggle: pos } satisfies Meta);
  if (!s.folded.has(pos)) {
    const { from, to } = view.state.selection;
    if ((from >= h.end && from < h.sectionEnd) || (to > h.end && to <= h.sectionEnd)) tr.setSelection(TextSelection.create(tr.doc, h.end - 1));
  }
  view.dispatch(tr);
}

/** Unfolds every folded section that hides `pos`. */
export function revealPos(view: EditorView, pos: number) {
  const s = foldsKey.getState(view.state);
  const hiding = s ? covering(s, pos) : [];
  if (hiding.length > 0) view.dispatch(view.state.tr.setMeta(foldsKey, { unfold: hiding.map((h) => h.pos) } satisfies Meta));
}

/** Unfolds the sections hiding the heading with this outline id; returns its element (null if gone or folding is off). */
export function revealHeading(view: EditorView, id: string): HTMLElement | null {
  const h = foldsKey.getState(view.state)?.headings.find((x) => x.key === id);
  if (!h) return null;
  revealPos(view, h.pos);
  return view.nodeDOM(h.pos) as HTMLElement | null;
}

/** For content hidden by a fold: the position (start of the outermost folded heading's text) where it shows. */
export function foldedPlaceholder(state: EditorState, pos: number): number | null {
  const s = foldsKey.getState(state);
  const outer = s ? covering(s, pos)[0] : undefined;
  return outer ? outer.pos + 1 : null;
}

/** Whether a click lands on the "…" hint after a folded heading's text. */
function onFoldHint(el: Element, x: number, y: number): boolean {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (!last) return false;
  const em = parseFloat(getComputedStyle(el).fontSize) || 16;
  return x > last.right && x < last.right + 2.5 * em && y >= last.top && y <= last.bottom;
}

/**
 * Heading folding for the page editor. Folding a level-N heading hides the following
 * top-level blocks up to the next heading of level ≤ N, with node decorations only:
 * the document (and so the Markdown) never changes. The chevron is the heading's
 * ::before in the left gutter (markdown.css), so nothing is added to the text flow.
 * Folds persist per device in localStorage by heading key; a selection that lands in
 * a folded section (keyboard, undo, Enter on a folded heading, a remote edit) unfolds it.
 * Also reports the outline (top-level headings) for a table of contents.
 */
export const HeadingFolds = Extension.create<HeadingFoldsOptions>({
  name: 'headingFolds',
  addOptions: () => ({ storageKey: '', onOutline: () => {} }),
  addProseMirrorPlugins() {
    const { storageKey, onOutline } = this.options;
    return [
      new Plugin<State>({
        key: foldsKey,
        state: {
          init: (_, state) => {
            const headings = scan(state.doc);
            const folded = new Set<number>();
            const unresolved = resolve(readStored(storageKey), headings, folded);
            return build(state.doc, headings, folded, unresolved);
          },
          apply: (tr, prev, _old, state) => apply(tr, prev, state),
        },
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
          const s = foldsKey.getState(state);
          const sel = state.selection;
          if (!s || s.folded.size === 0 || sel instanceof AllSelection) return null;
          const hiding = new Set([...covering(s, sel.from), ...covering(s, sel.to, 'to')].map((h) => h.pos));
          if (hiding.size === 0) return null;
          return state.tr.setMeta(foldsKey, { unfold: [...hiding] } satisfies Meta).setMeta('addToHistory', false);
        },
        props: {
          decorations: (state) => foldsKey.getState(state)?.decorations,
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0) return false;
              const el = (event.target as Element).closest?.('.md-foldable');
              if (!el || el.parentNode !== view.dom) return false;
              const onChevron = event.clientX < el.getBoundingClientRect().left;
              if (!onChevron && !(el.classList.contains('is-folded') && onFoldHint(el, event.clientX, event.clientY))) return false;
              event.preventDefault();
              toggleFold(view, view.posAtDOM(el, 0) - 1);
              return true;
            },
          },
        },
        view: (view) => {
          let timer = 0;
          let lastOutline = '';
          let lastStored = JSON.stringify(readStored(storageKey));
          const emit = () => {
            timer = 0;
            const s = foldsKey.getState(view.state);
            if (!s) return;
            const outline = s.headings.map((h) => ({ id: h.key, level: h.level, text: h.text, folded: s.folded.has(h.pos) }));
            const json = JSON.stringify(outline);
            if (json === lastOutline) return;
            lastOutline = json;
            onOutline(outline);
          };
          // First outline right after mount (not during render); later ones debounced.
          timer = window.setTimeout(emit, 0);
          return {
            update: (_view, prevState) => {
              const s = foldsKey.getState(view.state);
              if (!s || s === foldsKey.getState(prevState)) return;
              const stored = JSON.stringify(storedKeys(s));
              if (stored !== lastStored) {
                lastStored = stored;
                try {
                  if (stored === '[]') localStorage.removeItem(storageKey);
                  else localStorage.setItem(storageKey, stored);
                } catch {
                  // Storage unavailable: folds last for this session only.
                }
              }
              window.clearTimeout(timer);
              timer = window.setTimeout(emit, 150);
            },
            destroy: () => window.clearTimeout(timer),
          };
        },
      }),
    ];
  },
});
