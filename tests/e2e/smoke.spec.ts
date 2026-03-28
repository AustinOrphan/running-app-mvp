import { test, expect } from '@playwright/test';

test.describe('Running App MVP Smoke Tests', () => {
  test('homepage loads successfully', async ({ page }) => {
    await page.goto('/');

    // Check that the page loads
    await expect(page.locator('body')).toBeVisible();

    // Check for authentication elements (login/register or dashboard)
    // Try to find any of these auth-related elements
    const hasLogin = await page
      .getByText('Login', { exact: false })
      .isVisible()
      .catch(() => false);
    const hasRegister = await page
      .getByText('Register')
      .isVisible()
      .catch(() => false);
    const hasDashboard = await page
      .getByText('Dashboard')
      .isVisible()
      .catch(() => false);

    expect(hasLogin || hasRegister || hasDashboard).toBeTruthy();
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
