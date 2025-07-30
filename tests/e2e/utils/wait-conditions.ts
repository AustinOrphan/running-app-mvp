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

const DEFAULT_TIMEOUT = process.env.CI ? 30000 : 15000; // 30s in CI, 15s locally
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
 * Wait for page to be fully loaded
 */
export async function waitForPageLoad(page: Page, options: WaitOptions = {}): Promise<void> {
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  // Wait for load state
  await page.waitForLoadState('load', { timeout });

  // Wait for network to be idle
  await page.waitForLoadState('networkidle', { timeout: timeout / 2 });

  // Wait for DOM to be ready
  await page.waitForLoadState('domcontentloaded', { timeout: timeout / 2 });
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
export async function waitForAnimation(page: Page, duration: number = 500): Promise<void> {
  // In CI, animations are disabled, so reduce wait time
  const waitTime = process.env.CI ? 100 : duration;
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
