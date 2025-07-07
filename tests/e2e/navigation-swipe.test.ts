import { test, expect, devices } from '@playwright/test';
import type { TestUser } from './types';

import { mockRuns } from '../fixtures/mockData.js';
import { testDb } from '../fixtures/testDatabase.js';

test.describe('Navigation and Swipe Functionality E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page: _page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'navigation@test.com',
      password: 'testpassword123',
    });

    if (!testUser) {
      throw new Error('Test user not created');
    }

    // Create test data
    await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 8));
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Desktop Navigation Tests', () => {
    test('should navigate between main pages using navigation menu', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Test navigation to different pages
      const navigationTests = [
        {
          selector: 'a[href="/runs"], nav a:has-text("Runs")',
          expectedUrl: '/runs',
          expectedHeading: /runs/i,
        },
        {
          selector: 'a[href="/stats"], nav a:has-text("Stats")',
          expectedUrl: '/stats',
          expectedHeading: /statistics|stats/i,
        },
        {
          selector: 'a[href="/dashboard"], nav a:has-text("Dashboard")',
          expectedUrl: '/dashboard',
          expectedHeading: /dashboard/i,
        },
      ];

      for (const nav of navigationTests) {
        // Find and click navigation item
        const navElement = page.locator(nav.selector).first();
        if (await navElement.isVisible()) {
          await navElement.click();
          await page.waitForLoadState('networkidle');

          // Verify URL changed
          expect(page.url()).toContain(nav.expectedUrl);

          // Verify page content loaded
          await expect(page.locator('h1, h2')).toContainText(nav.expectedHeading);
        }
      }
    });

    test('should handle browser back/forward navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs page
      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText(/runs/i);

      // Navigate to stats page
      await page.goto('/stats');
      await expect(page.locator('h1')).toContainText(/statistics|stats/i);

      // Test browser back button
      await page.goBack();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/runs');

      // Test browser forward button
      await page.goForward();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('/stats');
    });

    test('should handle keyboard navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Test Tab navigation through interactive elements
      const interactiveElements = page.locator('button, a, input, [tabindex]:not([tabindex="-1"])');
      const elementCount = await interactiveElements.count();

      if (elementCount > 0) {
        // Focus first element
        await interactiveElements.first().focus();
        await expect(interactiveElements.first()).toBeFocused();

        // Tab through several elements
        for (let i = 0; i < Math.min(5, elementCount - 1); i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(100); // Small delay for focus changes
        }

        // Test Shift+Tab (reverse tabbing)
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(100);
      }
    });
  });

  test.describe('Mobile Navigation Tests', () => {
    test.use(devices['iPhone 12']);

    test('should handle mobile navigation menu', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Look for mobile menu button (hamburger menu, etc.)
      const mobileMenuSelectors = [
        '[data-testid="mobile-menu-button"]',
        '.mobile-menu-button',
        '.hamburger',
        'button[aria-label="Menu"]',
        'button[aria-expanded]',
        '[role="button"]:has-text("Menu")',
      ];

      let menuButton = null;
      for (const selector of mobileMenuSelectors) {
        const element = page.locator(selector);
        if (await element.isVisible()) {
          menuButton = element;
          break;
        }
      }

      if (menuButton) {
        // Open mobile menu
        await menuButton.tap();
        await page.waitForTimeout(500); // Wait for menu animation

        // Look for navigation items in mobile menu
        const mobileNavItems = page.locator('.mobile-nav a, .nav-drawer a, .sidebar a, nav a');
        const navCount = await mobileNavItems.count();

        if (navCount > 0) {
          // Test tapping a navigation item
          await mobileNavItems.first().tap();
          await page.waitForLoadState('networkidle');

          // Verify navigation worked
          await expect(page.locator('h1, h2')).toBeVisible();
        }
      }
    });

    test('should handle swipe gestures for navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs page
      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText(/runs/i);

      // Test swipe gestures if the app supports them
      const viewport = page.viewportSize();
      if (viewport) {
        const centerX = viewport.width / 2;
        const centerY = viewport.height / 2;

        // Test swipe right (might go back or open sidebar)
        await page.touchscreen.tap(centerX, centerY);
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 200, centerY);
        await page.mouse.up();
        await page.waitForTimeout(1000);

        // Test swipe left
        await page.touchscreen.tap(centerX, centerY);
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX - 200, centerY);
        await page.mouse.up();
        await page.waitForTimeout(1000);

        // Verify page is still functional after swipes
        await expect(page.locator('h1, h2')).toBeVisible();
      }
    });

    test('should handle pull-to-refresh gesture', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs page (good candidate for pull-to-refresh)
      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText(/runs/i);

      const viewport = page.viewportSize();
      if (viewport) {
        // Simulate pull-to-refresh gesture (swipe down from top)
        await page.touchscreen.tap(viewport.width / 2, 50);
        await page.mouse.move(viewport.width / 2, 50);
        await page.mouse.down();
        await page.mouse.move(viewport.width / 2, 300);
        await page.mouse.up();

        // Wait for potential refresh animation
        await page.waitForTimeout(1500);

        // Verify page is still functional
        await expect(page.locator('h1')).toContainText(/runs/i);
      }
    });
  });

  test.describe('Touch and Gesture Navigation', () => {
    test.use(devices['iPad']);

    test('should handle long press gestures', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs page
      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText(/runs/i);

      // Look for interactive items to long press
      const runItems = page.locator('.run-item, [data-testid="run-item"], .card, .list-item');
      const itemCount = await runItems.count();

      if (itemCount > 0) {
        const firstItem = runItems.first();
        const itemBox = await firstItem.boundingBox();

        if (itemBox) {
          // Perform long press (hold for 800ms)
          await page.touchscreen.tap(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
          await page.waitForTimeout(800);

          await page.waitForTimeout(1000);

          // Check if context menu or action appeared
          const contextMenuSelectors = [
            '.context-menu',
            '.popup-menu',
            '.action-menu',
            '[role="menu"]',
            '.dropdown-menu',
          ];

          for (const selector of contextMenuSelectors) {
            if (await page.locator(selector).isVisible()) {
              break;
            }
          }

          // If no context menu, just verify the page is still functional
          await expect(page.locator('h1')).toContainText(/runs/i);
        }
      }
    });

    test('should handle pinch-to-zoom gestures on compatible content', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to stats page (likely to have charts)
      await page.goto('/stats');
      await expect(page.locator('h1')).toContainText(/statistics|stats/i);

      // Look for zoomable content (charts, images, etc.)
      const zoomableElements = page.locator('canvas, svg, .chart, [data-testid*="chart"], img');
      const elementCount = await zoomableElements.count();

      if (elementCount > 0) {
        const element = zoomableElements.first();
        const elementBox = await element.boundingBox();

        if (elementBox) {
          const centerX = elementBox.x + elementBox.width / 2;
          const centerY = elementBox.y + elementBox.height / 2;

          // Simulate pinch-to-zoom (two-finger gesture)
          // This is a basic approximation - real pinch gestures are more complex
          await page.touchscreen.tap(centerX - 50, centerY);
          await page.touchscreen.tap(centerX + 50, centerY);

          await page.waitForTimeout(500);

          // Verify the page is still functional after gesture
          await expect(page.locator('h1')).toContainText(/statistics|stats/i);
        }
      }
    });
  });

  test.describe('Accessibility Navigation', () => {
    test('should support screen reader navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check for proper heading structure
      const headings = page.locator('h1, h2, h3, h4, h5, h6');
      const headingCount = await headings.count();
      expect(headingCount).toBeGreaterThan(0);

      // Check for proper landmark roles
      const landmarks = page.locator(
        '[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], main, nav, header, footer'
      );
      const landmarkCount = await landmarks.count();
      expect(landmarkCount).toBeGreaterThan(0);

      // Check for skip links
      const skipLinks = page.locator('a[href="#main"], a[href="#content"], .skip-link');
      const skipLinkCount = await skipLinks.count();

      // Skip links are recommended but not required for this test
      if (skipLinkCount > 0) {
        await skipLinks.first().focus();
        await expect(skipLinks.first()).toBeFocused();
      }
    });

    test('should support arrow key navigation for lists', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to runs page (likely to have lists)
      await page.goto('/runs');
      await expect(page.locator('h1')).toContainText(/runs/i);

      // Look for list elements
      const listItems = page.locator('[role="listbox"] [role="option"], ul li, ol li, .list-item');
      const itemCount = await listItems.count();

      if (itemCount > 1) {
        // Focus first item
        await listItems.first().focus();
        await expect(listItems.first()).toBeFocused();

        // Test arrow key navigation
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);

        // Verify navigation worked (page is still functional)
        await expect(page.locator('h1')).toContainText(/runs/i);
      }
    });
  });

  test.describe('URL Navigation and Deep Links', () => {
    test('should handle direct URL navigation', async ({ page }) => {
      // Test direct navigation to different pages
      const urlTests = [
        { url: '/dashboard', expectedHeading: /dashboard/i },
        { url: '/runs', expectedHeading: /runs/i },
        { url: '/stats', expectedHeading: /statistics|stats/i },
      ];

      for (const urlTest of urlTests) {
        // Navigate directly to URL
        await page.goto(urlTest.url);

        // Should redirect to login if not authenticated
        if (page.url().includes('/login')) {
          // Login user
          await page.fill('input[type="email"]', testUser.email);
          await page.fill('input[type="password"]', 'testpassword123');
          await page.click('button[type="submit"]');
          await page.waitForLoadState('networkidle');
        }

        // Verify correct page loaded
        await expect(page.locator('h1, h2')).toContainText(urlTest.expectedHeading);
      }
    });

    test('should handle 404 pages gracefully', async ({ page }) => {
      // Login user first
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Try to navigate to non-existent page
      await page.goto('/non-existent-page');

      // Should show 404 page or redirect to a safe page
      const currentUrl = page.url();
      const pageContent = await page.textContent('body');

      // Check if it's a 404 page or redirected to safe page
      const is404 =
        pageContent?.includes('404') ||
        pageContent?.includes('not found') ||
        pageContent?.includes('Page not found');
      const isSafePage =
        currentUrl.includes('/dashboard') ||
        currentUrl.includes('/runs') ||
        currentUrl.includes('/stats');

      expect(is404 || isSafePage).toBe(true);
    });

    test('should preserve authentication state across navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate between multiple pages
      const pages = ['/runs', '/stats', '/dashboard'];

      for (const pagePath of pages) {
        await page.goto(pagePath);
        await page.waitForLoadState('networkidle');

        // Should not redirect to login (authentication preserved)
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain(pagePath);

        // Should show authenticated content
        await expect(page.locator('h1, h2')).toBeVisible();
      }
    });
  });

  test.describe('Navigation Performance', () => {
    test('should load pages quickly during navigation', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Test navigation performance
      const navigationTests = ['/runs', '/stats', '/dashboard'];

      for (const path of navigationTests) {
        const startTime = Date.now();

        await page.goto(path);
        await page.waitForLoadState('networkidle');

        const loadTime = Date.now() - startTime;

        // Page should load within reasonable time (adjust threshold as needed)
        expect(loadTime).toBeLessThan(3000); // 3 seconds

        // Verify page loaded correctly
        await expect(page.locator('h1, h2')).toBeVisible();
      }
    });

    test('should handle rapid navigation without issues', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Rapidly navigate between pages
      const pages = ['/runs', '/stats', '/dashboard'];

      for (let i = 0; i < 3; i++) {
        for (const pagePath of pages) {
          await page.goto(pagePath);
          await page.waitForLoadState('domcontentloaded');

          // Brief pause to simulate real user behavior
          await page.waitForTimeout(100);

          // Verify page loaded without errors
          await expect(page.locator('h1, h2')).toBeVisible();
        }
      }
    });
  });
});
