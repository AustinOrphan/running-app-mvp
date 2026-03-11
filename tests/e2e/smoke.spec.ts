import { test, expect } from '@playwright/test';

test.describe('Running App MVP Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check that the page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for authentication elements (login/signup or dashboard)
    // Try to find any of these auth-related elements
    const hasSignIn = await page
      .getByText('Sign In')
      .isVisible()
      .catch(() => false);
    const hasSignUp = await page
      .getByText('Sign Up')
      .isVisible()
      .catch(() => false);
    const hasDashboard = await page
      .getByText('Dashboard')
      .isVisible()
      .catch(() => false);

    expect(hasSignIn || hasSignUp || hasDashboard).toBeTruthy();
  });

  test('navigation is functional', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check for navigation elements
    const hasNav = await page
      .locator('nav')
      .isVisible()
      .catch(() => false);
    const hasHeader = await page
      .locator('header')
      .isVisible()
      .catch(() => false);

    expect(hasNav || hasHeader).toBeTruthy();
  });

  test('application responds to user interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the app has interactive elements
    const interactiveElements = page.locator('button, a, input').first();
    await expect(interactiveElements).toBeVisible();
  });
});
