import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin } from 'vite'

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

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDocs()],
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
})
