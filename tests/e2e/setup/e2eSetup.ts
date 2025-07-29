/* eslint-disable react-hooks/rules-of-hooks */
/**
 * E2E Test Setup and Utilities
 * Provides common setup for all E2E tests
 */

import { test as base, expect } from '@playwright/test';
import { testDb } from '../../fixtures/testDatabase';

// Extend base test with custom fixtures
export const test = base.extend({
  // Auto-login fixture

  authenticatedPage: async ({ page }, use) => {
    // Create test user
    const testUser = await testDb.createTestUser({
      email: 'e2e-test@example.com',
      password: 'TestPassword123!',
    });

    // Login
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Wait for navigation
    await page.waitForURL('/dashboard');

    // Use the authenticated page
    await use(page);

    // Cleanup
    await testDb.cleanupDatabase();
  },

  // Database cleanup fixture

  dbCleanup: async ({}, use) => {
    // Setup
    await testDb.cleanupDatabase();

    // Use
    await use();

    // Teardown
    await testDb.cleanupDatabase();
  },
});

// Export expect for consistency
export { expect };

// Common selectors
export const selectors = {
  login: {
    emailInput: 'input[type="email"]',
    passwordInput: 'input[type="password"]',
    submitButton: 'button[type="submit"]',
  },
  navigation: {
    dashboard: 'a[href="/dashboard"], nav a:has-text("Dashboard")',
    runs: 'a[href="/runs"], nav a:has-text("Runs")',
    stats: 'a[href="/stats"], nav a:has-text("Stats")',
  },
  common: {
    heading: 'h1, h2',
    error: '[role="alert"], .error-message',
    loading: '.loading, [aria-busy="true"]',
  },
};

// Common assertions
export async function waitForPageReady(page: any) {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector(selectors.common.heading);
}

export async function expectNoAccessibilityViolations(page: any) {
  const AxeBuilder = await import('@axe-core/playwright').then(m => m.default);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}
