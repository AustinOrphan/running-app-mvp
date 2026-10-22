import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  plugins: [react()],
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
      '/api': 'http://localhost:3001',
    },
  },
})
