import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useLocation } from 'react-router';

// Sidebar widths in rem, so they follow the UI size knob (src/index.css). 1rem = 16 design px.
export const SIDEBAR_MIN = 12.5; // 200 design px
export const SIDEBAR_MAX = 30; // 480
export const SIDEBAR_DEFAULT = 15; // 240
/** Dragging the resize handle this far left collapses the sidebar on release. */
export const SIDEBAR_SNAP = SIDEBAR_MIN - 4;
/** Room the expand button takes at the top-left of the main area while the sidebar is not docked. */
const GUTTER = '2rem';

export const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)) * 1000) / 1000;

const WIDTH_KEY = 'fira-sidebar-width';
const COLLAPSED_KEY = 'fira-sidebar-collapsed';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: remembered for this session only.
  }
}

function initialWidth(): number {
  const n = Number(readStored(WIDTH_KEY));
  return Number.isFinite(n) && n > 0 ? clampWidth(n) : SIDEBAR_DEFAULT;
}

const NARROW = '(max-width: 767.98px)';
function useNarrow(): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(NARROW);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => matchMedia(NARROW).matches,
  );
}

/** A popover (or dialog) portaled to <body> is open; the peeking sidebar must not vanish under it. */
const popoverOpen = () => document.querySelector('body > [role="dialog"]') !== null;

export interface SidebarController {
  /** Below 768px: the sidebar is an off-canvas drawer. */
  narrow: boolean;
  /** Width in rem (committed; drags write the CSS variable directly until pointerup). */
  width: number;
  /** Wide screen and not collapsed: the sidebar takes layout space. */
  docked: boolean;
  /** Narrow screen: the drawer is open. */
  drawerOpen: boolean;
  /** Collapsed on a wide screen, shown as a floating overlay while hovered. */
  peek: boolean;
  /** Use the floating (peek) geometry while collapsed. */
  floating: boolean;
  /** Value for the main area's `--shell-gutter` (room for the expand button). */
  gutter: string;
  /** The shell element carrying `--sidebar-w` (resize drags write it directly). */
  shellRef: RefObject<HTMLDivElement | null>;
  setWidth(w: number): void;
  expand(): void;
  collapse(): void;
  startPeek(): void;
  /** Pointer entered / left a peek surface (the sidebar, the expand button, the screen edge). */
  hover(inside: boolean, buttons?: number): void;
}

export const SidebarContext = createContext<SidebarController | null>(null);

export function useSidebar(): SidebarController {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar outside <Layout>');
  return ctx;
}

/** Moves focus to an element by id after the next render (when the toggle button it was on disappears). */
function refocus(id: string) {
  const had = document.activeElement;
  if (!had || had === document.body || !(had.id === 'sidebar-toggle' || had.id === 'sidebar-expand')) return;
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/** State behind the app shell's sidebar: width, collapsed, narrow-screen drawer, hover peek. Persists width + collapsed. */
export function useSidebarController(shellRef: RefObject<HTMLDivElement | null>): SidebarController {
  const narrow = useNarrow();
  const [width, setWidthState] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [floating, setFloating] = useState(false);

  // The drawer closes on navigation and when the screen widens.
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, narrow });
  if (seen.pathname !== pathname || seen.narrow !== narrow) {
    setSeen({ pathname, narrow });
    if (drawerOpen) setDrawerOpen(false);
    if (peek && narrow) setPeek(false);
  }

  useEffect(() => writeStored(WIDTH_KEY, String(width)), [width]);
  useEffect(() => writeStored(COLLAPSED_KEY, collapsed ? '1' : '0'), [collapsed]);

  // ---------------------------------------------------------------- peek (hover while collapsed)
  const hovering = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    const check = () => {
      if (hovering.current) return;
      if (popoverOpen()) hideTimer.current = setTimeout(check, 300);
      else setPeek(false);
    };
    hideTimer.current = setTimeout(check, 250);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const startPeek = useCallback(() => {
    hovering.current = true;
    clearTimeout(hideTimer.current);
    setPeek(true);
    setFloating(true);
  }, []);

  const hover = useCallback(
    (inside: boolean, buttons = 0) => {
      hovering.current = inside;
      if (inside) {
        clearTimeout(hideTimer.current);
      } else if (buttons !== 0) {
        // Left mid-drag (e.g. a docs-tree drag): decide once the button is released.
        document.addEventListener('pointerup', () => !hovering.current && scheduleHide(), { once: true });
      } else {
        scheduleHide();
      }
    },
    [scheduleHide],
  );

  // ---------------------------------------------------------------- expand / collapse
  const expand = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (narrow) setDrawerOpen(true);
    else {
      setCollapsed(false);
      setPeek(false);
      setFloating(false);
    }
    refocus('sidebar-toggle');
  }, [narrow]);

  const collapse = useCallback(() => {
    clearTimeout(hideTimer.current);
    hovering.current = false;
    if (narrow) setDrawerOpen(false);
    else {
      setCollapsed(true);
      setPeek(false);
      setFloating(false);
    }
    refocus('sidebar-expand');
  }, [narrow]);

  const setWidth = useCallback((w: number) => setWidthState(clampWidth(w)), []);

  // Escape closes the drawer (unless a popover inside it takes the key first).
  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || popoverOpen()) return;
      setDrawerOpen(false);
      requestAnimationFrame(() => document.getElementById('sidebar-expand')?.focus());
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [narrow, drawerOpen]);

  const docked = !narrow && !collapsed;
  return {
    narrow,
    width,
    docked,
    drawerOpen: narrow && drawerOpen,
    peek: !narrow && collapsed && peek,
    floating: !narrow && collapsed && floating,
    gutter: docked ? '0rem' : GUTTER,
    shellRef,
    setWidth,
    expand,
    collapse,
    startPeek,
    hover,
  };
}
