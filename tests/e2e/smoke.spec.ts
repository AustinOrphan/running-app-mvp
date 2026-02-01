import { test, expect } from '@austinorphan/e2e-core';

test.describe('Running App MVP Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check that the page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for authentication elements (login/signup or dashboard)
    const authElement = page.locator('text=Sign In, text=Sign Up, text=Dashboard').first();
    await expect(authElement).toBeVisible({ timeout: 10000 });
  });

  test('navigation is functional', async ({ page }) => {
    await page.goto('/');

    // Check for navigation elements
    const nav = page.locator('nav, header').first();
    await expect(nav).toBeVisible();
  });

  test('application responds to user interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the app has interactive elements
    const interactiveElements = page.locator('button, a, input').first();
    await expect(interactiveElements).toBeVisible();
  });
});
