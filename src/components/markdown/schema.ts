import type { AnyExtension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { OrderedList, TaskItem, TaskList, parsePlainTextOrderedListPaste } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { Plugin } from '@tiptap/pm/state';
import { LinkClicks } from './linkClicks';

/**
 * GFM ordered lists only. Tiptap's ordered list also reads `a.`/`IV.` markers, which
 * turned sentences like "Ya. satu" into list items (serialized back as `1. satu`).
 * - Markdown: a tokenizer that never matches, so marked's own GFM list tokenizer
 *   (digits + `.`/`)` only) produces the `list` tokens.
 * - No `type` attribute: Markdown can't store `a.`/`i.` lists, so lists pasted as HTML
 *   (`<ol type="a">`) are numbered and survive a save.
 * - Plain-text paste only becomes a list for digit markers. The typing input rule is
 *   already digits-only (`1. `).
 */
const DIGIT_LIST_LINE = /^\d{1,9}[.)]\s/;
const GfmOrderedList = OrderedList.extend({
  markdownTokenizer: { name: 'orderedList', level: 'block', start: () => -1, tokenize: () => undefined },
  // Items go through ListItem's parser, as for bullet lists: the stock parser expects the
  // custom tokenizer's tokens and would drop inline marks from marked's (`1. **bold**`).
  parseMarkdown: (token, helpers) => {
    if (token.type !== 'list' || !token.ordered) return [];
    const start = Number(token.start) || 1;
    return { type: 'orderedList', ...(start !== 1 && { attrs: { start } }), content: helpers.parseChildren(token.items ?? []) };
  },
  addAttributes() {
    const attrs = { ...this.parent?.() };
    delete attrs.type;
    return attrs;
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            if (event.clipboardData?.getData('text/html')?.trim()) return false;
            const text = event.clipboardData?.getData('text/plain') ?? '';
            const lines = text.split('\n').filter((l) => l.trim());
            if (lines.length === 0 || !lines.every((l) => DIGIT_LIST_LINE.test(l.trim()))) return false;
            const list = parsePlainTextOrderedListPaste(text);
            if (!list) return false;
            try {
              view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodeFromJSON(list)));
              return true;
            } catch {
              return false;
            }
          },
        },
      }),
    ];
  },
});

/**
 * Paragraph lines that would start a block on reload (`1. `, `12) `, `# `, `- `, `+ `,
 * setext `---`/`===`) get a backslash escape. `*`, `_` and `>` are already escaped by
 * the serializer; text like "Ya. satu" isn't special in GFM and is left alone.
 */
const BLOCK_START = /^( {0,3})(#{1,6}(?=\s|$)|[-+](?=\s|$)|-+(?=[ \t]*$)|=+(?=[ \t]*$)|\d{1,9}(?=[.)](?:\s|$)))/gm;
const escapeBlockStarts = (md: string) =>
  md.replace(BLOCK_START, (_m, indent: string, marker: string) => (/^\d/.test(marker) ? `${indent}${marker}\\` : `${indent}\\${marker}`));

const GfmParagraph = Paragraph.extend({
  renderMarkdown(node, h, ctx) {
    return escapeBlockStarts(this.parent?.(node, h, ctx) ?? '');
  },
});

/**
 * The document schema shared by the editor and the read-only view: one schema for
 * every variant, so any stored Markdown (e.g. a table an agent wrote into a card
 * description) round-trips everywhere. Variants only differ in UI (slash menu etc.).
 */
export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      orderedList: false,
      paragraph: false,
      // Provided by the editor only (needs a view).
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      undoRedo: false,
    }),
    GfmParagraph,
    GfmOrderedList,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: false }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    // Behavior only (no schema); inert in the read-only view, which renders plain <a> tags.
    LinkClicks,
  ];
}
