import { USE_EMULATORS } from './firebase';

/**
 * The app-shell service worker (built by vite-plugin-pwa, see vite.config.ts; SPEC.md "Install").
 * Production builds only, never against the emulators: there, and in dev, a worker left on this origin
 * (e.g. by `vite preview`) is removed so it can't serve a stale build.
 *
 * Updates: the worker skips waiting and claims open pages, so a deploy is live on the next launch or
 * reload without clearing anything. A page still running the old build may then ask for a lazy chunk
 * that is gone (the new precache dropped it, the new deploy doesn't serve it): Vite reports that as
 * `vite:preloadError`, and the page reloads once onto the new build.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD || USE_EMULATORS) {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(
      (reg) => {
        // An installed app can stay open for days: look for a new deploy whenever it comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      },
      (err: unknown) => console.warn('Service worker registration failed', err),
    );
  });
}

const RELOAD_KEY = 'fira:chunk-reload';
const RELOAD_WINDOW_MS = 10_000;

// A lazy chunk of a replaced build failed to load: reload once (not again within 10 s, so a chunk that
// is really broken surfaces as an error instead of a reload loop; without sessionStorage, never).
addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});
