import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { buildTextIndex, findAnchor, type TextAnchor } from './textIndex';

export interface CommentAnchor extends TextAnchor {
  id: string;
}

export interface CommentHighlightsOptions {
  onClick: (id: string) => void;
  /** Top offset (px, relative to the editor element) of each anchored thread; orphans are absent. */
  onPositions: (tops: Record<string, number>) => void;
}

interface State {
  anchors: CommentAnchor[];
  activeId: string | null;
  ranges: Map<string, { from: number; to: number }>;
  decorations: DecorationSet;
}

type Meta = { anchors?: CommentAnchor[]; activeId?: string | null };

export const commentHighlightsKey = new PluginKey<State>('commentHighlights');

/** Dispatches new thread anchors and/or the active thread to the editor. */
export function setCommentHighlights(view: EditorView, meta: Meta) {
  view.dispatch(view.state.tr.setMeta(commentHighlightsKey, meta).setMeta('addToHistory', false));
}

function sameAnchor(a: CommentAnchor, b: CommentAnchor) {
  return a.quote === b.quote && a.prefix === b.prefix && a.suffix === b.suffix;
}

function locate(doc: PMNode, anchors: CommentAnchor[], keep: Map<string, { from: number; to: number }>) {
  let index: ReturnType<typeof buildTextIndex> | null = null;
  const ranges = new Map<string, { from: number; to: number }>();
  for (const a of anchors) {
    const kept = keep.get(a.id);
    if (kept && kept.to > kept.from) {
      ranges.set(a.id, kept);
      continue;
    }
    index ??= buildTextIndex(doc);
    const found = findAnchor(index, a);
    if (found) ranges.set(a.id, found);
  }
  return ranges;
}

function decorationsFor(doc: PMNode, ranges: State['ranges'], activeId: string | null) {
  const decos = [...ranges].map(([id, { from, to }]) =>
    Decoration.inline(from, to, { class: id === activeId ? 'md-comment is-active' : 'md-comment', 'data-thread-id': id }, { id }),
  );
  return DecorationSet.create(doc, decos);
}

function apply(tr: Transaction, prev: State, state: EditorState): State {
  const meta = tr.getMeta(commentHighlightsKey) as Meta | undefined;
  if (!meta && !tr.docChanged) return prev;
  const anchors = meta?.anchors ?? prev.anchors;
  const activeId = meta?.activeId !== undefined ? meta.activeId : prev.activeId;
  // Keep ranges of unchanged anchors, mapped through edits; re-search the rest
  // (new threads, and ranges that collapsed, e.g. after a full content replace).
  const keep = new Map<string, { from: number; to: number }>();
  const prevById = new Map(prev.anchors.map((a) => [a.id, a]));
  for (const a of anchors) {
    const r = prev.ranges.get(a.id);
    const old = prevById.get(a.id);
    if (!r || !old || !sameAnchor(a, old)) continue;
    const from = tr.mapping.map(r.from, 1);
    const to = tr.mapping.map(r.to, -1);
    if (to > from) keep.set(a.id, { from, to });
  }
  const ranges = locate(state.doc, anchors, keep);
  return { anchors, activeId, ranges, decorations: decorationsFor(state.doc, ranges, activeId) };
}

/**
 * Inline comment highlights as decorations (Markdown holds no marks): threads are
 * located by searching quote + context in the document text, then mapped through
 * edits. Reports each thread's vertical position for a margin panel.
 */
export const CommentHighlights = Extension.create<CommentHighlightsOptions>({
  name: 'commentHighlights',
  addOptions: () => ({ onClick: () => {}, onPositions: () => {} }),
  addProseMirrorPlugins() {
    const { onClick, onPositions } = this.options;
    return [
      new Plugin<State>({
        key: commentHighlightsKey,
        state: {
          init: (_, state) => ({ anchors: [], activeId: null, ranges: new Map(), decorations: DecorationSet.create(state.doc, []) }),
          apply: (tr, prev, _old, state) => apply(tr, prev, state),
        },
        props: {
          decorations: (state) => commentHighlightsKey.getState(state)?.decorations,
          handleClick: (view, pos) => {
            const s = commentHighlightsKey.getState(view.state);
            if (!s || !view.state.selection.empty) return false;
            for (const [id, r] of s.ranges) {
              if (pos >= r.from && pos <= r.to) {
                onClick(id);
                break;
              }
            }
            return false;
          },
        },
        view: (view) => {
          let frame = 0;
          let last = '';
          const report = () => {
            frame = 0;
            const s = commentHighlightsKey.getState(view.state);
            if (!s) return;
            const base = view.dom.getBoundingClientRect().top;
            const tops: Record<string, number> = {};
            for (const [id, r] of s.ranges) {
              try {
                tops[id] = Math.round(view.coordsAtPos(r.from).top - base);
              } catch {
                // Position not rendered (yet).
              }
            }
            const json = JSON.stringify(tops);
            if (json !== last) {
              last = json;
              onPositions(tops);
            }
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(report);
          };
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          schedule();
          return {
            update: schedule,
            destroy: () => {
              observer.disconnect();
              cancelAnimationFrame(frame);
            },
          };
        },
      }),
    ];
  },
});
