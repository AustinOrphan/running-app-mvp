import { Page, Locator } from '@playwright/test';

/**
 * Wait Conditions Utilities for Playwright E2E Tests
 * Provides consistent wait conditions and retry logic for CI environments
 */

export interface WaitOptions {
  timeout?: number;
  interval?: number;
  retries?: number;
}

const DEFAULT_TIMEOUT = process.env.CI ? 10000 : 5000; // 10s in CI, 5s locally (reduced from 20s/10s)
const DEFAULT_INTERVAL = 1000; // 1 second
const DEFAULT_RETRIES = process.env.CI ? 3 : 1; // 3 retries in CI, 1 locally

/**
 * Wait for an element to be visible and stable
 */
export async function waitForElementStable(
  locator: Locator,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Wait for element to be visible
  await locator.waitFor({
    state: 'visible',
    timeout,
  });

  // Wait for element to be stable (no position changes)
  await locator.waitFor({
    state: 'stable',
    timeout: timeout / 2,
  });
}

/**
 * Wait for page to be fully loaded with comprehensive completion checks
 */
export async function waitForPageLoad(page: Page, options: WaitOptions = {}): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Wait for DOM to be ready first
  await page.waitForLoadState('domcontentloaded', { timeout });

  // Wait for load state (all synchronous resources)
  await page.waitForLoadState('load', { timeout });

  // Wait for network to be idle (all async resources)
  await page.waitForLoadState('networkidle', { timeout: timeout / 2 });

  // Additional check: ensure React has hydrated if it's a React app
  try {
    await page.waitForFunction(
      () => {
        // Check if React root exists and has been hydrated
        const root = document.getElementById('root') || document.getElementById('app');
        return root && root.children.length > 0;
      },
      { timeout: Math.min(timeout / 3, 5000) }
    );
  } catch {
    // If React check fails, continue - might not be a React page
  }

  // Ensure no critical errors are displayed
  const hasError = await page.locator('body').textContent();
  if (
    hasError &&
    (hasError.includes('Cannot GET') ||
      hasError.includes('Application Error') ||
      hasError.includes('500 Internal Server Error') ||
      hasError.includes('404 Not Found'))
  ) {
    throw new Error('Page loaded with error content');
  }
}

/**
 * Wait for API response
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  await page.waitForResponse(
    response => {
      const url = response.url();
      if (typeof urlPattern === 'string') {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    },
    { timeout }
  );
}

/**
 * Wait with retry logic
 */
export async function waitWithRetry<T>(
  action: () => Promise<T>,
  options: WaitOptions = {}
): Promise<T> {
  const retries = options.retries || DEFAULT_RETRIES;
  const interval = options.interval || DEFAULT_INTERVAL;

  let lastError: Error | null = null;

  for (let i = 0; i <= retries; i++) {
    try {
      return await action();
    } catch (error) {
      lastError = error as Error;

      if (i < retries) {
        console.log(`Retry ${i + 1}/${retries} after error:`, error);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }

  throw lastError || new Error('Action failed after retries');
}

/**
 * Wait for navigation with proper conditions
 */
export async function waitForNavigation(
  page: Page,
  action: () => Promise<void>,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Start waiting for navigation before the action
  const navigationPromise = page.waitForNavigation({
    timeout,
    waitUntil: 'networkidle',
  });

  // Perform the action that triggers navigation
  await action();

  // Wait for navigation to complete
  await navigationPromise;

  // Additional wait for page stability
  await waitForPageLoad(page, { timeout: timeout / 2 });
}

/**
 * Wait for element count
 */
export async function waitForElementCount(
  locator: Locator,
  expectedCount: number,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const interval = options.interval || 500;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const count = await locator.count();
    if (count === expectedCount) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  const actualCount = await locator.count();
  throw new Error(
    `Expected ${expectedCount} elements, but found ${actualCount} after ${timeout}ms`
  );
}

/**
 * Wait for text to appear
 */
export async function waitForText(
  page: Page,
  text: string,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  await page.waitForFunction(
    searchText => {
      const body = document.body;
      return body ? body.textContent?.includes(searchText) : false;
    },
    text,
    { timeout }
  );
}

/**
 * Wait for element to be enabled
 */
export async function waitForEnabled(locator: Locator, options: WaitOptions = {}): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  await locator.waitFor({
    state: 'visible',
    timeout,
  });

  await locator.waitFor({
    state: 'enabled',
    timeout,
  });
}

/**
 * CI-specific wait multiplier
 */
export function getCITimeout(baseTimeout: number): number {
  return process.env.CI ? baseTimeout * 2 : baseTimeout;
}

/**
 * Wait for animation to complete
 */
export async function waitForAnimation(page: Page, duration: number = 300): Promise<void> {
  // In CI, animations are disabled, so reduce wait time significantly
  const waitTime = process.env.CI ? 30 : Math.min(duration, 150); // Cap at 150ms, use 30ms in CI
  await page.waitForTimeout(waitTime);
}

/**
 * Wait for all images to load
 */
export async function waitForImages(page: Page, options: WaitOptions = {}): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  await page.waitForFunction(
    () => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.every(img => img.complete && img.naturalHeight !== 0);
    },
    { timeout }
  );
}

/**
 * Smart wait that combines multiple conditions
 */
export async function smartWait(
  page: Page,
  options: {
    selector?: string;
    text?: string;
    apiPattern?: string | RegExp;
    timeout?: number;
  } = {}
): Promise<void> {
  const promises: Promise<void>[] = [];

  // Wait for page load
  promises.push(waitForPageLoad(page, { timeout: options.timeout }));

  // Wait for selector if provided
  if (options.selector) {
    promises.push(
      waitForElementStable(page.locator(options.selector), { timeout: options.timeout })
    );
  }

  // Wait for text if provided
  if (options.text) {
    promises.push(waitForText(page, options.text, { timeout: options.timeout }));
  }

  // Wait for API if pattern provided
  if (options.apiPattern) {
    promises.push(waitForApiResponse(page, options.apiPattern, { timeout: options.timeout }));
  }

  // Wait for all conditions
  await Promise.all(promises);
}

/**
 * Optimized wait for modal to open with focus management
 */
export async function waitForModalOpen(
  page: Page,
  modalSelector: string = '[role="dialog"], .modal, .popup, [aria-modal="true"]',
  options: WaitOptions = {}
): Promise<boolean> {
  const timeout = options.timeout || 2000; // Much shorter timeout for modals (2s instead of 5s)

  try {
    // Wait for modal element to be visible
    const modal = page.locator(modalSelector);
    await modal.waitFor({ state: 'visible', timeout });

    // Wait for modal to be stable (animations complete)
    await modal.waitFor({ state: 'stable', timeout: 1000 });

    return true;
  } catch {
    return false; // Modal didn't appear
  }
}

/**
 * Fast chart rendering wait - optimized for visual tests
 */
export async function waitForChartRender(page: Page, _options: WaitOptions = {}): Promise<void> {
  try {
    // Wait for any chart elements to be present
    const chartSelectors = [
      '.recharts-wrapper',
      'canvas',
      'svg',
      '[class*="chart"]',
      '[data-testid*="chart"]',
    ];

    for (const selector of chartSelectors) {
      const element = page.locator(selector).first();
      if ((await element.count()) > 0) {
        await element.waitFor({ state: 'visible', timeout: 1000 });
        await waitForAnimation(page, 100); // Short animation wait
        return;
      }
    }

    // Fallback: short wait if no charts found
    await waitForAnimation(page, 200);
  } catch {
    // If chart waiting fails, just do minimal wait
    await waitForAnimation(page, 100);
  }
}

/**
 * Comprehensive page load completion check for performance tests
 * This is specifically for performance testing scenarios where we need to ensure
 * the page is completely loaded before taking measurements
 */
export async function waitForCompletePageLoad(
  page: Page,
  options: WaitOptions = {}
): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Basic page load states
  await waitForPageLoad(page, { timeout });

  // Wait for all images to load
  try {
    await waitForImages(page, { timeout: timeout / 3 });
  } catch {
    // Continue if images don't load - they might not be critical
  }

  // Wait for fonts to load
  try {
    await page.waitForFunction(
      () => {
        return document.fonts ? document.fonts.ready : true;
      },
      { timeout: Math.min(timeout / 4, 3000) }
    );
  } catch {
    // Fonts might not be available in test environment
  }

  // Check for any pending API requests or loading states
  try {
    await page.waitForFunction(
      () => {
        // Check for common loading indicators
        const loadingSelectors = [
          '[data-testid*="loading"]',
          '.loading',
          '.spinner',
          '[aria-label*="loading"]',
          '[aria-busy="true"]',
        ];

        return !loadingSelectors.some(
          selector => document.querySelector(selector)?.getAttribute('style') !== 'display: none'
        );
      },
      { timeout: Math.min(timeout / 4, 2000) }
    );
  } catch {
    // Loading indicators check is optional
  }

  // Final stability check - ensure page isn't still changing
  await new Promise(resolve => setTimeout(resolve, 500));
}
