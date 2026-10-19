import { useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '../../components/Button';

/** A button that asks inline ("Delete forever?" Confirm / Cancel) before acting. */
export function ConfirmButton({
  onConfirm,
  question,
  confirmLabel = 'Confirm',
  children,
  ...rest
}: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; question: ReactNode; confirmLabel?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button {...rest} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-fg-muted">{question}</span>
      <Button
        size={rest.size}
        variant="danger"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={rest.size} variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
