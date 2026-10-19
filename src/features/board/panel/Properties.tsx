import type { ReactNode } from 'react';
import { CircleDot, ExternalLink } from 'lucide-react';
import { PRIORITIES, type Card, type FieldDef, type FieldValue } from '@shared/types';
import { rankAfterLast } from '@shared/rank';
import { Avatar } from '../../../components/Avatar';
import { Badge } from '../../../components/Badge';
import { Menu, MenuItem, MenuSeparator } from '../../../components/Menu';
import { Popover, type PopoverTriggerProps } from '../../../components/Popover';
import { cx } from '../../../lib/cx';
import { patchCard, useBoardData } from '../context';
import { absoluteTime, formatDate, PRIORITY_NAMES, relativeTime, today } from '../format';
import { CardPicker, LabelPicker } from '../pickers';
import { EpicTag, LabelBadges, PriorityIcon } from '../ui';
import { EditableText } from './EditableText';
import type { CardPatch } from '@shared/activity';

export function Properties({ card }: { card: Card }) {
  const data = useBoardData();
  const { project, labels, doneId } = data;
  const update = (patch: CardPatch) => patchCard(data, card, patch);

  const setStatus = (status: string) => {
    if (status === card.status) return;
    update({ status, rank: rankAfterLast(data.cards.filter((c) => c.status === status && c.id !== card.id)) });
  };

  const status = project.columns.find((c) => c.id === card.status);
  const parent = card.parentId ? data.byId.get(card.parentId) : undefined;
  const parentOptions =
    card.type === 'card'
      ? data.epics
      : card.type === 'subtask'
        ? data.cards.filter((c) => c.type === 'card' && !c.archived && c.id !== card.id)
        : [];

  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 text-base">
      <Row label="Status">
        <Popover trigger={(p) => <Value {...p}>{status ? <StatusValue name={status.name} done={status.id === doneId} /> : <Empty />}</Value>}>
          <Menu>
            {project.columns.map((c) => (
              <MenuItem key={c.id} selected={c.id === card.status} onSelect={() => setStatus(c.id)}>
                {c.name}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </Row>

      <Row label="Priority">
        <Popover
          trigger={(p) => (
            <Value {...p}>
              {card.priority === 'none' ? (
                <Empty />
              ) : (
                <>
                  <PriorityIcon priority={card.priority} /> {PRIORITY_NAMES[card.priority]}
                </>
              )}
            </Value>
          )}
        >
          <Menu>
            {[...PRIORITIES].reverse().map((p) => (
              <MenuItem key={p} icon={<PriorityIcon priority={p} />} selected={p === card.priority} onSelect={() => update({ priority: p })}>
                {PRIORITY_NAMES[p]}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </Row>

      <Row label="Labels">
        <Popover
          className="w-64"
          trigger={(p) => (
            <Value {...p} wrap>
              {card.labels.length ? <LabelBadges names={card.labels} /> : <Empty />}
            </Value>
          )}
        >
          <LabelPicker labels={labels} selected={card.labels} onChange={(next) => update({ labels: next })} />
        </Popover>
      </Row>

      <Row label="Due date">
        <DateValue value={card.dueDate} overdueUnlessDone={card.status !== doneId} onChange={(d) => update({ dueDate: d })} />
      </Row>

      {card.type !== 'epic' && (
        <Row label={card.type === 'card' ? 'Epic' : 'Parent'}>
          <Popover
            className="w-72"
            trigger={(p) => (
              <Value {...p}>
                {parent ? (
                  parent.type === 'epic' ? (
                    <EpicTag id={parent.id} title={parent.title} />
                  ) : (
                    <span className="truncate">
                      <span className="mr-1.5 whitespace-nowrap font-mono text-xs text-fg-faint">{parent.key}</span>
                      {parent.title}
                    </span>
                  )
                ) : (
                  <Empty />
                )}
              </Value>
            )}
          >
            <CardPicker
              cards={parentOptions}
              selectedId={card.parentId}
              placeholder={card.type === 'card' ? 'Set epic…' : 'Set parent card…'}
              onSelect={(id) => update({ parentId: id })}
            />
          </Popover>
        </Row>
      )}

      {project.fields.map((f) => (
        <Row key={f.id} label={f.name}>
          <FieldEditor def={f} value={card.fields[f.key]} onChange={(v) => update({ fields: { [f.key]: v } })} />
        </Row>
      ))}

      <Row label="Created">
        <span className="flex h-7 items-center gap-1.5 px-2 text-fg-muted" title={absoluteTime(card.createdAt)}>
          <Avatar actor={card.createdBy} size={16} />
          <span className="truncate">
            {card.createdBy.name} · {relativeTime(card.createdAt)}
          </span>
        </span>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex h-7 items-center truncate text-fg-muted" title={label}>
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** The click target of a property: plain text until hovered. */
function Value({ children, wrap, ...props }: Partial<PopoverTriggerProps> & { children: ReactNode; wrap?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-fg hover:bg-hover',
        wrap && 'flex-wrap py-1',
      )}
    >
      {children}
    </button>
  );
}

function Empty({ text = 'Empty' }: { text?: string }) {
  return <span className="text-fg-faint">{text}</span>;
}

function StatusValue({ name, done }: { name: string; done: boolean }) {
  return (
    <>
      <CircleDot size="0.8125rem" className={done ? 'text-success' : 'text-fg-muted'} />
      <span className="truncate">{name}</span>
    </>
  );
}

function DateValue({
  value,
  onChange,
  overdueUnlessDone,
}: {
  value: string | undefined;
  onChange: (d: string | null) => void;
  overdueUnlessDone?: boolean;
}) {
  const overdue = overdueUnlessDone && value && value < today();
  return (
    <Popover
      className="p-2"
      trigger={(p) => (
        <Value {...p}>{value ? <span className={cx(overdue && 'text-danger')}>{formatDate(value)}</span> : <Empty />}</Value>
      )}
    >
      {({ close }) => (
        <div className="flex flex-col gap-2">
          <input
            type="date"
            autoFocus
            aria-label="Date"
            defaultValue={value ?? ''}
            onChange={(e) => {
              if (e.target.value) onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') close();
            }}
            className="h-7 rounded-md border border-line bg-surface px-2 text-base text-fg outline-none focus:border-accent"
          />
          <div className="flex gap-1">
            {(['Today', 'Tomorrow'] as const).map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + i);
                  onChange(d.toLocaleDateString('en-CA'));
                  close();
                }}
                className="h-6 flex-1 rounded-md text-sm text-fg-muted hover:bg-hover hover:text-fg"
              >
                {label}
              </button>
            ))}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  close();
                }}
                className="h-6 flex-1 rounded-md text-sm text-danger hover:bg-hover"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Editor for one custom field value; `null` removes the value. */
export function FieldEditor({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  onChange: (v: FieldValue | null) => void;
}) {
  switch (def.type) {
    case 'text':
      return <EditableText label={def.name} value={typeof value === 'string' ? value : ''} onCommit={(v) => onChange(v || null)} />;
    case 'number':
      return (
        <EditableText
          label={def.name}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onCommit={(v) => {
            if (!v) return onChange(null);
            const n = Number(v);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      );
    case 'url': {
      const url = typeof value === 'string' ? value : '';
      return (
        <div className="flex items-center gap-0.5">
          <EditableText label={def.name} type="url" value={url} placeholder="https://…" onCommit={(v) => onChange(v || null)} />
          {url && /^https?:\/\//i.test(url) && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${def.name}`}
              title="Open link"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <ExternalLink size="0.8125rem" />
            </a>
          )}
        </div>
      );
    }
    case 'checkbox':
      return (
        <label className="flex h-7 items-center px-2">
          <input
            type="checkbox"
            aria-label={def.name}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : null)}
            className="size-3.5 accent-[var(--accent)]"
          />
        </label>
      );
    case 'date':
      return <DateValue value={typeof value === 'string' ? value : undefined} onChange={onChange} />;
    case 'select': {
      const current = typeof value === 'string' ? value : undefined;
      return (
        <Popover trigger={(p) => <Value {...p}>{current ? <Badge>{current}</Badge> : <Empty />}</Value>}>
          <Menu>
            {(def.options ?? []).map((o) => (
              <MenuItem key={o} selected={o === current} onSelect={() => onChange(o === current ? null : o)}>
                {o}
              </MenuItem>
            ))}
            {!def.options?.length && <div className="px-2 py-1.5 text-sm text-fg-faint">No options (add them in settings)</div>}
            {current && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => onChange(null)}>Clear</MenuItem>
              </>
            )}
          </Menu>
        </Popover>
      );
    }
    case 'multiselect': {
      const current = Array.isArray(value) ? value : [];
      return (
        <Popover
          trigger={(p) => (
            <Value {...p} wrap>
              {current.length ? current.map((o) => <Badge key={o}>{o}</Badge>) : <Empty />}
            </Value>
          )}
        >
          <Menu>
            {(def.options ?? []).map((o) => {
              const on = current.includes(o);
              return (
                <MenuItem
                  key={o}
                  keepOpen
                  selected={on}
                  onSelect={() => {
                    const next = on ? current.filter((x) => x !== o) : [...current, o];
                    onChange(next.length ? next : null);
                  }}
                >
                  {o}
                </MenuItem>
              );
            })}
            {!def.options?.length && <div className="px-2 py-1.5 text-sm text-fg-faint">No options (add them in settings)</div>}
          </Menu>
        </Popover>
      );
    }
  }
}
