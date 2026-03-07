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
    setupFiles: ['./tests/setup/testSetup.ts'],
    // Only include unit tests and accessibility tests
    // Exclude: E2E tests (Playwright), Jest integration tests, infrastructure tests (separate config)
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/accessibility/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**', // Playwright E2E tests
      'tests/integration/**', // Jest integration tests
      'tests/infrastructure/**', // Infrastructure tests (separate config)
      'tests/security.test.js', // Security tests need server
      'e2e/**', // Additional E2E directory
    ],
  },
});
