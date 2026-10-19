import type { ReactNode } from 'react';

/** A titled block of the card dialog. */
export function Section({ title, meta, action, children }: { title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex h-7 items-center gap-2 px-2">
        <h2 className="text-sm font-medium text-fg-muted">{title}</h2>
        {meta}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}
