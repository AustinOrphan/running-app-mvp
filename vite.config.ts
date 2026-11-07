import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { serviceWorkerPlugin } from './web/sw/buildSw.ts'
import { precompressPlugin } from './web/sw/precompress.ts'

export default defineConfig({
  root: 'web',
  // The service worker is written into the build after the bundle (ADR 0012); the compressed copies
  // come last, so they include the worker and the worker's file list does not.
  plugins: [react(), serviceWorkerPlugin(), precompressPlugin()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Vendor code in its own long-lived chunks keeps the entry chunk under 500 kB.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 3,
            },
            {
              name: 'charts',
              test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap)[\\/]/,
              priority: 2,
            },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        // The root is `web/`, so the data hooks under `web/api/` are requested as `/api/<name>.ts`
        // in development; those are source modules for Vite, not calls for the server.
        bypass: (req) => (/\.tsx?(\?|$)/.test(req.url ?? '') ? req.url : undefined),
      },
    },
  },
})
