import { useState, type FormEvent } from 'react';
import { createProject } from '../data/projects';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

/** Suggests a key from a name: initials of the words, else its first letters. */
function suggestKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  return key.replace(/^[0-9]+/, '').slice(0, words.length > 1 ? 10 : 3);
}

export function NewProjectForm({ onCreated }: { onCreated: (key: string) => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveKey = key ?? suggestKey(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await createProject({ key: effectiveKey, name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Input autoFocus placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex gap-2">
        <Input
          placeholder="KEY"
          aria-label="Project key"
          className="w-24 font-mono uppercase"
          maxLength={10}
          value={effectiveKey}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
        />
        <Button type="submit" variant="primary" className="flex-1" disabled={busy || !name.trim() || !effectiveKey}>
          Create project
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
