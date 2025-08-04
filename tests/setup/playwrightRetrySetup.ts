/**
 * Playwright Retry Setup
 *
 * Configures Playwright-specific retry logic for E2E tests
 * with enhanced error detection and recovery strategies.
 */

import { retryPlaywrightAction, RetryOptions } from '../utils/retryUtils';

/**
 * Enhanced page actions with automatic retry logic
 * These wrap common Playwright actions with smart retry logic
 */
export class RetryablePageActions {
  constructor(private page: any) {}

  /**
   * Click with retry logic for flaky elements
   */
  async click(selector: string, options: { timeout?: number; retries?: number } = {}) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        await this.page.click(selector, { timeout: options.timeout });
      },
      {
        maxAttempts: options.retries || 3,
        description: `click "${selector}"`,
        delayMs: 1000,
      }
    );
  }

  /**
   * Fill input with retry logic
   */
  async fill(
    selector: string,
    value: string,
    options: { timeout?: number; retries?: number } = {}
  ) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        await this.page.fill(selector, value, { timeout: options.timeout });
      },
      {
        maxAttempts: options.retries || 3,
        description: `fill "${selector}" with "${value}"`,
        delayMs: 500,
      }
    );
  }

  /**
   * Navigate with retry logic
   */
  async goto(
    url: string,
    options: { timeout?: number; retries?: number; waitUntil?: string } = {}
  ) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        await this.page.goto(url, {
          timeout: options.timeout,
          waitUntil: options.waitUntil || 'networkidle',
        });
      },
      {
        maxAttempts: options.retries || 3,
        description: `navigate to "${url}"`,
        delayMs: 2000,
      }
    );
  }

  /**
   * Wait for selector with retry logic
   */
  async waitForSelector(
    selector: string,
    options: { timeout?: number; retries?: number; state?: string } = {}
  ) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        await this.page.waitForSelector(selector, {
          timeout: options.timeout,
          state: options.state || 'visible',
        });
      },
      {
        maxAttempts: options.retries || 3,
        description: `wait for selector "${selector}"`,
        delayMs: 1000,
      }
    );
  }

  /**
   * Wait for load state with retry logic
   */
  async waitForLoadState(
    state: string = 'networkidle',
    options: { timeout?: number; retries?: number } = {}
  ) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        await this.page.waitForLoadState(state, { timeout: options.timeout });
      },
      {
        maxAttempts: options.retries || 2,
        description: `wait for load state "${state}"`,
        delayMs: 1500,
      }
    );
  }

  /**
   * Take screenshot with retry logic
   */
  async screenshot(options: { path?: string; fullPage?: boolean; retries?: number } = {}) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        return await this.page.screenshot({
          path: options.path,
          fullPage: options.fullPage,
        });
      },
      {
        maxAttempts: options.retries || 2,
        description: 'take screenshot',
        delayMs: 1000,
      }
    );
  }

  /**
   * Assert text content with retry logic
   */
  async expectText(
    selector: string,
    text: string,
    options: { timeout?: number; retries?: number } = {}
  ) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        const element = await this.page.waitForSelector(selector, { timeout: options.timeout });
        const content = await element.textContent();
        if (!content?.includes(text)) {
          throw new Error(
            `Expected text "${text}" not found in element "${selector}". Got: "${content}"`
          );
        }
      },
      {
        maxAttempts: options.retries || 3,
        description: `assert text "${text}" in "${selector}"`,
        delayMs: 1000,
      }
    );
  }

  /**
   * Check element visibility with retry logic
   */
  async isVisible(selector: string, options: { timeout?: number; retries?: number } = {}) {
    return retryPlaywrightAction(
      this.page,
      async () => {
        return await this.page.isVisible(selector, { timeout: options.timeout });
      },
      {
        maxAttempts: options.retries || 2,
        description: `check visibility of "${selector}"`,
        delayMs: 500,
      }
    );
  }
}

/**
 * Browser context actions with retry logic
 */
export class RetryableBrowserActions {
  constructor(private browser: any) {}

  /**
   * Create new page with retry logic
   */
  async newPage(options: { retries?: number } = {}) {
    return retryPlaywrightAction(
      this.browser,
      async () => {
        return await this.browser.newPage();
      },
      {
        maxAttempts: options.retries || 2,
        description: 'create new page',
        delayMs: 1000,
      }
    );
  }

  /**
   * Create new context with retry logic
   */
  async newContext(contextOptions: any = {}, options: { retries?: number } = {}) {
    return retryPlaywrightAction(
      this.browser,
      async () => {
        return await this.browser.newContext(contextOptions);
      },
      {
        maxAttempts: options.retries || 2,
        description: 'create new context',
        delayMs: 1000,
      }
    );
  }
}

/**
 * Common E2E test patterns with retry logic
 */
export class RetryableTestPatterns {
  constructor(private page: any) {
    this.pageActions = new RetryablePageActions(page);
  }

  private pageActions: RetryablePageActions;

  /**
   * Login flow with retry logic
   */
  async login(email: string, password: string, options: { retries?: number } = {}) {
    const retryOptions: RetryOptions = {
      maxAttempts: options.retries || 3,
      description: `login with ${email}`,
      delayMs: 2000,
    };

    return retryPlaywrightAction(
      this.page,
      async () => {
        // Navigate to login page
        await this.pageActions.goto('/login');

        // Fill credentials
        await this.pageActions.fill('[data-testid="email-input"]', email);
        await this.pageActions.fill('[data-testid="password-input"]', password);

        // Submit form
        await this.pageActions.click('[data-testid="login-button"]');

        // Wait for redirect or success indicator
        await this.page.waitForURL(/dashboard|home/, { timeout: 10000 });
      },
      retryOptions
    );
  }

  /**
   * Form submission with retry logic
   */
  async submitForm(
    formData: Record<string, string>,
    submitSelector: string,
    options: { retries?: number } = {}
  ) {
    const retryOptions: RetryOptions = {
      maxAttempts: options.retries || 3,
      description: 'submit form',
      delayMs: 1000,
    };

    return retryPlaywrightAction(
      this.page,
      async () => {
        // Fill all form fields
        for (const [field, value] of Object.entries(formData)) {
          await this.pageActions.fill(`[data-testid="${field}"]`, value);
        }

        // Submit form
        await this.pageActions.click(submitSelector);

        // Wait for form submission to complete
        await this.pageActions.waitForLoadState('networkidle');
      },
      retryOptions
    );
  }

  /**
   * Modal interaction with retry logic
   */
  async handleModal(
    action: 'accept' | 'dismiss' | 'wait',
    options: { retries?: number; timeout?: number } = {}
  ) {
    const retryOptions: RetryOptions = {
      maxAttempts: options.retries || 3,
      description: `handle modal - ${action}`,
      delayMs: 1000,
    };

    return retryPlaywrightAction(
      this.page,
      async () => {
        if (action === 'wait') {
          await this.page.waitForEvent('dialog', { timeout: options.timeout || 5000 });
        } else {
          this.page.on('dialog', async (dialog: any) => {
            if (action === 'accept') {
              await dialog.accept();
            } else {
              await dialog.dismiss();
            }
          });
        }
      },
      retryOptions
    );
  }

  /**
   * Element interaction with wait and retry
   */
  async interactWithElement(
    selector: string,
    action: 'click' | 'hover' | 'focus',
    options: { retries?: number; timeout?: number } = {}
  ) {
    const retryOptions: RetryOptions = {
      maxAttempts: options.retries || 3,
      description: `${action} element "${selector}"`,
      delayMs: 1000,
    };

    return retryPlaywrightAction(
      this.page,
      async () => {
        // Wait for element to be ready
        await this.pageActions.waitForSelector(selector, { timeout: options.timeout });

        // Perform action
        switch (action) {
          case 'click':
            await this.pageActions.click(selector);
            break;
          case 'hover':
            await this.page.hover(selector);
            break;
          case 'focus':
            await this.page.focus(selector);
            break;
        }
      },
      retryOptions
    );
  }
}

/**
 * Global setup for Playwright tests with retry configuration
 */
export function setupPlaywrightRetries() {
  // Configure global retry settings based on environment
  const isCI = !!process.env.CI;
  const globalRetries = isCI ? 2 : 1;

  // Override Playwright's built-in retry mechanism with our enhanced version
  if (typeof test !== 'undefined') {
    const originalTest = test;

    // Enhance test function with retry capabilities
    (global as any).test = (name: string, testFn: any) => {
      return originalTest(name, async ({ page, context, browser }) => {
        // Create enhanced page wrapper
        const retryablePage = new RetryablePageActions(page);
        const retryableBrowser = new RetryableBrowserActions(browser);
        const testPatterns = new RetryableTestPatterns(page);

        // Add retry helpers to test context
        const enhancedTestFn = testFn.bind(null, {
          page,
          context,
          browser,
          retryablePage,
          retryableBrowser,
          testPatterns,
        });

        // Execute test with global retry logic
        return retryPlaywrightAction(page, enhancedTestFn, {
          maxAttempts: globalRetries + 1,
          description: `E2E test "${name}"`,
          delayMs: 3000, // Longer delay for E2E tests
        });
      });
    };
  }

  if (process.env.DEBUG_TESTS) {
    console.log(`🎭 Playwright retry setup loaded with ${globalRetries} retries`);
  }
}

// Auto-setup if in test environment
if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  setupPlaywrightRetries();
}

export default {
  RetryablePageActions,
  RetryableBrowserActions,
  RetryableTestPatterns,
  setupPlaywrightRetries,
};
