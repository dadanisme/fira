import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { inAppPath } from './appLinks';
import { tapsShowLinkBubble } from './linkTaps';

export const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/**
 * Links open in a new tab on a plain click, even while editing. Alt/Option-click
 * places the caret inside the link instead, to edit its text. A drag (text
 * selection) never opens anything: ProseMirror only calls handleClick for clicks.
 * In-app links (pages, cards) are left to the editor, which navigates in place. On touch, in an
 * editable editor, a tap places the caret and shows the link bubble instead (linkTaps.ts).
 */
export const LinkClicks = Extension.create({
  name: 'linkClicks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkClicks'),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || event.altKey || tapsShowLinkBubble(view, event)) return false;
            const link = (event.target as HTMLElement | null)?.closest?.('a[href]');
            if (!(link instanceof HTMLAnchorElement) || !view.dom.contains(link)) return false;
            const href = link.getAttribute('href') ?? '';
            if (!SAFE_URL.test(href.trim()) || inAppPath(href) !== null) return false;
            window.open(link.href, '_blank', 'noopener,noreferrer');
            return true;
          },
        },
      }),
    ];
  },
});
