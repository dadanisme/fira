import { useId, type ReactNode } from 'react';
import { Share, SquarePlus } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';

/** iOS / iPadOS have no install prompt: how to add fira from Safari's Share menu (SPEC.md "Install"). */
export function InstallDialog({ open, onClose, onExited }: { open: boolean; onClose(): void; onExited(): void }) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      labelledBy={titleId}
      sheet
      returnFocus={() => document.querySelector<HTMLElement>('button[aria-label="Account"]')}
      className="sm:w-[24rem]"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 id={titleId} className="text-md font-semibold">
          Install fira
        </h2>
        <p className="text-base text-fg-muted">Add fira to your Home Screen to open it like an app, full screen.</p>
        <ol className="flex flex-col gap-2 text-base">
          <Step n={1} icon={<Share size="1rem" />}>
            Tap <span className="font-medium">Share</span> in the browser toolbar.
          </Step>
          <Step n={2} icon={<SquarePlus size="1rem" />}>
            Choose <span className="font-medium">Add to Home Screen</span>, then <span className="font-medium">Add</span>.
          </Step>
        </ol>
        <div className="mt-1 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg bg-sunken px-3 py-2.5">
      <span className="w-3 shrink-0 text-sm text-fg-faint">{n}</span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface text-accent shadow-card">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
