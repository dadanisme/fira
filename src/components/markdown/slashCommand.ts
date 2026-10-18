import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

export interface SlashState {
  active: boolean;
  /** Position of the `/`. */
  from: number;
  query: string;
  /** `from` of a menu dismissed with Escape (stays closed until a new `/`). */
  dismissed: number | null;
}

export interface SlashCommandOptions {
  /** Keyboard handler of the open menu; returns true when it handled the key. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const slashKey = new PluginKey<SlashState>('slashCommand');

const INACTIVE: SlashState = { active: false, from: 0, query: '', dismissed: null };

function detect(state: EditorState, dismissed: number | null): SlashState {
  const { selection } = state;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return { ...INACTIVE, dismissed };
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, '￼');
  const match = /(?:^|\s)\/([\w-]*)$/.exec(before);
  if (!match) return { ...INACTIVE, dismissed: null };
  const from = $from.pos - match[1].length - 1;
  if (dismissed === from) return { ...INACTIVE, dismissed };
  return { active: true, from, query: match[1], dismissed: null };
}

/** Tracks a `/query` before the caret for the slash menu (rendered by SlashMenu). */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',
  // Before list/paragraph keymaps, so Enter/arrows go to the open menu.
  priority: 1000,
  addOptions: () => ({ onKeyDown: () => false }),
  addProseMirrorPlugins() {
    const { onKeyDown } = this.options;
    return [
      new Plugin<SlashState>({
        key: slashKey,
        state: {
          init: () => INACTIVE,
          apply: (tr, prev, _old, state) => {
            if (tr.getMeta(slashKey) === 'dismiss') return { ...INACTIVE, dismissed: prev.from };
            if (!tr.docChanged && !tr.selectionSet) return prev;
            return detect(state, prev.dismissed);
          },
        },
        props: {
          handleKeyDown: (view, event) => {
            if (!slashKey.getState(view.state)?.active) return false;
            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(slashKey, 'dismiss'));
              return true;
            }
            return onKeyDown(event);
          },
        },
      }),
    ];
  },
});
