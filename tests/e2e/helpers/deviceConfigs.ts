/**
 * Device Configuration Helpers for E2E Tests
 * Provides consistent device configurations for Playwright tests
 */

import { devices } from '@playwright/test';

// iPhone configurations
export const iPhone12Config = {
  ...devices['iPhone 13'], // Use iPhone 13 as base since iPhone 12 is not in default devices
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  hasTouch: true,
  isMobile: true,
  defaultBrowserType: 'webkit' as const,
};

export const iPadConfig = {
  ...devices['iPad Pro 11'],
  viewport: { width: 1024, height: 1366 },
  hasTouch: true,
  isMobile: false,
  defaultBrowserType: 'webkit' as const,
};

// Desktop configurations
export const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1920, height: 1080 },
};

export const mobileChrome = {
  ...devices['Pixel 5'],
  viewport: { width: 393, height: 851 },
  hasTouch: true,
  isMobile: true,
};

// CI-specific configurations
export const ciDesktopConfig = {
  viewport: { width: 1280, height: 720 },
  hasTouch: false,
  isMobile: false,
  reducedMotion: 'reduce' as const,
  colorScheme: 'light' as const,
};

export const ciMobileConfig = {
  viewport: { width: 375, height: 667 }, // iPhone SE size for CI
  hasTouch: true,
  isMobile: true,
  reducedMotion: 'reduce' as const,
  colorScheme: 'light' as const,
};
