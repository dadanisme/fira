import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** The link (or card-mention chip) the caret was last tapped into, on a touch device. */
export interface LinkTap {
  from: number;
  to: number;
  /** As written in the Markdown (card chips: the card's app path). */
  href: string;
  /** Resolved absolute URL (for external links). */
  url: string;
  /** Set for card-mention chips (a decoration, not a link mark: no Edit/Remove). */
  cardKey?: string;
}

export const linkTapKey = new PluginKey<LinkTap | null>('linkTaps');
/** The BubbleMenu showing a tapped link's actions; `tr.setMeta(LINK_BUBBLE, 'show')` shows it. */
export const LINK_BUBBLE = 'linkBubble';

// Pointer type of the latest pointerdown anywhere: ProseMirror's handleClick gets the mouseup (a
// MouseEvent without pointerType), and touch browsers fire mouse events after the touch.
let lastPointerType = 'mouse';
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => (lastPointerType = e.pointerType), { capture: true, passive: true });
}

/** Whether a click/mouseup came from a finger (not mouse or pen). */
export function isTouchClick(event: MouseEvent): boolean {
  const type = 'pointerType' in event && typeof event.pointerType === 'string' && event.pointerType ? event.pointerType : lastPointerType;
  return type === 'touch';
}

/** Editable editor + finger: links place the caret and show their bubble instead of opening. */
export function tapsShowLinkBubble(view: EditorView, event: MouseEvent): boolean {
  return view.editable && isTouchClick(event);
}

/** Clears the tap from the caller (e.g. after Open/Remove). Selection-only: never changes the doc. */
export function clearLinkTap(view: EditorView): void {
  if (linkTapKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(linkTapKey, null).setMeta(LINK_BUBBLE, 'hide'));
}

/**
 * On touch, tapping a link or card chip in the editor places the caret (as ProseMirror does) and
 * remembers the link, so the link bubble (Toolbars) offers Open / Edit / Remove. Desktop is
 * untouched (Mod-click opens, Alt-click edits). Plugin state only: never changes the doc, so it
 * never triggers a save. Forgotten when the doc changes or the caret leaves the link.
 */
export const LinkTaps = Extension.create({
  name: 'linkTaps',
  // Tiptap runs plugins by priority, then later extensions first; above the default (100) so this
  // click handler runs before CardMentions' and firaKeys', which swallow link/chip clicks.
  priority: 101,
  addProseMirrorPlugins() {
    return [
      new Plugin<LinkTap | null>({
        key: linkTapKey,
        state: {
          init: () => null,
          apply: (tr, old) => {
            const meta = tr.getMeta(linkTapKey) as LinkTap | null | undefined;
            if (meta !== undefined) return meta;
            if (!old || tr.docChanged) return null;
            // Meta-only transactions (menus updating) keep it; the caret may still be arriving (iOS).
            if (!tr.selectionSet) return old;
            const { from, to } = tr.selection;
            return from >= old.from && to <= old.to ? old : null;
          },
        },
        props: {
          handleDOMEvents: {
            // Runs after ProseMirror placed the caret (mouseup) and before the click handlers that
            // swallow link clicks (registered later).
            click: (view, event) => {
              if (event.button !== 0 || !tapsShowLinkBubble(view, event)) return false;
              const a = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[href]');
              if (!a || !view.dom.contains(a)) return false;
              event.preventDefault();
              let from: number;
              let to: number;
              try {
                from = view.posAtDOM(a, 0);
                to = view.posAtDOM(a, a.childNodes.length);
              } catch {
                return true;
              }
              const tap: LinkTap = { from, to, href: a.getAttribute('href') ?? '', url: a.href, cardKey: a.dataset.cardKey };
              view.dispatch(view.state.tr.setMeta(linkTapKey, tap).setMeta(LINK_BUBBLE, 'show'));
              return true;
            },
          },
        },
      }),
    ];
  },
});
