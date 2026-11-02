import type { ReactNode } from 'react';

export function PageTitle({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="mt-0.5 text-fg-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** A titled group of settings. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-8">
      <div className="mb-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Bordered list container for rows. */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{children}</ul>;
}

export function SettingRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-10 flex-col gap-1 px-3 py-2 md:flex-row md:items-center md:gap-4 md:py-1.5">
      <div className="md:w-52 md:shrink-0">
        <div className="text-base text-fg">{label}</div>
        {hint && <div className="text-xs text-fg-faint">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-1 md:justify-end">{children}</div>
    </div>
  );
}
