import { useSyncExternalStore } from 'react';

/**
 * "Install fira" (account menu; SPEC.md "Install"). Imported early (main.tsx) so `beforeinstallprompt`,
 * which can fire right after load, is never missed. Its default mini-infobar is suppressed: no banners,
 * only the menu item.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * How this browser installs the app, or null when it can't or already runs installed:
 * - `prompt`: Chromium fired `beforeinstallprompt`; `promptInstall()` shows its dialog.
 * - `ios`: iOS / iPadOS, no prompt API; the user adds it from the Share menu.
 */
export type InstallMethod = 'prompt' | 'ios' | null;

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const standaloneQuery = matchMedia('(display-mode: standalone)');
// iPadOS reports itself as a Mac; touch points tell it apart.
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  emit();
});
addEventListener('appinstalled', () => {
  deferred = null;
  emit();
});
standaloneQuery.addEventListener('change', emit);

/** Running as the installed app (Chromium/Android `display-mode`, iOS home-screen `navigator.standalone`). */
export function isStandalone(): boolean {
  return standaloneQuery.matches || (navigator as { standalone?: boolean }).standalone === true;
}

function method(): InstallMethod {
  if (isStandalone()) return null;
  if (deferred) return 'prompt';
  return IOS ? 'ios' : null;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useInstallMethod(): InstallMethod {
  return useSyncExternalStore(subscribe, method);
}

/** Shows the browser's install dialog. An event prompts once; the browser may fire a new one later. */
export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  emit();
  await e.prompt();
  await e.userChoice;
}
