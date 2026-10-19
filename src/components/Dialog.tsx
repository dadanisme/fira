import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';

export interface DialogProps {
  /** False plays the exit animation, then calls onExited (unmount the dialog there). */
  open: boolean;
  /** Escape, backdrop click. */
  onClose(): void;
  onExited?(): void;
  /** Id of the element naming the dialog. */
  labelledBy: string;
  /** Where focus goes on close; defaults to the element focused when the dialog opened. */
  returnFocus?(): HTMLElement | null | undefined;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

const EXIT_MS = 120;
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Text entry that Escape should leave before it closes the dialog. */
function isTextEntry(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|reset|file|range|color)$/.test(el.type);
}

/**
 * Modal dialog in a portal: dimmed backdrop, focus trap, body scroll lock, focus
 * restore. Escape closes it unless an inner control takes it first: popovers stop it
 * on document; inputs and editors preventDefault it (ProseMirror always does, so give
 * an editor an onCancel that leaves it); a focused text field that ignores Escape is
 * left (focus moves to the dialog) and a second Escape closes. Popovers opened from
 * inside portal in after the dialog, so they stack above it and may take focus.
 */
export function Dialog({ open, onClose, onExited, labelledBy, returnFocus, className, ref, children }: DialogProps) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, onExited, returnFocus });
  useLayoutEffect(() => {
    latest.current = { onClose, onExited, returnFocus };
  });

  useEffect(() => {
    if (open) return;
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS;
    const t = setTimeout(() => latest.current.onExited?.(), ms);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const p = panel.current;
    if (!open || !p) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    p.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    /** Portals opened after the dialog (popovers, menus) sit after it in the body. */
    const outside = (n: Node) => {
      const r = root.current;
      return !!r && !r.contains(n) && !(r.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    };

    // On window: popovers handle Escape on document and stop it there.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented || e.isComposing) return;
        if (isTextEntry(e.target) && p.contains(e.target)) {
          p.focus({ preventScroll: true });
          return;
        }
        latest.current.onClose();
      } else if (e.key === 'Tab') {
        const active = document.activeElement;
        // Focus in a popover portaled above the dialog: leave Tab to it.
        if (active && active !== document.body && !p.contains(active)) return;
        const items = [...p.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.getClientRects().length > 0);
        const first = items[0];
        const last = items[items.length - 1];
        const edge = !active || active === p || !p.contains(active) ? true : e.shiftKey ? active === first : active === last;
        if (!edge) return;
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && outside(e.target)) p.focus({ preventScroll: true });
    };
    // A field that blurs itself (e.g. on Escape) would drop focus to <body>; keep it in the dialog.
    let refocus: ReturnType<typeof setTimeout> | undefined;
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget || !(e.target instanceof Node) || !p.contains(e.target)) return;
      clearTimeout(refocus);
      refocus = setTimeout(() => {
        if (document.activeElement === document.body) p.focus({ preventScroll: true });
      });
    };
    addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      clearTimeout(refocus);
      removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.body.style.overflow = overflow;
      const target = latest.current.returnFocus?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  return createPortal(
    <div ref={root} inert={!open} className="fixed inset-0 z-40 flex justify-center sm:items-start sm:p-6 sm:pt-[7vh]">
      <div
        aria-hidden
        // A click fires here only if it also started here (not a drag out of the dialog).
        onClick={() => latest.current.onClose()}
        className={cx(
          'absolute inset-0 bg-overlay transition-opacity starting:opacity-0 motion-reduce:transition-none',
          open ? 'duration-150 ease-out' : 'opacity-0 duration-[120ms] ease-in',
        )}
      />
      <div
        ref={(el) => {
          panel.current = el;
          if (typeof ref === 'function') return ref(el);
          if (ref) ref.current = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          'relative flex h-dvh w-full flex-col bg-bg shadow-popover outline-none',
          'sm:h-auto sm:max-h-[calc(100dvh-7vh-1.5rem)] sm:rounded-xl',
          'transition-[opacity,translate,scale] motion-reduce:transition-none',
          'starting:translate-y-2 starting:opacity-0 sm:starting:translate-y-1 sm:starting:scale-[0.98]',
          open ? 'duration-150 ease-out' : 'translate-y-2 opacity-0 duration-[120ms] ease-in sm:translate-y-1 sm:scale-[0.98]',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
