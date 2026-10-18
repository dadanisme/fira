import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { errorMessage } from './format';

/**
 * Minimal error toasts for failed background writes. Mutations are optimistic and
 * nothing awaits them, so failures surface here instead of blocking the UI.
 */
interface Toast {
  id: number;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toastError(err: unknown) {
  console.error(err);
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message: errorMessage(err) }];
  emit();
  setTimeout(() => dismiss(id), 6000);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  if (list.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-[13px] shadow-popover">
          <span className="min-w-0 flex-1 text-danger">{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded text-fg-faint hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
