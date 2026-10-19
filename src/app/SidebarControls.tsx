import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { remPx } from '../lib/rem';
import { clampWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_SNAP, useSidebar } from './sidebarState';

const KEY_STEP = 0.625; // rem (10 design px)
const designPx = (rem: number) => Math.round(rem * 16);

/**
 * Drag handle on the docked sidebar's right edge. While dragging it writes `--sidebar-w` on the shell
 * directly (no React render per move) and commits on release; past the snap point it collapses.
 */
export function ResizeHandle() {
  const { width, setWidth, collapse, shellRef } = useSidebar();
  const drag = useRef<{ x: number; start: number; rem: number; next: number; snap: boolean } | null>(null);

  const apply = (el: HTMLElement, w: number) => {
    shellRef.current?.style.setProperty('--sidebar-w', `${w}rem`);
    el.setAttribute('aria-valuenow', String(designPx(w)));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection, no focus jump
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: width, rem: remPx(), next: width, snap: false };
    const shell = shellRef.current;
    if (shell) shell.dataset.resizing = '';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.start + (e.clientX - d.x) / d.rem;
    const snap = raw < SIDEBAR_SNAP;
    if (snap !== d.snap) {
      d.snap = snap;
      if (snap) shellRef.current?.setAttribute('data-snap', '');
      else shellRef.current?.removeAttribute('data-snap');
    }
    d.next = clampWidth(raw);
    apply(e.currentTarget, d.next);
  };

  const onEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const shell = shellRef.current;
    if (shell) {
      delete shell.dataset.resizing;
      delete shell.dataset.snap;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (d.snap) {
      apply(e.currentTarget, d.start); // expanding again restores the width from before the drag
      collapse();
    } else {
      setWidth(d.next);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowLeft' ? width - KEY_STEP
      : e.key === 'ArrowRight' ? width + KEY_STEP
      : e.key === 'Home' ? SIDEBAR_MIN
      : e.key === 'End' ? SIDEBAR_MAX
      : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-controls="app-sidebar"
      aria-valuenow={designPx(width)}
      aria-valuemin={designPx(SIDEBAR_MIN)}
      aria-valuemax={designPx(SIDEBAR_MAX)}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onLostPointerCapture={onEnd}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      onKeyDown={onKeyDown}
      className="group/handle absolute inset-y-0 -right-0.75 z-10 w-1.5 cursor-col-resize touch-none outline-none"
    >
      <div
        className={
          'mx-auto h-full w-0.5 transition-colors delay-75 ' +
          'group-hover/handle:bg-line-strong group-focus-visible/handle:bg-accent group-data-resizing/shell:bg-accent group-data-resizing/shell:delay-0'
        }
      />
    </div>
  );
}

/** Top-left of the main area while the sidebar is not docked: opens it; hovering peeks (wide screens). */
export function ExpandButton() {
  const s = useSidebar();
  if (s.docked) return null;
  return (
    <IconButton
      id="sidebar-expand"
      label="Open sidebar"
      aria-expanded={s.drawerOpen}
      aria-controls="app-sidebar"
      className="absolute top-2 left-2 z-20"
      onClick={s.expand}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && e.buttons === 0 && !s.narrow) s.startPeek();
      }}
      onPointerLeave={(e) => s.hover(false, e.buttons)}
    >
      <PanelLeftOpen size="0.9375rem" />
    </IconButton>
  );
}

/** Invisible strip on the screen's left edge that peeks the collapsed sidebar. */
export function PeekEdge() {
  const s = useSidebar();
  return (
    <div
      aria-hidden
      className="fixed inset-y-0 left-0 z-30 w-1.5"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' && e.buttons === 0) s.startPeek();
      }}
      onPointerLeave={(e) => s.hover(false, e.buttons)}
    />
  );
}
