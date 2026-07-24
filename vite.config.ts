/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
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
    // Vitest runs the unit/component suite only. Everything that needs a real
    // database, a live server, or a different runner is kept out and run via
    // its own npm script:
    //  - packages/**: vendored backend-libs have their own vitest configs
    //  - tests/integration/**: Jest + provisioned SQLite DB (`test:integration`)
    //  - tests/e2e/** and e2e/**: Playwright suites (`test:e2e`)
    //  - tests/security.test.js: supertest API suite; needs config env + DB
    //  - tests/infrastructure/**: smoke tests needing live servers; run via
    //    `npm run test:infrastructure` (which sets VITEST_INCLUDE_INFRA=true)
    exclude: [
      ...configDefaults.exclude,
      'packages/**',
      'tests/integration/**',
      'tests/e2e/**',
      'e2e/**',
      'tests/security.test.js',
      ...(process.env.VITEST_INCLUDE_INFRA === 'true' ? [] : ['tests/infrastructure/**']),
    ],
  },
});
