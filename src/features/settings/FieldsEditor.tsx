import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash, X } from 'lucide-react';
import { FIELD_TYPES, type FieldDef, type FieldType, type Project } from '@shared/types';
import { newFieldDef, updateProject } from '../../data/projects';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { run } from '../board/context';
import { EditableText } from '../board/panel/EditableText';
import { RowList, SettingsSection } from './ui';
import { confirmAction } from '../../components/ConfirmDialog';

const TYPE_NAMES: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multiselect: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
};

const hasOptions = (t: FieldType) => t === 'select' || t === 'multiselect';

/** `Story points` → `storyPoints`, unique among `taken`. */
function fieldKey(name: string, taken: readonly string[]): string {
  const words = name.normalize('NFKD').replace(/[^\w\s]/g, ' ').trim().split(/[\s_]+/).filter(Boolean);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!/^[a-z]/.test(base)) base = `field${base ? base[0].toUpperCase() + base.slice(1) : ''}`;
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}${n}`;
  return key;
}

export function FieldsEditor({ project }: { project: Project }) {
  const fields = project.fields;
  const save = (next: FieldDef[]) => run(() => updateProject(project.id, { fields: next }));
  const patch = (id: string, p: Partial<FieldDef>) => save(fields.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const move = (i: number, d: number) => {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    save(next);
  };

  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const def = newFieldDef({ name: n, key: fieldKey(n, fields.map((f) => f.key)), type, ...(hasOptions(type) && { options: [] }) });
    setName('');
    save([...fields, def]);
  };

  return (
    <SettingsSection title="Custom fields" description="Shown on every card of this project. The key is used by the API (fields.<key>).">
      {fields.length > 0 ? (
        <RowList>
          {fields.map((f, i) => (
            <li key={f.id} className="flex flex-col gap-1 px-1.5 py-1.5">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <EditableText label="Field name" value={f.name} allowEmpty={false} onCommit={(n) => patch(f.id, { name: n.trim() })} />
                </div>
                <code className="shrink-0 px-1 text-xs text-fg-faint" title="API key">
                  {f.key}
                </code>
                <Select
                  aria-label={`${f.name} type`}
                  className="w-32"
                  value={f.type}
                  onChange={(e) => {
                    const t = e.target.value as FieldType;
                    if (t === f.type) return;
                    void confirmAction({
                      title: `Change “${f.name}” to ${TYPE_NAMES[t]}?`,
                      body: "Existing values that don't fit will look empty.",
                      confirmLabel: 'Change type',
                    }).then((ok) => ok && patch(f.id, { type: t, ...(hasOptions(t) && { options: f.options ?? [] }) }));
                  }}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_NAMES[t]}
                    </option>
                  ))}
                </Select>
                <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size="0.75rem" />
                </IconButton>
                <IconButton label="Move down" size="sm" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size="0.75rem" />
                </IconButton>
                <IconButton
                  label={`Delete ${f.name}`}
                  className="hover:text-danger"
                  onClick={() =>
                    void confirmAction({
                      title: `Delete field “${f.name}”?`,
                      body: 'Values stay on cards but are no longer shown.',
                      confirmLabel: 'Delete',
                      danger: true,
                    }).then((ok) => ok && save(fields.filter((x) => x.id !== f.id)))
                  }
                >
                  <Trash size="0.8125rem" />
                </IconButton>
              </div>
              {hasOptions(f.type) && <OptionsEditor options={f.options ?? []} onChange={(options) => patch(f.id, { options })} />}
            </li>
          ))}
        </RowList>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-fg-faint">No custom fields yet</p>
      )}
      <form onSubmit={add} className="mt-2 flex gap-2">
        <Input aria-label="New field name" placeholder="New field" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        <Select aria-label="New field type" className="w-32" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t]}
            </option>
          ))}
        </Select>
        <Button type="submit" icon={<Plus size="0.8125rem" />} disabled={!name.trim()}>
          Add field
        </Button>
      </form>
    </SettingsSection>
  );
}

/** Chips for select options: Enter adds, × removes, Backspace on empty input removes the last. */
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState('');
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = text.trim();
      if (v && !options.includes(v)) onChange([...options, v]);
      setText('');
    } else if (e.key === 'Backspace' && !text && options.length) {
      onChange(options.slice(0, -1));
    }
  };
  return (
    <div className="ml-2 flex flex-wrap items-center gap-1 pb-0.5">
      <span className="mr-1 text-xs text-fg-faint">Options</span>
      {options.map((o) => (
        <span key={o} className="inline-flex h-5 items-center gap-0.5 rounded bg-sunken pr-0.5 pl-1.5 text-xs text-fg">
          {o}
          <button type="button" aria-label={`Remove option ${o}`} onClick={() => onChange(options.filter((x) => x !== o))} className="rounded text-fg-faint hover:text-fg">
            <X size="0.6875rem" />
          </button>
        </span>
      ))}
      <input
        aria-label="Add option"
        placeholder={options.length ? 'Add…' : 'Type an option, Enter'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-5 w-32 rounded bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-faint focus:bg-hover"
      />
    </div>
  );
}
