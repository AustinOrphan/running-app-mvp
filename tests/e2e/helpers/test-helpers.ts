/* eslint-disable react-hooks/rules-of-hooks */
import { Page, test as baseTest } from '@playwright/test';
import { waitForPageLoad, waitWithRetry, getCITimeout, smartWait } from '../utils/wait-conditions';

/**
 * Enhanced test fixture with built-in wait conditions and retry logic
 */
export const test = baseTest.extend({
  // Auto-wait page fixture
  autoWaitPage: async ({ page }, usePage) => {
    // Override page methods to include automatic waiting
    const originalGoto = page.goto.bind(page);
    page.goto = async (url: string, options?: any) => {
      const result = await originalGoto(url, {
        ...options,
        timeout: getCITimeout(options?.timeout || 30000),
        waitUntil: 'networkidle',
      });
      await waitForPageLoad(page);
      return result;
    };

    await usePage(page);
  },

  // Retry-enabled page fixture
  retryPage: async ({ page }, useRetryPage) => {
    // Add retry methods to page
    const enhancedPage = Object.assign(page, {
      clickWithRetry: async (selector: string) => {
        await waitWithRetry(async () => {
          await page.click(selector, { timeout: getCITimeout(5000) });
        });
      },

      fillWithRetry: async (selector: string, value: string) => {
        await waitWithRetry(async () => {
          await page.fill(selector, value, { timeout: getCITimeout(5000) });
        });
      },

      waitForSelectorWithRetry: async (selector: string) => {
        return await waitWithRetry(async () => {
          return await page.waitForSelector(selector, {
            timeout: getCITimeout(10000),
            state: 'visible',
          });
        });
      },
    });

    await useRetryPage(enhancedPage);
  },
});

/**
 * Common test helpers
 */
export class TestHelpers {
  constructor(private page: Page) {}

  /**
   * Login helper with proper wait conditions
   */
  async login(username: string, password: string) {
    await smartWait(this.page, {
      selector: 'input[name="username"]',
      timeout: getCITimeout(15000),
    });

    await this.page.fill('input[name="username"]', username);
    await this.page.fill('input[name="password"]', password);

    await waitWithRetry(async () => {
      await this.page.click('button[type="submit"]');
      await smartWait(this.page, {
        apiPattern: '/api/auth/login',
        timeout: getCITimeout(10000),
      });
    });
  }

  /**
   * Navigate with smart waiting
   */
  async navigateTo(path: string) {
    await this.page.goto(path);
    await smartWait(this.page, {
      selector: 'body',
      timeout: getCITimeout(15000),
    });
  }

  /**
   * Wait for data to load
   */
  async waitForData(apiPattern: string | RegExp) {
    await smartWait(this.page, {
      apiPattern,
      timeout: getCITimeout(20000),
    });
  }

  /**
   * Submit form with retry
   */
  async submitForm(formSelector: string) {
    await waitWithRetry(async () => {
      const form = this.page.locator(formSelector);
      await form.waitFor({ state: 'visible', timeout: getCITimeout(5000) });
      await form.evaluate((el: HTMLFormElement) => el.submit());
    });
  }

  /**
   * Check element visibility with retry
   */
  async isElementVisible(selector: string): Promise<boolean> {
    return await waitWithRetry(
      async () => {
        const element = this.page.locator(selector);
        return await element.isVisible();
      },
      { retries: 2 }
    );
  }

  /**
   * Take screenshot with automatic naming
   */
  async takeDebugScreenshot(name: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${name}-${timestamp}.png`;
    await this.page.screenshot({
      path: `test-results/screenshots/${fileName}`,
      fullPage: true,
    });
  }
}

/**
 * Global test hooks with proper timeouts
 */
test.beforeEach(async ({ page }) => {
  // Set default timeout for all tests
  test.setTimeout(getCITimeout(60000)); // 2 minutes in CI, 1 minute locally

  // Set viewport
  await page.setViewportSize({ width: 1280, height: 720 });

  // Clear cookies and storage
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test.afterEach(async ({ page }, testInfo) => {
  // Take screenshot on failure
  if (testInfo.status !== 'passed') {
    await page.screenshot({
      path: `test-results/failures/${testInfo.title}-failure.png`,
      fullPage: true,
    });
  }
});

export { expect } from '@playwright/test';
