import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { cardHref, cardKeyMatches } from './cardLinks';

export interface CardMentionsOptions {
  /** Opens a mentioned card (client-side navigation). */
  open: (href: string) => void;
}

const key = new PluginKey<DecorationSet>('cardMentions');

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text || parent?.type.spec.code) return true;
    if (node.marks.some((m) => m.type.spec.code || m.type.name === 'link')) return true;
    for (const [start, end, cardKey] of cardKeyMatches(node.text)) {
      decorations.push(
        Decoration.inline(pos + start, pos + end, {
          nodeName: 'a',
          class: 'md-card-chip',
          href: cardHref(cardKey),
          'data-card-key': cardKey,
          title: `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}-click to open ${cardKey}`,
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Card keys in text (`NI-12`) render as chips linking to the card. Purely a
 * decoration: the stored Markdown stays plain text. Mod-click opens the card
 * (plain clicks place the caret, so the key stays editable).
 */
export const CardMentions = Extension.create<CardMentionsOptions>({
  name: 'cardMentions',
  addOptions: () => ({ open: () => {} }),
  addProseMirrorPlugins() {
    const { open } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            click: (view, event) => {
              const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-card-key]');
              if (!chip) return false;
              event.preventDefault();
              if (event.metaKey || event.ctrlKey || !view.editable) {
                open(chip.getAttribute('href') ?? '#');
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
