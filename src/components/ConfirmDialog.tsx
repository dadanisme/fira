import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode, type Ref } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Input } from './Input';

export interface ConfirmOptions {
  title: ReactNode;
  /** Explanation under the title. */
  body?: ReactNode;
  /** Label of the confirming button; default "Confirm". */
  confirmLabel?: string;
  /** Red confirm button (destructive actions). */
  danger?: boolean;
  /** The user must type this exactly (e.g. a workspace slug) before confirming. */
  typed?: string;
  /**
   * Runs on confirm while the dialog shows a busy state. A rejection keeps the dialog open
   * with the error message; success closes it. Without it the dialog closes at once.
   */
  onConfirm?: () => Promise<unknown>;
}

interface Pending extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

let current: Pending | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * In-app replacement for `window.confirm`: shows a modal and resolves to whether the user
 * confirmed (after `onConfirm` succeeded, when given). Needs a mounted `<ConfirmHost />`
 * (the app Layout has one). A second call while one is open cancels the first.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { ...options, id: nextId++, resolve };
    emit();
  });
}

function settle(id: number, confirmed: boolean) {
  if (current?.id !== id) return;
  current.resolve(confirmed);
  current = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Renders the dialog for `confirmAction`; mount once per screen. */
export function ConfirmHost() {
  const pending = useSyncExternalStore(subscribe, () => current);
  // Keep the last request rendered through the exit animation.
  const [shown, setShown] = useState<Pending | null>(null);
  if (pending && pending !== shown) setShown(pending);
  // Leaving the screen (unmount) cancels an open request.
  useEffect(() => () => current?.resolve(false), []);
  if (!shown) return null;
  return <ConfirmDialog key={shown.id} request={shown} open={pending === shown} onExited={() => setShown(null)} />;
}

function ConfirmDialog({ request: r, open, onExited }: { request: Pending; open: boolean; onExited: () => void }) {
  const titleId = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = r.typed === undefined || text === r.typed;
  const initial = useRef<HTMLElement>(null);

  // Dialog focuses its panel after our effects run; move focus to the field / button after it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => initial.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const cancel = () => {
    if (!busy) settle(r.id, false);
  };

  // Escape closes only this dialog, not a dialog under it (each Dialog listens on window).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!busy) settle(r.id, false);
    };
    addEventListener('keydown', onKeyDown, true);
    return () => removeEventListener('keydown', onKeyDown, true);
  }, [open, busy, r.id]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    if (!r.onConfirm) return settle(r.id, true);
    setBusy(true);
    setError(null);
    r.onConfirm().then(
      () => settle(r.id, true),
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };

  return (
    <Dialog open={open} onClose={cancel} onExited={onExited} labelledBy={titleId} className="max-sm:mt-auto max-sm:h-auto max-sm:rounded-t-xl sm:w-[26rem]">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <h2 id={titleId} className="text-md font-semibold">
          {r.title}
        </h2>
        {r.body && <div className="text-base text-fg-muted">{r.body}</div>}
        {r.typed !== undefined && (
          <label className="flex flex-col gap-1.5 text-sm text-fg-muted">
            <span>
              Type <span className="font-mono font-medium text-fg">{r.typed}</span> to confirm.
            </span>
            <Input
              ref={initial as Ref<HTMLInputElement>}
              aria-label={`Type ${r.typed} to confirm`}
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={r.danger ? 'danger' : 'primary'}
            disabled={!ready || busy}
            ref={r.typed === undefined ? (initial as Ref<HTMLButtonElement>) : undefined}
          >
            {busy ? 'Working…' : (r.confirmLabel ?? 'Confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
