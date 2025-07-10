import { test, expect, devices } from '@playwright/test';
import type { TestUser } from './types';
import { assertTestUser } from './types/index.js';

import { mockRuns } from '../fixtures/mockData.js';
import { testDb } from '../fixtures/testDatabase.js';

// Define mobile device configurations with names
const mobileDevices = [
  { name: 'iPhone 12', config: devices['iPhone 12'] },
  { name: 'iPhone 12 Pro', config: devices['iPhone 12 Pro'] },
  { name: 'iPhone SE', config: devices['iPhone SE'] },
  { name: 'Pixel 5', config: devices['Pixel 5'] },
  { name: 'Galaxy S9+', config: devices['Galaxy S9+'] },
  { name: 'iPad', config: devices['iPad'] },
  { name: 'iPad Pro', config: devices['iPad Pro'] },
];

test.describe('Mobile Responsiveness E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page: _page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'mobile@test.com',
      password: 'testpassword123',
    });

    // Create test data
    await testDb.createTestRuns(assertTestUser(testUser).id, mockRuns.slice(0, 5));
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  // Test each mobile device configuration
  for (const device of mobileDevices) {
    test.describe(`${device.name} Tests`, () => {
      test.use({ ...device.config });

      test(`should display mobile-optimized layout on ${device.name}`, async ({ page }) => {
        await page.goto('/');

        // Check viewport is mobile-sized
        const viewport = page.viewportSize();
        expect(viewport).toBeTruthy();
        expect(viewport!.width).toBeLessThanOrEqual(1024);

        // Check that mobile navigation is present
        await expect(page.locator('[data-testid="mobile-nav"], .mobile-nav, nav')).toBeVisible();

        // Check that content is not horizontally scrollable
        const bodyScrollWidth = await page.evaluate(() => {
          return document.body.scrollWidth;
        });
        const viewportWidth = viewport!.width;
        expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 10); // Allow small tolerance
      });

      test(`should handle touch interactions on ${device.name}`, async ({ page }) => {
        // Login user first
        await page.goto('/login');
        await page.fill('input[type="email"]', assertTestUser(testUser).email);
        await page.fill('input[type="password"]', 'testpassword123');
        await page.tap('button[type="submit"]');
        await expect(page).toHaveURL('/dashboard');

        // Test touch interactions on navigation
        const navItems = page.locator('nav a, .nav-item');
        const navCount = await navItems.count();

        if (navCount > 0) {
          // Tap first navigation item
          await navItems.first().tap();

          // Ensure navigation worked
          await page.waitForLoadState('networkidle');
        }

        // Test touch interactions on buttons
        const buttons = page.locator('button:visible');
        const buttonCount = await buttons.count();

        if (buttonCount > 0) {
          const firstButton = buttons.first();

          // Check button is tappable (minimum 44px height for accessibility)
          const buttonBox = await firstButton.boundingBox();
          expect(buttonBox?.height).toBeGreaterThanOrEqual(44);
        }
      });

      test(`should display readable text on ${device.name}`, async ({ page }) => {
        await page.goto('/');

        // Check font sizes are appropriate for mobile
        const textElements = page.locator('p, span, div, h1, h2, h3, h4, h5, h6');
        const elementCount = await textElements.count();

        for (let i = 0; i < Math.min(elementCount, 10); i++) {
          const element = textElements.nth(i);
          const isVisible = await element.isVisible();

          if (isVisible) {
            const fontSize = await element.evaluate(el => {
              return window.getComputedStyle(el).fontSize;
            });

            const fontSizeValue = parseInt(fontSize.replace('px', ''));

            // Minimum font size should be 14px for readability on mobile
            expect(fontSizeValue).toBeGreaterThanOrEqual(14);
          }
        }
      });

      test(`should handle form inputs properly on ${device.name}`, async ({ page }) => {
        await page.goto('/login');

        // Test form input accessibility
        const emailInput = page.locator('input[type="email"]');
        const passwordInput = page.locator('input[type="password"]');

        // Check inputs are properly sized for touch
        const emailBox = await emailInput.boundingBox();
        const passwordBox = await passwordInput.boundingBox();

        expect(emailBox?.height).toBeGreaterThanOrEqual(44);
        expect(passwordBox?.height).toBeGreaterThanOrEqual(44);

        // Test that inputs work with touch
        await emailInput.tap();
        await emailInput.fill('test@example.com');
        await expect(emailInput).toHaveValue('test@example.com');

        await passwordInput.tap();
        await passwordInput.fill('password123');
        await expect(passwordInput).toHaveValue('password123');

        // Test form submission with touch
        const submitButton = page.locator('button[type="submit"]');
        await submitButton.tap();
      });
    });
  }

  test.describe('Mobile Navigation Tests', () => {
    test.use(devices['iPhone 12']);

    test('should provide mobile-friendly navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check for mobile navigation elements
      const mobileNavElements = [
        '[data-testid="mobile-menu"]',
        '.mobile-menu',
        '.hamburger',
        '[aria-label="Menu"]',
        'button[aria-expanded]',
      ];

      let hasMobileNav = false;
      for (const selector of mobileNavElements) {
        const element = page.locator(selector);
        if (await element.isVisible()) {
          hasMobileNav = true;
          break;
        }
      }

      // Should have some form of mobile navigation
      expect(hasMobileNav).toBe(true);
    });

    test('should handle navigation between pages smoothly', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Test navigation to different pages
      const navigationTests = [
        { path: '/runs', expectedText: 'Runs' },
        { path: '/stats', expectedText: 'Statistics' },
        { path: '/dashboard', expectedText: 'Dashboard' },
      ];

      for (const nav of navigationTests) {
        await page.goto(nav.path);
        await page.waitForLoadState('networkidle');

        // Check page loaded successfully
        await expect(page.locator('h1, h2')).toContainText(nav.expectedText);

        // Check page is responsive
        const viewport = page.viewportSize();
        const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
        expect(bodyScrollWidth).toBeLessThanOrEqual(viewport!.width + 10);
      }
    });
  });

  test.describe('Mobile Content Layout Tests', () => {
    test.use(devices['iPhone 12']);

    test('should display dashboard content properly on mobile', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check dashboard elements are visible and properly sized
      await expect(page.locator('h1, h2')).toBeVisible();

      // Check for mobile-optimized layout
      const contentElements = page.locator('[class*="grid"], [class*="flex"], .card, .widget');
      const elementCount = await contentElements.count();

      for (let i = 0; i < Math.min(elementCount, 5); i++) {
        const element = contentElements.nth(i);
        const isVisible = await element.isVisible();

        if (isVisible) {
          const elementBox = await element.boundingBox();
          const viewport = page.viewportSize();

          // Elements should not exceed viewport width
          expect(elementBox?.width).toBeLessThanOrEqual(viewport!.width);
        }
      }
    });

    test('should display runs list properly on mobile', async ({ page }) => {
      // Login and navigate to runs
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');

      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText('Runs');

      // Check runs are displayed in mobile-friendly format
      const runItems = page.locator('.run-item, [data-testid="run-item"]');
      const runCount = await runItems.count();

      if (runCount > 0) {
        // Check first run item is properly sized
        const firstRun = runItems.first();
        const runBox = await firstRun.boundingBox();
        const viewport = page.viewportSize();

        expect(runBox?.width).toBeLessThanOrEqual(viewport!.width);
        expect(runBox?.height).toBeGreaterThan(0);

        // Test interaction with run item
        await firstRun.tap();

        // Should open run details or navigate
        await page.waitForTimeout(500); // Wait for interaction
      }
    });

    test('should display statistics properly on mobile', async ({ page }) => {
      // Login and navigate to stats
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');

      await page.goto('/stats');
      await expect(page.locator('h1')).toContainText('Statistics');

      // Check charts and stats are mobile-optimized
      const chartElements = page.locator('[class*="chart"], [data-testid*="chart"], canvas, svg');
      const chartCount = await chartElements.count();

      for (let i = 0; i < Math.min(chartCount, 3); i++) {
        const chart = chartElements.nth(i);
        const isVisible = await chart.isVisible();

        if (isVisible) {
          const chartBox = await chart.boundingBox();
          const viewport = page.viewportSize();

          // Charts should be responsive and not overflow
          expect(chartBox?.width).toBeLessThanOrEqual(viewport!.width);
        }
      }
    });
  });

  test.describe('Mobile Performance Tests', () => {
    test.use(devices['iPhone 12']);

    test('should load pages quickly on mobile', async ({ page }) => {
      // Test page load performance
      const startTime = Date.now();

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const loadTime = Date.now() - startTime;

      // Page should load within reasonable time (adjust threshold as needed)
      expect(loadTime).toBeLessThan(5000); // 5 seconds
    });

    test('should handle rapid navigation without issues', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Rapidly navigate between pages
      const pages = ['/runs', '/stats', '/dashboard'];

      for (let i = 0; i < 3; i++) {
        for (const pagePath of pages) {
          await page.goto(pagePath);
          await page.waitForLoadState('domcontentloaded');

          // Check page loaded without errors
          await expect(page.locator('h1, h2')).toBeVisible();
        }
      }
    });
  });

  test.describe('Mobile Accessibility Tests', () => {
    test.use(devices['iPhone 12']);

    test('should have proper touch targets', async ({ page }) => {
      await page.goto('/');

      // Check all interactive elements have proper touch target size
      const interactiveElements = page.locator('button, a, input, [role="button"], [tabindex]');
      const elementCount = await interactiveElements.count();

      for (let i = 0; i < Math.min(elementCount, 10); i++) {
        const element = interactiveElements.nth(i);
        const isVisible = await element.isVisible();

        if (isVisible) {
          const elementBox = await element.boundingBox();

          // Touch targets should be at least 44x44 pixels
          if (elementBox) {
            expect(Math.min(elementBox.width, elementBox.height)).toBeGreaterThanOrEqual(44);
          }
        }
      }
    });

    test('should handle focus states properly', async ({ page }) => {
      await page.goto('/login');

      // Test keyboard/focus navigation
      const emailInput = page.locator('input[type="email"]');
      const passwordInput = page.locator('input[type="password"]');
      const submitButton = page.locator('button[type="submit"]');

      // Tab through form elements
      await emailInput.focus();
      await expect(emailInput).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(passwordInput).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(submitButton).toBeFocused();
    });

    test('should have proper contrast and visibility', async ({ page }) => {
      await page.goto('/');

      // Test that text is visible against backgrounds
      const textElements = page.locator('p, span, h1, h2, h3, h4, h5, h6');
      const elementCount = await textElements.count();

      for (let i = 0; i < Math.min(elementCount, 5); i++) {
        const element = textElements.nth(i);
        const isVisible = await element.isVisible();

        if (isVisible) {
          const styles = await element.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              fontSize: computed.fontSize,
            };
          });

          // Text should have color (not transparent)
          expect(styles.color).not.toBe('rgba(0, 0, 0, 0)');
          expect(styles.color).not.toBe('transparent');
        }
      }
    });
  });

  test.describe('Mobile Error Handling Tests', () => {
    test.use(devices['iPhone 12']);

    test('should handle network errors gracefully on mobile', async ({ page }) => {
      // Login user first
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Simulate network failure
      await page.route('**/*', route => route.abort());

      // Try to navigate to a page that requires data
      await page.goto('/stats');

      // Should show appropriate error message
      await expect(page.locator('text=error, text=failed, text=loading')).toBeVisible();
    });

    test('should handle touch events correctly during loading', async ({ page }) => {
      await page.goto('/login');

      // Fill form quickly and tap submit multiple times
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');

      const submitButton = page.locator('button[type="submit"]');

      // Tap multiple times quickly
      await submitButton.tap();
      await submitButton.tap();

      // Should handle multiple taps gracefully (button should be disabled during loading)
      const isDisabled = await submitButton.isDisabled();
      if (!isDisabled) {
        // If not disabled, should still handle gracefully without errors
        await page.waitForLoadState('networkidle');
      }
    });
  });

  test.describe('Mobile Form Interaction Tests', () => {
    test.use(devices['iPhone 12']);

    test('should handle form inputs with virtual keyboard', async ({ page }) => {
      await page.goto('/login');

      // Test email input with virtual keyboard
      const emailInput = page.locator('input[type="email"]');
      await emailInput.tap();

      // Virtual keyboard should trigger appropriate input type
      const inputType = await emailInput.getAttribute('inputmode');
      expect(inputType === 'email' || inputType === null).toBe(true);

      // Test typing
      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');

      // Test password input
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.tap();
      await passwordInput.fill('password123');
      await expect(passwordInput).toHaveValue('password123');
    });

    test('should handle add run form on mobile', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', assertTestUser(testUser).email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs and try to add a run
      await page.goto('/runs');

      // Look for add run button
      const addButtons = page.locator(
        'button:has-text("Add"), [aria-label*="Add"], .add-button, .fab'
      );
      const addButtonCount = await addButtons.count();

      if (addButtonCount > 0) {
        await addButtons.first().tap();

        // Should open add run form
        await expect(page.locator('input[name="distance"], input[name="duration"]')).toBeVisible();

        // Test form inputs work on mobile
        const distanceInput = page.locator('input[name="distance"]');
        if (await distanceInput.isVisible()) {
          await distanceInput.tap();
          await distanceInput.fill('5.2');
          await expect(distanceInput).toHaveValue('5.2');
        }
      }
    });
  });
});
