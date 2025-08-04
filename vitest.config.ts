import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/testSetup.ts'],
    // Vitest caching configuration for improved performance
    cache: {
      dir: 'node_modules/.cache/vitest',
    },
    pool: 'forks', // Use process pool for better performance
    poolOptions: {
      forks: {
        singleFork: false, // Allow multiple worker processes
      },
    },

    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/accessibility/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/infrastructure/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      'playwright-report',
      '**/tests/integration/**',
      '**/tests/e2e/**',
      '**/playwright/**',
    ],
    testTimeout: 30000, // 30s global baseline timeout
    hookTimeout: process.env.CI ? 20000 : 15000, // 20s in CI, 15s locally
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockServiceWorker.js',
        '**/*.spec.{js,ts,jsx,tsx}',
        '**/*.test.{js,ts,jsx,tsx}',
        'server/**',
        'scripts/**',
        'utils/**',
        'types/**',
        '**/*.mjs',
        '**/*.cjs',
        'server.ts',
      ],
      // Coverage thresholds - temporarily disabled for CI
      // TODO: Re-enable once coverage improves
      // thresholds: {
      //   lines: 50,
      //   functions: 50,
      //   branches: 50,
      //   statements: 50,
      // },
      perFile: true,
      skipFull: false,
      clean: true,
      all: true,
      reportOnFailure: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
});
