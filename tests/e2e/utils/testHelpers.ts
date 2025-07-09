/**
 * E2E Test Helpers
 * Basic stub implementation for E2E tests
 */

import { Page } from '@playwright/test';

export function createE2EHelpers(page: Page, testDb: any) {
  return {
    helpers: {
      waitForPageLoad: async () => {
        await page.waitForLoadState('domcontentloaded');
      },
      waitForElement: async (selector: string) => {
        await page.waitForSelector(selector);
      },
      fillForm: async (formData: Record<string, string>) => {
        for (const [selector, value] of Object.entries(formData)) {
          await page.fill(selector, value);
        }
      },
      submitForm: async (submitSelector: string, loadingText?: string) => {
        await page.click(submitSelector);
        if (loadingText) {
          await page.waitForSelector(`text=${loadingText}`, { timeout: 5000 });
        }
      },
      waitForErrorMessage: async (expectedMessage?: string) => {
        await page.waitForSelector('[role="alert"], .error');
      },
      waitForNavigation: async (expectedUrl?: string, timeout?: number) => {
        if (expectedUrl) {
          await page.waitForURL(expectedUrl, { timeout: timeout || 15000 });
        } else {
          await page.waitForLoadState('networkidle');
        }
      },
      waitForApiResponse: async (selector: string) => {
        await page.waitForSelector(selector);
      }
    },
    db: {
      cleanDatabase: async () => {
        await testDb.cleanupDatabase();
      },
      createTestUser: async (userData?: any) => {
        return await testDb.createTestUser(userData);
      },
      findUserByEmail: async (email: string) => {
        return await testDb.findUserByEmail(email);
      }
    },
    auth: {
      login: async (email: string, password: string) => {
        await page.goto('/login');
        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
      },
      logout: async () => {
        await page.click('button[data-test="logout"]');
      }
    }
  };
}