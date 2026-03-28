import { test, expect } from '@playwright/test';

test.describe('Running App MVP Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');

    // Check that the page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for authentication elements (login/register button or dashboard)
    // The page should have either auth buttons or be logged in with dashboard
    const hasLoginButton = await page
      .locator('button:has-text("Login")')
      .isVisible()
      .catch(() => false);
    const hasRegisterButton = await page
      .locator('button:has-text("Register")')
      .isVisible()
      .catch(() => false);
    const hasLoginHeading = await page
      .locator('h2:has-text("Login or Register")')
      .isVisible()
      .catch(() => false);

    expect(hasLoginButton || hasRegisterButton || hasLoginHeading).toBeTruthy();
  });

  test('navigation is functional', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Check for navigation or interactive elements on the page
    // On homepage (not logged in), there won't be a header, but there will be auth form
    const hasAuthForm = await page
      .locator('h2:has-text("Login or Register")')
      .isVisible()
      .catch(() => false);
    const hasButtons = await page
      .locator('button')
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasAuthForm || hasButtons).toBeTruthy();
  });

  test('application responds to user interaction', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check that the app has interactive elements
    const interactiveElements = page.locator('button, a, input').first();
    await expect(interactiveElements).toBeVisible();
  });
});
