import type { AnyExtension } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Image } from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';

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
      // Provided by the editor only (needs a view).
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      undoRedo: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: false }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
