/**
 * E2E Test Reliability Utilities
 * Additional helpers for handling flaky test scenarios
 */

import { Page, expect } from '@playwright/test';

/**
 * Utility to handle common flaky scenarios in E2E tests
 */
export class ReliabilityUtils {
  constructor(private page: Page) {}

  /**
   * Wait for element with multiple strategies
   */
  async waitForElementSafely(
    selector: string,
    options: {
      timeout?: number;
      strategy?: 'visible' | 'attached' | 'stable';
    } = {}
  ) {
    const { timeout = 10000, strategy = 'visible' } = options;
    
    const element = this.page.locator(selector);
    
    switch (strategy) {
      case 'visible':
        await expect(element).toBeVisible({ timeout });
        break;
      case 'attached':
        await expect(element).toBeAttached({ timeout });
        break;
      case 'stable':
        await expect(element).toBeVisible({ timeout });
        await expect(element).toBeVisible({ timeout: 2000 });
        break;
    }
    
    return element;
  }

  /**
   * Handle intermittent network issues
   */
  async withNetworkRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        const isNetworkError = lastError.message.includes('net::') || 
                              lastError.message.includes('timeout') ||
                              lastError.message.includes('ECONNREFUSED') ||
                              lastError.message.includes('internetdisconnected');
           
        if (isNetworkError && attempt < maxRetries) {
          await this.page.waitForTimeout(1000 * (attempt + 1));
          continue;
        }
        
        // If not a network error or max retries reached, throw the error
        throw lastError;
      }
    }
    
    // This should never be reached, but included for completeness
    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Handle database race conditions
   */
  async waitForDatabaseState(
    checkFunction: () => Promise<boolean>,
    timeout = 15000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await checkFunction()) {
        return;
      }
      await this.page.waitForTimeout(500);
    }
    
    throw new Error('Database state check timed out');
  }

  /**
   * Ensure page is fully interactive
   */
  async ensurePageInteractive(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle');
    
    // Wait for any pending JavaScript to complete
    await this.page.waitForFunction(() => {
      return document.readyState === 'complete' && 
             !document.querySelector('[data-loading="true"]');
    });
  }

  /**
   * Safe element interaction with retry
   */
  async clickSafely(
    selector: string,
    options: { force?: boolean; timeout?: number } = {}
  ): Promise<void> {
    const element = await this.waitForElementSafely(selector, { 
      strategy: 'stable',
      timeout: options.timeout 
    });
    
    await element.scrollIntoViewIfNeeded();
    await expect(element).toBeEnabled();
    
    if (options.force) {
      await element.click({ force: true });
    } else {
      await element.click();
    }
  }

  /**
   * Handle modal timing issues
   */
  async waitForModalToSettle(modalSelector: string): Promise<void> {
    // Wait for modal to appear
    await this.waitForElementSafely(modalSelector);
    
    // Wait for any animations to complete
    await this.page.waitForTimeout(300);
    
    // Ensure modal is stable
    const modal = this.page.locator(modalSelector);
    await expect(modal).toBeVisible();
  }
}

/**
 * Common test patterns that are known to be flaky
 */
export class FlakeyTestPatterns {
  constructor(private page: Page) {}

  /**
   * Handle form submission with loading states
   */
  async submitFormReliably(
    formSelector: string,
    submitButtonSelector: string,
    expectedOutcome: 'redirect' | 'error' | 'success'
  ): Promise<void> {
    const form = this.page.locator(formSelector);
    const submitButton = this.page.locator(submitButtonSelector);
    
    // Ensure form is ready
    await expect(form).toBeVisible();
    await expect(submitButton).toBeEnabled();
    
    // Submit form
    await submitButton.click();
    
    // Handle loading state
    await expect(submitButton).toBeDisabled({ timeout: 2000 });
    
    switch (expectedOutcome) {
      case 'redirect':
        await this.page.waitForURL(/\/dashboard|\//, { timeout: 15000 });
        break;
      case 'error':
        await expect(this.page.locator('[role="alert"], .error')).toBeVisible({ timeout: 10000 });
        break;
      case 'success':
        await expect(this.page.locator('.success, [data-success="true"]')).toBeVisible({ timeout: 10000 });
        break;
    }
  }

  /**
   * Handle API-dependent content loading
   */
  async waitForApiData(
    containerSelector: string,
    expectedElementSelector: string,
    timeout = 20000
  ): Promise<void> {
    // Wait for container to be present
    await expect(this.page.locator(containerSelector)).toBeVisible({ timeout: 5000 });
    
    // Wait for loading indicators to disappear
    await expect(this.page.locator('[data-loading="true"], .loading')).not.toBeVisible({ timeout });
    
    // Wait for actual data to appear
    await expect(this.page.locator(expectedElementSelector)).toBeVisible({ timeout });
  }

  /**
   * Handle authentication state transitions
   */
  async ensureAuthenticatedState(userEmail: string): Promise<void> {
    // Check for auth token in localStorage
    const hasToken = await this.page.evaluate(() => {
      return localStorage.getItem('authToken') !== null;
    });
    
    if (!hasToken) {
      throw new Error('Authentication token not found');
    }
    
    // Verify UI shows authenticated state
    await expect(this.page.locator(`text=${userEmail}`)).toBeVisible({ timeout: 10000 });
  }
}