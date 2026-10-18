import { useEffect, useSyncExternalStore } from 'react';

/** Theme preference, persisted in localStorage. The resolved theme is set as <html data-theme>. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'fira-theme';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let preference = read();

function apply() {
  const dark = preference === 'dark' || (preference === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current preference; keeps <html data-theme> in sync with the OS while on 'system'. */
export function useThemePreference(): ThemePreference {
  useEffect(() => {
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return useSyncExternalStore(subscribe, () => preference);
}
