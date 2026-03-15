/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Configuration for infrastructure/integration tests
// These tests spawn real Node processes and need real fetch/network access
export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Use node environment, not jsdom
    include: ['tests/infrastructure/**/*.test.ts'],
    // No setupFiles - we don't want the mocked fetch from testSetup.ts
  },
});
