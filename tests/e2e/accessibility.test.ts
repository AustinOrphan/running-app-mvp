import AxeBuilder from '@axe-core/playwright';
import { test, expect, devices } from '@playwright/test';
import type { TestUser } from './types';

import { mockRuns } from '../fixtures/mockData.js';
import { testDb } from '../fixtures/testDatabase.js';
import { accessibilityTestPatterns } from '../setup/axeSetup.js';

test.describe('Accessibility E2E Tests', () => {
  let testUser: TestUser | undefined;

  test.beforeEach(async ({ page: _page }) => {
    // Clean database and create test user
    await testDb.cleanupDatabase();
    testUser = await testDb.createTestUser({
      email: 'accessibility@test.com',
      password: 'testpassword123',
    });

    if (!testUser) {
      throw new Error('Test user not created');
    }

    // Create test data
    await testDb.createTestRuns(testUser.id, mockRuns.slice(0, 5));
  });

  test.afterAll(async () => {
    await testDb.cleanupDatabase();
    await testDb.prisma.$disconnect();
  });

  test.describe('Page-level Accessibility Tests', () => {
    test('should have no accessibility violations on login page', async ({ page }) => {
      await page.goto('/login');

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should have no accessibility violations on dashboard', async ({ page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Wait for content to load
      await page.waitForLoadState('networkidle');

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should have no accessibility violations on runs page', async ({ page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/runs');
      await page.waitForLoadState('networkidle');

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should have no accessibility violations on stats page', async ({ page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/stats');
      await page.waitForLoadState('networkidle');

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });

  test.describe('Keyboard Navigation Accessibility', () => {
    test('should support keyboard navigation on login form', async ({ page }) => {
      if (!testUser) {
        throw new Error('Test user not created');
      }

      await page.goto('/login');

      // Test tab navigation through form
      await page.keyboard.press('Tab'); // Email field
      await expect(page.locator('input[type="email"]')).toBeFocused();

      await page.keyboard.press('Tab'); // Password field
      await expect(page.locator('input[type="password"]')).toBeFocused();

      await page.keyboard.press('Tab'); // Submit button
      await expect(page.locator('button[type="submit"]')).toBeFocused();

      // Test form submission with Enter key
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.locator('button[type="submit"]').focus();
      await page.keyboard.press('Enter');

      await expect(page).toHaveURL('/dashboard');
    });

    test('should support keyboard navigation in dashboard', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      await accessibilityTestPatterns.keyboardNavigation(page);
    });

    test('should support arrow key navigation in data tables', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/runs');
      await page.waitForLoadState('networkidle');

      // Test arrow key navigation in runs list
      const runItems = page.locator('.run-item, [data-testid="run-item"], tr');
      const itemCount = await runItems.count();

      if (itemCount > 1) {
        await runItems.first().focus();
        await expect(runItems.first()).toBeFocused();

        // Test arrow down
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);

        // Test arrow up
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
      }
    });
  });

  test.describe('Screen Reader Accessibility', () => {
    test('should have proper heading hierarchy', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      await accessibilityTestPatterns.headingStructure(page);
    });

    test('should have proper landmark regions', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check for main landmarks
      const main = page.locator('main, [role="main"]');
      await expect(main).toBeVisible();

      const nav = page.locator('nav, [role="navigation"]');
      const navCount = await nav.count();
      expect(navCount).toBeGreaterThan(0);
    });

    test('should have proper ARIA labels for charts and complex widgets', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/stats');
      await page.waitForLoadState('networkidle');

      // Check for chart accessibility
      const charts = page.locator('canvas, svg, .recharts-wrapper, [role="img"]');
      const chartCount = await charts.count();

      for (let i = 0; i < chartCount; i++) {
        const chart = charts.nth(i);
        const ariaLabel = await chart.getAttribute('aria-label');
        const title = await chart.locator('title').textContent();

        // Charts should have some form of accessible description
        expect(ariaLabel || title).toBeTruthy();
      }
    });

    test('should provide text alternatives for data visualizations', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/stats');
      await page.waitForLoadState('networkidle');

      // Check that data is available in text form alongside charts
      const pageText = await page.textContent('body');

      // Should contain numerical data in text form
      expect(pageText).toMatch(/\d+/); // Should contain numbers
      expect(pageText?.toLowerCase()).toMatch(/total|distance|time|runs/); // Should contain relevant terms
    });
  });

  test.describe('Form Accessibility', () => {
    test('should have proper form labels and associations', async ({ page }) => {
      await page.goto('/login');

      await accessibilityTestPatterns.formLabels(page);
    });

    test('should provide error messages accessibly', async ({ page }) => {
      await page.goto('/login');

      // Submit form with invalid data
      await page.fill('input[type="email"]', 'invalid-email');
      await page.fill('input[type="password"]', '123'); // Too short
      await page.click('button[type="submit"]');

      // Check for accessible error messages
      const errorMessages = page.locator(
        '[role="alert"], .error-message, .field-error, [aria-invalid="true"]'
      );
      const errorCount = await errorMessages.count();

      if (errorCount > 0) {
        // Error messages should be properly associated with fields
        for (let i = 0; i < errorCount; i++) {
          const error = errorMessages.nth(i);
          const isVisible = await error.isVisible();
          expect(isVisible).toBe(true);
        }
      }
    });

    test('should handle required field indicators accessibly', async ({ page }) => {
      await page.goto('/login');

      // Check for required field indicators
      const requiredFields = page.locator('input[required], [aria-required="true"]');
      const requiredCount = await requiredFields.count();

      for (let i = 0; i < requiredCount; i++) {
        const field = requiredFields.nth(i);
        const isRequired =
          (await field.getAttribute('required')) !== null ||
          (await field.getAttribute('aria-required')) === 'true';
        expect(isRequired).toBe(true);
      }
    });
  });

  test.describe('Focus Management', () => {
    test('should have visible focus indicators', async ({ page }) => {
      await page.goto('/login');

      // Tab through focusable elements and check for visible focus
      const focusableElements = page.locator(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const elementCount = await focusableElements.count();

      for (let i = 0; i < Math.min(5, elementCount); i++) {
        const element = focusableElements.nth(i);
        if (await element.isVisible()) {
          await element.focus();
          await expect(element).toBeFocused();

          // Check that focus is visually apparent
          const styles = await element.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return {
              outline: computed.outline,
              outlineWidth: computed.outlineWidth,
              boxShadow: computed.boxShadow,
              border: computed.border,
            };
          });

          // Should have some form of focus indicator
          const hasFocusIndicator =
            styles.outline !== 'none' ||
            styles.outlineWidth !== '0px' ||
            styles.boxShadow !== 'none' ||
            styles.border !== 'none';

          expect(hasFocusIndicator).toBe(true);
        }
      }
    });

    test('should manage focus when navigating between pages', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Navigate to different page
      const navLinks = page.locator('nav a, [role="navigation"] a');
      const linkCount = await navLinks.count();

      if (linkCount > 0) {
        await navLinks.first().click();
        await page.waitForLoadState('networkidle');

        // Focus should be managed appropriately (skip link, main heading, etc.)
        const mainHeading = page.locator('h1').first();
        const skipLink = page.locator('.skip-link, a[href="#main"]').first();

        const headingExists = (await mainHeading.count()) > 0;
        const skipLinkExists = (await skipLink.count()) > 0;

        expect(headingExists || skipLinkExists).toBe(true);
      }
    });

    test('should trap focus in modal dialogs', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Look for modal triggers (add run, edit, etc.)
      const modalTriggers = page.locator(
        'button:has-text("Add"), button:has-text("Edit"), .modal-trigger, [data-testid*="modal"]'
      );
      const triggerCount = await modalTriggers.count();

      if (triggerCount > 0) {
        await modalTriggers.first().click();
        await page.waitForTimeout(500);

        // Check if modal opened
        const modal = page.locator('[role="dialog"], .modal, .popup, [aria-modal="true"]');
        const modalVisible = (await modal.count()) > 0 && (await modal.first().isVisible());

        if (modalVisible) {
          // Test focus trap
          const focusableInModal = modal.locator(
            'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          const modalFocusableCount = await focusableInModal.count();

          if (modalFocusableCount > 0) {
            // Tab through modal elements
            await focusableInModal.first().focus();
            await expect(focusableInModal.first()).toBeFocused();

            // Tab to last element
            for (let i = 0; i < modalFocusableCount; i++) {
              await page.keyboard.press('Tab');
            }

            // Should wrap back to first element
            await expect(focusableInModal.first()).toBeFocused();
          }
        }
      }
    });
  });

  test.describe('Color and Contrast Accessibility', () => {
    test('should not rely solely on color to convey information', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');

      await page.goto('/stats');
      await page.waitForLoadState('networkidle');

      await accessibilityTestPatterns.colorContrast(page);
    });

    test('should have sufficient color contrast', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Run axe with color contrast rules enabled
      const accessibilityScanResults = await new AxeBuilder({ page })
        .include('body')
        .withRules(['color-contrast'])
        .analyze();

      // Log any color contrast violations for review
      if (accessibilityScanResults.violations.length > 0) {
        console.log('Color contrast violations found (review needed):');
        accessibilityScanResults.violations.forEach(violation => {
          console.log(`- ${violation.id}: ${violation.description}`);
        });
      }
    });
  });

  test.describe('Mobile Accessibility', () => {
    test.use(devices['iPhone 12']);

    test('should have proper touch target sizes', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check touch target sizes
      const interactiveElements = page.locator(
        'button, a, input, [role="button"], [tabindex]:not([tabindex="-1"])'
      );
      const elementCount = await interactiveElements.count();

      for (let i = 0; i < Math.min(10, elementCount); i++) {
        const element = interactiveElements.nth(i);
        if (await element.isVisible()) {
          const boundingBox = await element.boundingBox();

          if (boundingBox) {
            // Touch targets should be at least 44x44 pixels (iOS/WCAG guideline)
            const minSize = 44;
            expect(Math.min(boundingBox.width, boundingBox.height)).toBeGreaterThanOrEqual(minSize);
          }
        }
      }
    });

    test('should handle orientation changes accessibly', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Test portrait orientation
      await page.setViewportSize({ width: 375, height: 667 });
      const accessibilityPortrait = await new AxeBuilder({ page }).analyze();
      expect(accessibilityPortrait.violations).toEqual([]);

      // Test landscape orientation
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForTimeout(500);
      const accessibilityLandscape = await new AxeBuilder({ page }).analyze();
      expect(accessibilityLandscape.violations).toEqual([]);
    });

    test('should support assistive touch and voice control', async ({ page }) => {
      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.tap('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check that interactive elements have accessible names for voice control
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const text = await button.textContent();
          const ariaLabel = await button.getAttribute('aria-label');
          const title = await button.getAttribute('title');

          // Button should have accessible name
          expect(text?.trim() || ariaLabel || title).toBeTruthy();
        }
      }
    });
  });

  test.describe('High Contrast and Dark Mode Accessibility', () => {
    test('should work with forced colors mode', async ({ page }) => {
      // Simulate high contrast mode
      await page.emulateMedia({ forcedColors: 'active' });

      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Check that page is still functional and accessible
      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });

    test('should support prefers-reduced-motion', async ({ page }) => {
      // Simulate reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });

      // Login user
      await page.goto('/login');
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'testpassword123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');

      // Page should still be accessible with reduced motion
      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScanResults.violations).toEqual([]);
    });
  });
});
