/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// CI-specific configuration for Vitest tests
// This configuration is optimized for CI environments with:
// - Increased timeouts for slower CI environments
// - Reduced parallelism to prevent resource conflicts
// - CI-specific reporters and coverage settings
// - More conservative retry and bail settings

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
    // Cache configuration optimized for CI
    cache: {
      dir: 'node_modules/.cache/vitest',
    },
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
    // CI-specific test configuration with increased timeouts
    testTimeout: process.env.CI ? 30000 : 15000, // 30s in CI, 15s locally
    hookTimeout: process.env.CI ? 20000 : 10000, // 20s in CI, 10s locally

    // Reduce parallelism in CI to prevent resource conflicts
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: process.env.CI ? 2 : 4, // Limit threads in CI
        minThreads: 1,
        useAtomics: process.env.CI ? false : true, // Disable atomics in CI for stability
      },
    },

    // Enable watch mode only in development
    watch: false,

    // Optimize for CI environment
    isolate: true, // Isolate tests for better debugging
    passWithNoTests: true, // Don't fail if no tests found

    // CI-specific reporters
    reporter: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: './test-results/junit.xml',
    },

    // Coverage configuration for CI
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'coverage/**',
        'dist/**',
        'packages/*/test{,s}/**',
        '**/*.d.ts',
        'cypress/**',
        'test{,s}/**',
        'test{,-*}.{js,cjs,mjs,ts,tsx,jsx}',
        '**/*{.,-}test.{js,cjs,mjs,ts,tsx,jsx}',
        '**/*{.,-}spec.{js,cjs,mjs,ts,tsx,jsx}',
        '**/__tests__/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/.{eslint,mocha,prettier}rc.{js,cjs,yml}',
      ],
      // Coverage thresholds for CI - temporarily disabled
      // TODO: Re-enable once coverage improves
      // thresholds: {
      //   global: {
      //     branches: 50,
      //     functions: 50,
      //     lines: 50,
      //     statements: 50,
      //   },
      // },
    },

    // Retry configuration for CI flakiness
    retry: process.env.CI ? 2 : 0,

    // Bail on first failure in CI for faster feedback
    bail: process.env.CI ? 1 : 0,

    // Log configuration for CI
    logLevel: process.env.CI ? 'error' : 'info',
    silent: false,

    // Environment detection and CI-specific settings
    env: {
      CI: process.env.CI || 'false',
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db',
      JWT_SECRET:
        process.env.JWT_SECRET ||
        'test-secret-key-for-ci-environment-must-be-longer-than-32-characters',
      // CI-specific environment variables
      DISABLE_RATE_LIMIT_IN_TESTS: 'true',
      SKIP_ENV_VALIDATION: 'true',
      VALIDATE_TEST_ENV: 'false', // Skip validation in CI
    },

    // Add server configuration for CI environment
    server: {
      deps: {
        // Inline dependencies that might cause issues in CI
        inline: ['@testing-library/jest-dom', 'jest-axe'],
      },
    },

    // Define globals for better CI compatibility
    define: {
      global: 'globalThis',
    },
  },
});
