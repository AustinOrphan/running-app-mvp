/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import os from 'os';

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
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          charts: ['recharts'],
        },
        // Enhanced chunk size warnings aligned with performance-thresholds.json
        chunkFileNames: '[name]-[hash].js',
        entryFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash].[ext]',
      },
      // Bundle size tracking and warnings
      onwarn(warning, warn) {
        // Warn for large bundles based on performance thresholds
        if (warning.code === 'BUNDLE_SIZE_WARNING') {
          console.warn('⚠️  Bundle size warning:', warning.message);
        }
        warn(warning);
      },
    },
    reportCompressedSize: true,
    // Bundle size limits (in KB) aligned with performance-thresholds.json
    chunkSizeWarningLimit: 1073, // ~1MB (1073 KB = 1,100,000 bytes warning threshold)
    assetsInlineLimit: 8192, // 8KB inline limit for assets
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [
      path.resolve(__dirname, './vitest.setup.ts'),
      path.resolve(__dirname, './tests/setup/testSetup.ts'),
    ],
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

    // Parallel execution settings for improved performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
        useAtomics: true,
        minThreads: 1,
        maxThreads: process.env.CI ? 2 : Math.max(1, Math.floor(os.cpus().length / 2)),
      },
    },

    // Isolation settings for parallel safety
    isolate: true,
    fileParallelism: true,

    // Timeout configuration with CI awareness
    testTimeout: process.env.CI ? 30000 : 10000, // 30s in CI, 10s locally
    hookTimeout: process.env.CI ? 20000 : 5000, // 20s in CI, 5s locally

    // Retry logic for flaky tests in parallel
    retry: process.env.CI ? 2 : 0,
  },
});
