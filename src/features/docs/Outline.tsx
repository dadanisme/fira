import type { OutlineHeading } from '../../components/MarkdownEditor';
import { cx } from '../../lib/cx';

/** Table of contents: headings indented by level; the current section is marked. */
export function Outline({ entries, activeId, onSelect }: { entries: OutlineHeading[]; activeId: string | null; onSelect(id: string): void }) {
  const top = Math.min(...entries.map((h) => h.level));
  return (
    <ul className="flex flex-col border-l border-line text-sm">
      {entries.map((h) => {
        const active = h.id === activeId;
        return (
          <li key={h.id} className="flex">
            <button
              type="button"
              title={h.text}
              aria-current={active ? 'location' : undefined}
              onClick={() => onSelect(h.id)}
              className={cx(
                '-ml-px flex min-w-0 flex-1 items-center gap-1 border-l-2 py-1 pr-1 text-left leading-snug transition-colors hover:text-fg',
                active ? 'border-accent text-fg' : 'border-transparent text-fg-muted',
              )}
              style={{ paddingLeft: `${0.625 + (h.level - top) * 0.75}rem` }}
            >
              <span className="truncate">{h.text}</span>
              {h.folded && <span className="shrink-0 text-fg-faint">…</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
