import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { CircleAlert, Minus, SignalHigh, SignalLow, SignalMedium, Square, SquareCheck, Zap } from 'lucide-react';
import type { CardType, Label, LabelColor, Priority } from '@shared/types';
import { colorFor, findLabel } from '@shared/labels';
import { Badge } from '../../components/Badge';
import { cx } from '../../lib/cx';
import { PRIORITY_NAMES } from './format';

const PRIORITY_ICON = { none: Minus, low: SignalLow, medium: SignalMedium, high: SignalHigh, urgent: CircleAlert };
const PRIORITY_COLOR: Record<Priority, string> = {
  none: 'text-prio-none',
  low: 'text-prio-low',
  medium: 'text-prio-medium',
  high: 'text-prio-high',
  urgent: 'text-prio-urgent',
};

export function PriorityIcon({ priority, size = '0.875rem', className }: { priority: Priority; size?: string; className?: string }) {
  const Icon = PRIORITY_ICON[priority];
  return (
    <Icon
      size={size}
      aria-label={PRIORITY_NAMES[priority]}
      role="img"
      strokeWidth={priority === 'urgent' ? 2.25 : 2}
      className={cx('shrink-0', PRIORITY_COLOR[priority], className)}
    />
  );
}

/** Epic tag color, derived from the epic's id so it is stable across renames. */
export function epicColor(epicId: string): LabelColor {
  return colorFor(epicId);
}

export function EpicTag({ id, title, className }: { id: string; title: string; className?: string }) {
  const color = epicColor(id);
  return (
    <span
      className={cx('inline-flex h-4.5 max-w-40 items-center gap-1 rounded px-1.5 text-xs leading-none font-medium', className)}
      style={{ background: `var(--label-${color}-bg)`, color: `var(--label-${color}-fg)` }}
      title={`Epic: ${title}`}
    >
      <Zap size="0.625rem" className="shrink-0" />
      <span className="truncate">{title || 'Untitled epic'}</span>
    </span>
  );
}

export function TypeIcon({ type, size = '0.8125rem' }: { type: CardType; size?: string }) {
  if (type === 'epic') return <Zap size={size} aria-label="Epic" role="img" className="shrink-0 text-[var(--label-purple-fg)]" />;
  if (type === 'subtask') return <Square size={size} aria-label="Subtask" role="img" className="shrink-0 text-fg-faint" />;
  return null;
}

export function ProgressBadge({ done, total }: { done: number; total: number }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs tabular-nums', done === total ? 'text-success' : 'text-fg-faint')}>
      <SquareCheck size="0.75rem" />
      {done}/{total}
    </span>
  );
}

// ------------------------------------------------------------- labels

/** Labels for tiles and pickers. Separate from the board data so tiles don't re-render on card changes. */
const LabelsContext = createContext<readonly Label[]>([]);

export function LabelsProvider({ labels, children }: { labels: readonly Label[]; children: ReactNode }) {
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>;
}

export function useLabelList(): readonly Label[] {
  return useContext(LabelsContext);
}

export function useLabelColor(): (name: string) => LabelColor {
  const labels = useContext(LabelsContext);
  return useMemo(() => {
    const map = new Map(labels.map((l) => [l.name.toLowerCase(), l.color]));
    return (name: string) => map.get(name.toLowerCase()) ?? findLabel(labels, name)?.color ?? 'gray';
  }, [labels]);
}

export function LabelBadges({ names, onRemove, max }: { names: readonly string[]; onRemove?: (name: string) => void; max?: number }) {
  const color = useLabelColor();
  const shown = max ? names.slice(0, max) : names;
  return (
    <>
      {shown.map((name) => (
        <Badge key={name} color={color(name)} onRemove={onRemove && (() => onRemove(name))}>
          {name}
        </Badge>
      ))}
      {max && names.length > max && <span className="text-xs text-fg-faint">+{names.length - max}</span>}
    </>
  );
}

export function ColorDot({ color, className }: { color: LabelColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: `var(--label-${color}-fg)` }}
    />
  );
}
