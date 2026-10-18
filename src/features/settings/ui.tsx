import type { ReactNode } from 'react';

export function PageTitle({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[16px] font-semibold">{title}</h1>
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
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {description && <p className="text-xs text-fg-muted">{description}</p>}
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
    <div className="flex min-h-10 items-center gap-4 px-3 py-1.5">
      <div className="w-52 shrink-0">
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="text-[11px] text-fg-faint">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}
