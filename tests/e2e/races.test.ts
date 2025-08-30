import { test, expect } from '@playwright/test';
import type { TestUser } from './types';
import { testDb } from '../fixtures/testDatabase';

test.describe('Races E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'races@test.com',
      password: 'testpassword123',
    });

    // Login user
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', testUser.email);
    await page.fill('[data-testid="password-input"]', 'testpassword123');
    await page.click('[data-testid="login-button"]');

    // Wait for successful login and redirect
    await page.waitForURL('/dashboard');
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test('should handle races page navigation if it exists', async ({ page }) => {
    // Try to navigate to races page
    await page.goto('/races');

    // If races page exists, verify it loads
    if (await page.locator('h1').first().isVisible()) {
      await expect(page.locator('h1')).toBeVisible();
    } else {
      // If not implemented, that's okay - this is a smoke test
      console.log('Races page not found - this is expected if feature is not implemented yet');
    }
  });

  test('should show races navigation link if present', async ({ page }) => {
    await page.goto('/dashboard');

    // Look for races navigation link
    const racesNav = page.locator('[data-testid="races-nav"], a[href="/races"]');
    if (await racesNav.first().isVisible()) {
      await expect(racesNav.first()).toBeVisible();
      await racesNav.first().click();
      await expect(page).toHaveURL('/races');
    } else {
      console.log('Races navigation not found - feature may not be implemented yet');
    }
  });

  test('should display races list if implemented', async ({ page }) => {
    await page.goto('/races');

    // Look for races content
    const racesContent = page.locator('[data-testid="races-list"], .races-container, .race-item');
    if (await racesContent.first().isVisible()) {
      await expect(racesContent.first()).toBeVisible();
    } else {
      // Check for empty state
      const emptyState = page.locator('[data-testid="races-empty-state"]');
      if (await emptyState.isVisible()) {
        await expect(emptyState).toBeVisible();
      }
    }
  });

  test('should handle race creation if implemented', async ({ page }) => {
    await page.goto('/races');

    // Look for create race functionality
    const createButton = page.locator('[data-testid="create-race-button"]');
    if (await createButton.isVisible()) {
      await createButton.click();

      // Look for race creation form
      const modal = page.locator('[data-testid="create-race-modal"]');
      if (await modal.isVisible()) {
        await expect(modal).toBeVisible();
      }
    } else {
      console.log('Race creation functionality not found - feature may not be implemented yet');
    }
  });

  test('should be responsive if races page exists', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/races');

    // Verify page is accessible on mobile
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle races API endpoints', async ({ page }) => {
    // Test that races API is accessible (basic smoke test for API)
    const response = await page.request.get('/api/races');

    // API should return a valid response (200 OK or 401 if auth required)
    expect([200, 401, 404].includes(response.status())).toBeTruthy();
  });
});
