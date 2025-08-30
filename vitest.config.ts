/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Consolidated Vitest configuration that replaces all variants
// Environment-aware configuration for local development, CI, and parallel execution
export default defineConfig({
  plugins: [react()],

  // Cache directory for Vite/Vitest
  cacheDir: 'node_modules/.cache/vitest',

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './src/server'),
      '@tests': path.resolve(__dirname, './tests'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },

  test: {
    // Global test configuration
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/testSetup.ts'],

    // Test file patterns
    include: [
      'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/accessibility/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'tests/infrastructure/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],

    exclude: [
      'node_modules',
      'dist',
      'build',
      '.idea',
      '.git',
      '.cache',
      'playwright-report',
      '**/tests/integration/**', // Integration tests use Jest for now
      '**/tests/e2e/**', // E2E tests use Playwright
      '**/playwright/**',
      '**/*.d.ts',
      '**/*.config.*',
      '**/mockServiceWorker.js',
    ],

    // Environment-aware timeout configuration
    testTimeout: process.env.CI ? 30000 : 15000, // 30s in CI, 15s locally
    hookTimeout: process.env.CI ? 20000 : 10000, // 20s in CI, 10s locally

    // Pool configuration - optimized for environment
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
        useAtomics: !process.env.CI, // Disable atomics in CI for stability
        minThreads: 1,
        maxThreads: process.env.CI ? 2 : 4, // Limit threads in CI
      },
    },


    // Watch mode - disabled in CI
    watch: !process.env.CI,

    // Test isolation and parallel safety
    isolate: true,
    fileParallelism: !process.env.CI, // Disable file parallelism in CI
    passWithNoTests: true,

    // Environment-aware retry logic
    retry: process.env.CI ? 2 : 0,

    // Bail configuration - fail fast in CI
    bail: process.env.CI ? 1 : 0,

    // Sharding support for distributed testing
    ...(process.env.VITEST_SHARD && {
      shard: process.env.VITEST_SHARD,
    }),

    // Reporter configuration
    reporter: process.env.CI ? ['default', 'junit', 'json-summary'] : ['default', 'html'],

    outputFile: process.env.CI
      ? {
          junit: './test-results/junit.xml',
          'json-summary': './test-results/summary.json',
        }
      : undefined,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',

      // Coverage exclusions
      exclude: [
        'node_modules/',
        'tests/',
        'coverage/**',
        'dist/**',
        'build/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.test.*',
        '**/*.spec.*',
        '**/mockServiceWorker.js',
        'server.ts', // Legacy server file
        'scripts/**',
        'utils/**', // Root utils directory (legacy)
        'types/**', // Root types directory (legacy)
        'middleware/**', // Legacy middleware location
        'routes/**', // Legacy routes location
      ],

      // Coverage thresholds - environment aware
      thresholds: process.env.CI
        ? {
            lines: 75, // Stricter in CI
            functions: 75,
            branches: 75,
            statements: 75,
          }
        : {
            lines: 70, // More lenient locally
            functions: 70,
            branches: 70,
            statements: 70,
          },

      skipFull: false,
      clean: true,
      all: true,
      reportOnFailure: true,
    },

    // Environment variables for tests
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db',
      JWT_SECRET:
        process.env.JWT_SECRET ||
        'test-secret-key-for-development-environment-must-be-longer-than-32-characters',

      // Test-specific environment variables
      DISABLE_RATE_LIMIT_IN_TESTS: 'true',
      SKIP_ENV_VALIDATION: 'true',
      VALIDATE_TEST_ENV: process.env.CI ? 'false' : 'true',

      // CI detection
      CI: process.env.CI || 'false',
    },

    // CSS handling
    css: {
      modules: {
        classNameStrategy: 'non-scoped',
      },
    },

    // Server configuration for dependency handling
    server: {
      deps: {
        inline: ['@testing-library/jest-dom', 'jest-axe', /^@axe-core\/.*/],
      },
    },

    // Global definitions
    define: {
      global: 'globalThis',
    },

    // Log level - quieter in CI
    logLevel: process.env.CI ? 'error' : 'info',
    silent: false,

    // UI configuration (local development only)
    ui: !process.env.CI,
    open: !process.env.CI,
  },
});
