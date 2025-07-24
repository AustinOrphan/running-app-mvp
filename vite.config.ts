/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts', './tests/setup/testSetup.ts'],
    include: [
      'tests/unit/**/*.{test,spec}.{js,ts,tsx}',
      'tests/accessibility/**/*.{test,spec}.{js,ts,tsx}',
      'tests/infrastructure/**/*.{test,spec}.{js,ts,tsx}',
      'src/**/*.{test,spec}.{js,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/tests/e2e/**',
      '**/tests/integration/**',
      '**/playwright/**',
      '**/playwright-tests/**',
    ],
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },
    // CSS imports are handled by the CSS modules configuration above
  },
});
