import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Content-Security-Policy for the production bundle, injected as a <meta> at build time only. It mirrors the header the
 * RIPPLE server sends (ripple/server/app.py _SPA_CSP) so the SPA is protected even when served by another static host.
 * Dev is excluded on purpose: Vite's React-refresh preamble is an inline script and HMR needs a websocket, both of
 * which a strict policy would block. `frame-ancestors` is header-only and therefore omitted here.
 *   script-src 'self'          no inline / eval / remote scripts (the app has none; /boot.js is same-origin)
 *   style-src + 'unsafe-inline' framer-motion and React `style=` attributes; fonts CSS from Google Fonts
 *   connect-src 'self'         the only network calls are to /api
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

const cspPlugin = (): Plugin => ({
  name: 'ripple-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  },
})

export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5175,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: {
    outDir: '../ripple/server/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
})
