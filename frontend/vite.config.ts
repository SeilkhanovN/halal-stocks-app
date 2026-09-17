import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev-only proxy: forwards /api/* to the backend (Fastify on :3000 by
// default) and strips the /api prefix, so the frontend never needs CORS
// and always talks to the same origin. Override the target with
// VITE_API_PROXY_TARGET when the backend runs somewhere else.
const proxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
