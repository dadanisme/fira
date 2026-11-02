import { useMemo, useSyncExternalStore } from 'react';

/** Below the `md` breakpoint (768px): the phone layout. */
export const NARROW = '(max-width: 47.999rem)';
/** Devices without hover (phones, tablets); the `touch:` Tailwind variant. */
/** Below `sm` (640px): where dialogs go full-screen. */
export const PHONE = '(max-width: 39.999rem)';
export const NO_HOVER = '(hover: none)';

/** Whether a media query matches, live. Prefer `md:` / `touch:` classes; use this only where behavior differs. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const mql = matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
