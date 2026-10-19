import { useState, type FormEvent } from 'react';
import { isProjectKey } from '@shared/keys';
import { createProject, useProjects } from '../data/projects';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

/** Suggests a key from a name: initials of the words, else its first letters. */
function suggestKey(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  return key.replace(/^[0-9]+/, '').slice(0, words.length > 1 ? 10 : 3);
}

export function NewProjectForm({ onCreated }: { onCreated: (key: string) => void }) {
  const { data: projects } = useProjects();
  const [name, setName] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveKey = key ?? suggestKey(name);

  // Live validation; createProject re-checks against the server.
  const keyProblem = !effectiveKey
    ? null
    : !isProjectKey(effectiveKey)
      ? 'Key: 2–10 letters or digits, starting with a letter'
      : projects.some((p) => p.key === effectiveKey)
        ? `Key ${effectiveKey} is already used`
        : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (keyProblem) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createProject({ key: effectiveKey, name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const message = error ?? (key !== null || name ? keyProblem : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex gap-2">
        <Input
          placeholder="KEY"
          aria-label="Project key"
          aria-invalid={Boolean(keyProblem)}
          aria-describedby={message ? 'new-project-error' : undefined}
          className="w-24 font-mono uppercase"
          maxLength={10}
          value={effectiveKey}
          onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
        <Button type="submit" variant="primary" className="flex-1" disabled={busy || !name.trim() || !effectiveKey || Boolean(keyProblem)}>
          {busy ? 'Creating…' : 'Create project'}
        </Button>
      </div>
      {message ? (
        <p id="new-project-error" className="text-sm text-danger">
          {message}
        </p>
      ) : (
        <p className="text-sm text-fg-faint">Cards will be keyed {effectiveKey || 'KEY'}-1, {effectiveKey || 'KEY'}-2, …</p>
      )}
    </form>
  );
}
