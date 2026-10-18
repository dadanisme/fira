import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';

export interface PopoverTriggerProps {
  ref: RefCallback<HTMLElement>;
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog';
}

export interface PopoverProps {
  /** Renders the trigger; spread the props onto a button (e.g. `<Button {...props}>`). */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Panel content; a function receives `close`. */
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  placement?: 'bottom-start' | 'bottom-end';
  /** Controlled mode (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const PopoverContext = createContext<(() => void) | null>(null);

/** Closes the nearest enclosing Popover (no-op outside one). */
export function usePopoverClose(): () => void {
  return useContext(PopoverContext) ?? noop;
}

function noop() {}

const GAP = 4;
const MARGIN = 8;

/**
 * Anchored floating panel rendered in a portal (never clipped by scroll containers).
 * Closes on outside pointer down and Escape. Nested popovers work: clicks inside a
 * child portal count as inside (React events bubble through portals).
 */
export function Popover({ trigger, children, placement = 'bottom-start', open: openProp, onOpenChange, className }: PopoverProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const insidePointer = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const { offsetWidth: w, offsetHeight: h } = p;
    const fitsBelow = a.bottom + GAP + h <= innerHeight - MARGIN;
    const top = fitsBelow || a.top - GAP - h < MARGIN ? a.bottom + GAP : a.top - GAP - h;
    const left = placement === 'bottom-end' ? a.right - w : a.left;
    setPos({ top, left: Math.max(MARGIN, Math.min(left, innerWidth - w - MARGIN)) });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const inside = insidePointer.current || anchor.current?.contains(e.target as Node);
      insidePointer.current = false;
      if (!inside) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return (
    <>
      {trigger({
        ref: (el) => {
          anchor.current = el;
        },
        onClick: () => setOpen(!open),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
      })}
      {open &&
        createPortal(
          <PopoverContext.Provider value={close}>
            <div
              ref={panel}
              role="dialog"
              onPointerDown={() => (insidePointer.current = true)}
              className={cx('fixed z-50 min-w-40 rounded-lg bg-surface text-fg shadow-popover', className)}
              style={pos ?? { top: 0, left: 0, opacity: 0 }}
            >
              {typeof children === 'function' ? children({ close }) : children}
            </div>
          </PopoverContext.Provider>,
          document.body,
        )}
    </>
  );
}
