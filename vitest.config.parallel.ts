/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Configuration for parallel test execution
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,

    // Parallel execution settings
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
        useAtomics: true,
        minThreads: 1,
        maxThreads: process.env.CI ? 2 : 4,
      },
    },

    // Isolation settings for parallel safety
    isolate: true,
    fileParallelism: true,

    // Test categorization
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      '**/node_modules/**',
      // Exclude database-dependent tests from parallel execution
      '**/*.db.test.{js,ts}',
      '**/*database*.test.{js,ts}',
      '**/*prisma*.test.{js,ts}',
      'tests/integration/**',
    ],

    // Coverage settings
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/*.test.*',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },

    // Reporter configuration
    reporters: process.env.CI ? ['default', 'junit', 'json'] : ['default', 'html'],
    outputFile: {
      junit: './test-results/junit.xml',
      json: './test-results/results.json',
      html: './test-results/index.html',
    },

    // Timeouts for parallel execution
    testTimeout: 10000,
    hookTimeout: 10000,

    // Retry logic for flaky tests in parallel
    retry: process.env.CI ? 2 : 0,

    // Sharding support for distributed testing
    ...(process.env.VITEST_SHARD && {
      shard: process.env.VITEST_SHARD,
    }),
  },
});
