import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Serves the static API reference (public/docs/api/index.html) at `/docs/api` in dev and preview, like vercel.json. */
function apiDocs(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const url = req.url ?? ''
    const q = url.indexOf('?')
    if ((q < 0 ? url : url.slice(0, q)) === '/docs/api') req.url = `/docs/api/index.html${q < 0 ? '' : url.slice(q)}`
    next()
  }
  return {
    name: 'fira-api-docs',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

/**
 * Installable app (SPEC.md "Install"): web manifest + a service worker that precaches the built app shell
 * (index.html, every JS/CSS chunk incl. lazy routes, icons) and nothing else. No runtime caching: Firestore,
 * Storage, Google and the API always go to the network. Only built (never in dev); registered by
 * src/lib/serviceWorker.ts, which skips it against the emulators.
 */
function pwa() {
  return VitePWA({
    injectRegister: false,
    registerType: 'autoUpdate',
    includeManifestIcons: false, // public/ icons are in globPatterns already
    manifest: {
      name: 'fira',
      short_name: 'fira',
      description: 'Kanban board and docs',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      // The light --bg token (src/index.css); the manifest needs literal colors.
      theme_color: '#ffffff',
      background_color: '#ffffff',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // The static API reference is a separate page, not part of the app shell.
      globIgnores: ['docs/**'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      // Every app URL renders index.html (vercel.json's SPA rewrite), except the API, Firebase's auth
      // handler paths and the API reference. Cross-origin requests never match a precache or this route.
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/__\//, /^\/docs\/api(\/|$)/],
      // A new deploy takes over at once; src/lib/serviceWorker.ts reloads a page whose lazy chunk is gone.
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      runtimeCaching: [],
    },
  })
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), apiDocs(), pwa()],
  // Emulator mode (npm run dev:emu): the API runs locally (scripts/dev-emu-api.ts) against the emulators.
  server: ['1', 'true'].includes(loadEnv(mode, process.cwd(), '').VITE_USE_EMULATORS ?? '')
    ? { proxy: { '/api': 'http://127.0.0.1:3100' } }
    : undefined,
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  build: {
    // Firebase dominates the bundle; a separate chunk caches across app deploys.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/]@?firebase/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
}))
