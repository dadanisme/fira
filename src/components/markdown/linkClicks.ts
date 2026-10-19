import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/**
 * Links open in a new tab on a plain click, even while editing. Alt/Option-click
 * places the caret inside the link instead, to edit its text. A drag (text
 * selection) never opens anything: ProseMirror only calls handleClick for clicks.
 */
export const LinkClicks = Extension.create({
  name: 'linkClicks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkClicks'),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || event.altKey) return false;
            const link = (event.target as HTMLElement | null)?.closest?.('a[href]');
            if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) return false;
            const href = link.getAttribute('href') ?? '';
            if (!SAFE_URL.test(href.trim())) return false;
            window.open(link.href, '_blank', 'noopener,noreferrer');
            return true;
          },
        },
      }),
    ];
  },
});
