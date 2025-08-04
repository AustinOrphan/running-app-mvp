import { axe, toHaveNoViolations } from 'jest-axe';
import { RenderResult, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import {
  axeConfig,
  severityConfigs,
  SEVERITY_LEVELS,
  getRulesBySeverity,
  createAccessibilityConfig,
  getFalsePositiveRules,
} from '../setup/axeSetup';

// Extend expect with jest-axe matchers
expect.extend(toHaveNoViolations);

/**
 * Enhanced accessibility testing utilities
 * Provides comprehensive WCAG compliance checking beyond basic axe tests
 */

// This function is defined later in the file with proper AsyncLoadingOptions interface

/**
 * Enhanced async accessibility testing with retry logic
 */
export async function waitForAccessibleContent(
  container: HTMLElement,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    skipOnTimeout?: boolean;
  } = {}
): Promise<void> {
  const { maxRetries = 3, retryDelay = 200, timeout = 3000, skipOnTimeout = true } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await waitForAsyncContent(container, { timeout: timeout / maxRetries });
      return; // Success
    } catch (error) {
      if (attempt === maxRetries - 1) {
        if (skipOnTimeout) {
          console.warn(
            `Failed to wait for accessible content after ${maxRetries} attempts, proceeding anyway`
          );
          return;
        } else {
          throw error;
        }
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

/**
 * Wait for specific accessibility-critical elements to be ready
 */
export async function waitForA11yElements(
  container: HTMLElement,
  options: {
    waitForFocus?: boolean;
    waitForLabels?: boolean;
    waitForAria?: boolean;
    timeout?: number;
  } = {}
): Promise<void> {
  const { waitForFocus = true, waitForLabels = true, waitForAria = true, timeout = 3000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let allReady = true;

    // Wait for focus management to be ready
    if (waitForFocus) {
      const focusableElements = container.querySelectorAll(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      // Check if focus management is properly set up
      const focusReady = Array.from(focusableElements).every(el => {
        const htmlEl = el as HTMLElement;
        // Element should either be naturally focusable or have proper tabindex
        const tabIndex = htmlEl.getAttribute('tabindex');
        return tabIndex === null || parseInt(tabIndex) >= -1;
      });

      if (!focusReady) allReady = false;
    }

    // Wait for labels to be associated
    if (waitForLabels) {
      const formControls = container.querySelectorAll('input, select, textarea');
      const labelsReady = Array.from(formControls).every(control => {
        const htmlControl = control as HTMLElement;
        const hasLabel =
          htmlControl.hasAttribute('aria-label') ||
          htmlControl.hasAttribute('aria-labelledby') ||
          htmlControl.closest('label') ||
          document.querySelector(`label[for="${htmlControl.id}"]`);
        return hasLabel;
      });

      if (!labelsReady) allReady = false;
    }

    // Wait for ARIA attributes to be set
    if (waitForAria) {
      const ariaElements = container.querySelectorAll('[aria-labelledby], [aria-describedby]');
      const ariaReady = Array.from(ariaElements).every(el => {
        const htmlEl = el as HTMLElement;

        // Check if referenced elements exist
        const labelledBy = htmlEl.getAttribute('aria-labelledby');
        const describedBy = htmlEl.getAttribute('aria-describedby');

        if (labelledBy) {
          const labelIds = labelledBy.split(' ');
          const allLabelsExist = labelIds.every(id => document.getElementById(id));
          if (!allLabelsExist) return false;
        }

        if (describedBy) {
          const descIds = describedBy.split(' ');
          const allDescsExist = descIds.every(id => document.getElementById(id));
          if (!allDescsExist) return false;
        }

        return true;
      });

      if (!ariaReady) allReady = false;
    }

    if (allReady) return;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Don't throw - log warning and continue
  console.warn('Some accessibility elements may not be fully ready, proceeding with tests');
}

/**
 * Async loading utilities for accessibility testing
 */
export interface AsyncLoadingOptions {
  /** Custom condition to wait for */
  waitCondition?: () => Promise<boolean> | boolean;
  /** Maximum time to wait (ms) */
  timeout?: number;
  /** Polling interval (ms) */
  interval?: number;
}

/**
 * Wait for async content to load in the container
 * This is crucial for testing components that load data asynchronously
 */
export async function waitForAsyncContent(
  container: HTMLElement,
  options: AsyncLoadingOptions = {}
): Promise<void> {
  const { waitCondition, timeout = 5000, interval = 100 } = options;

  if (waitCondition) {
    // Use custom wait condition
    await waitFor(
      async () => {
        const result = await Promise.resolve(waitCondition());
        expect(result).toBe(true);
      },
      { timeout, interval }
    );
  } else {
    // Default: wait for common async loading indicators to disappear
    await waitFor(
      () => {
        // Wait for loading spinners, skeletons, or "loading..." text to disappear
        const loadingIndicators = container.querySelectorAll(
          '[data-testid*="loading"], [data-testid*="spinner"], [data-testid*="skeleton"], ' +
            '.loading, .spinner, .skeleton, ' +
            '[aria-label*="loading" i], [aria-label*="spinner" i]'
        );

        const loadingText = Array.from(container.querySelectorAll('*')).some(el =>
          el.textContent?.toLowerCase().includes('loading')
        );

        const hasAriaLive = container.querySelector(
          '[aria-live="polite"], [aria-live="assertive"]'
        );
        const isStillLoading =
          hasAriaLive &&
          (hasAriaLive.textContent?.toLowerCase().includes('loading') ||
            hasAriaLive.getAttribute('aria-busy') === 'true');

        // Content is loaded when no loading indicators are visible
        expect(loadingIndicators.length).toBe(0);
        expect(loadingText).toBe(false);
        expect(isStillLoading).toBe(false);
      },
      { timeout, interval }
    );
  }
}

/**
 * Wait for specific elements to appear (useful for async rendered content)
 */
export async function waitForElements(
  container: HTMLElement,
  selector: string,
  options: { timeout?: number; minimum?: number } = {}
): Promise<void> {
  const { timeout = 5000, minimum = 1 } = options;

  await waitFor(
    () => {
      const elements = container.querySelectorAll(selector);
      expect(elements.length).toBeGreaterThanOrEqual(minimum);
    },
    { timeout }
  );
}

/**
 * Wait for dynamic ARIA attributes to stabilize
 */
export async function waitForAriaStable(
  container: HTMLElement,
  options: { timeout?: number } = {}
): Promise<void> {
  const { timeout = 3000 } = options;

  await waitFor(
    () => {
      // Check that aria-busy attributes are false or removed
      const busyElements = container.querySelectorAll('[aria-busy="true"]');
      expect(busyElements.length).toBe(0);

      // Check that aria-live regions are not actively announcing loading
      const liveRegions = container.querySelectorAll('[aria-live]');
      Array.from(liveRegions).forEach(region => {
        const text = region.textContent?.toLowerCase() || '';
        expect(text.includes('loading')).toBe(false);
        expect(text.includes('fetching')).toBe(false);
      });
    },
    { timeout }
  );
}

/**
 * Comprehensive async loading handler that covers multiple scenarios
 */
export async function ensureContentLoaded(
  container: HTMLElement,
  options: {
    waitForElements?: string;
    waitCondition?: () => Promise<boolean> | boolean;
    timeout?: number;
    skipAriaStable?: boolean;
  } = {}
): Promise<void> {
  const {
    waitForElements: elementSelector,
    waitCondition,
    timeout = 5000,
    skipAriaStable = false,
  } = options;

  // Wait for basic async content loading
  await waitForAsyncContent(container, { waitCondition, timeout });

  // Wait for specific elements if provided
  if (elementSelector) {
    await waitForElements(container, elementSelector, { timeout });
  }

  // Wait for ARIA attributes to stabilize unless skipped
  if (!skipAriaStable) {
    await waitForAriaStable(container, { timeout: Math.min(timeout, 3000) });
  }

  // Give a small buffer for any final DOM updates
  await new Promise(resolve => setTimeout(resolve, 50));
}

export interface AccessibilityTestOptions {
  /** Include specific WCAG level checks (A, AA, AAA) */
  wcagLevel?: 'A' | 'AA' | 'AAA';
  /** Focus on specific accessibility categories */
  categories?: ('keyboard' | 'screen-reader' | 'color-contrast' | 'structure')[];
  /** Custom axe configuration */
  axeOptions?: any;
  /** Skip certain rule violations for this test */
  skipRules?: string[];
  /** Rule severity level to test (critical, high, medium, low, informational) */
  severityLevel?: keyof typeof SEVERITY_LEVELS;
  /** Wait for async content to load before testing */
  waitForAsync?: boolean;
  /** Custom async loading condition */
  waitCondition?: () => Promise<boolean> | boolean;
  /** Timeout for async loading (ms) */
  asyncTimeout?: number;
}

/**
 * Comprehensive accessibility test that includes axe checks plus custom assertions
 */
export async function expectAccessible(
  renderResult: RenderResult | HTMLElement,
  options: AccessibilityTestOptions = {}
): Promise<void> {
  const container = 'container' in renderResult ? renderResult.container : renderResult;
  const {
    wcagLevel = 'AA',
    categories = [],
    axeOptions = {},
    skipRules = [],
    severityLevel,
    waitForAsync = false,
    waitCondition,
    asyncTimeout = 5000,
  } = options;

  // Handle async component loading with enhanced strategies
  if (waitForAsync || waitCondition) {
    // Use enhanced async waiting with retry logic
    await waitForAccessibleContent(container, {
      timeout: asyncTimeout,
      maxRetries: 3,
      skipOnTimeout: true, // Don't fail tests due to async timing
    });

    // Wait for accessibility-critical elements to be ready
    await waitForA11yElements(container, {
      waitForFocus: categories.includes('keyboard'),
      waitForLabels: categories.includes('screen-reader'),
      waitForAria: categories.includes('screen-reader'),
      timeout: Math.min(asyncTimeout / 2, 2000), // Shorter timeout for a11y elements
    });
  }

  // Choose configuration based on severity level
  let testConfig;
  if (severityLevel) {
    const configKey = severityLevel as keyof typeof severityConfigs;
    testConfig = severityConfigs[configKey] || severityConfigs.essential;
  } else {
    // Build configuration based on WCAG level
    testConfig = {
      ...baseConfig,
      ...axeOptions,
      tags: [`wcag2${wcagLevel.toLowerCase()}`, ...(axeOptions.tags || [])],
      rules: {
        // Use enhanced configuration with false-positive rules disabled
        ...baseConfig.rules,
        // Apply any additional custom rules
        ...axeOptions.rules,
        // Disable explicitly skipped rules
        ...skipRules.reduce((acc, rule) => ({ ...acc, [rule]: { enabled: false } }), {}),
      },
    };
  }

  const results = await axe(container, testConfig);
  expect(results).toHaveNoViolations();

  // Run category-specific tests
  if (categories.includes('keyboard')) {
    await expectKeyboardAccessible(container);
  }
  if (categories.includes('screen-reader')) {
    await expectScreenReaderAccessible(container);
  }
  if (categories.includes('color-contrast')) {
    await expectColorContrastCompliant(container);
  }
  if (categories.includes('structure')) {
    await expectStructurallyAccessible(container);
  }
}

/**
 * Test keyboard accessibility
 */
export async function expectKeyboardAccessible(container: HTMLElement): Promise<void> {
  // Find all interactive elements
  const interactiveElements = container.querySelectorAll(
    'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]'
  );

  // All interactive elements should be keyboard focusable
  interactiveElements.forEach(element => {
    const htmlElement = element as HTMLElement;

    // Skip hidden elements
    if (htmlElement.style.display === 'none' || htmlElement.hasAttribute('hidden')) {
      return;
    }

    // Element should be focusable (tabindex >= 0 or naturally focusable)
    const tabIndex = htmlElement.getAttribute('tabindex');
    const isFocusable = tabIndex === null || parseInt(tabIndex) >= 0;

    expect(isFocusable).toBe(true);
    expect(htmlElement.getAttribute('aria-hidden')).not.toBe('true');
  });
}

/**
 * Test screen reader accessibility
 */
export async function expectScreenReaderAccessible(container: HTMLElement): Promise<void> {
  // Check for proper ARIA labels and descriptions
  const elementsNeedingLabels = container.querySelectorAll(
    'input:not([type="hidden"]), select, textarea, button:not([aria-label]):not([aria-labelledby])'
  );

  elementsNeedingLabels.forEach(element => {
    const htmlElement = element as HTMLElement;

    // Skip if element has other labeling mechanisms
    const associatedLabel = document.querySelector(`label[for="${htmlElement.id}"]`);
    if (htmlElement.closest('label') || associatedLabel) {
      return;
    }

    const hasAriaLabel = htmlElement.hasAttribute('aria-label');
    const hasAriaLabelledBy = htmlElement.hasAttribute('aria-labelledby');
    const hasTitle = htmlElement.hasAttribute('title');

    // At least one labeling mechanism should be present
    if (!hasAriaLabel && !hasAriaLabelledBy && !hasTitle) {
      console.warn(`Element missing accessible label:`, htmlElement.outerHTML);
    }
    expect(hasAriaLabel || hasAriaLabelledBy || hasTitle).toBe(true);
  });

  // Check for proper heading structure (only for page-level content)
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
  if (headings.length > 0) {
    // For component tests, just verify heading order is logical
    let previousLevel = 0;
    let hasValidStructure = true;

    Array.from(headings).forEach(heading => {
      const tagName = heading.tagName;
      const currentLevel =
        tagName === 'H1'
          ? 1
          : tagName === 'H2'
            ? 2
            : tagName === 'H3'
              ? 3
              : tagName === 'H4'
                ? 4
                : tagName === 'H5'
                  ? 5
                  : tagName === 'H6'
                    ? 6
                    : parseInt(heading.getAttribute('aria-level') || '1');

      // Allow h1 anywhere in component tests, but check logical progression otherwise
      if (previousLevel > 0 && currentLevel > previousLevel + 1) {
        hasValidStructure = false;
      }
      previousLevel = currentLevel;
    });

    expect(hasValidStructure).toBe(true);
  }
}

/**
 * Test color contrast compliance
 */
export async function expectColorContrastCompliant(container: HTMLElement): Promise<void> {
  // This is a basic check - more sophisticated color contrast testing
  // would require actual color computation which is complex in jsdom

  const textElements = container.querySelectorAll(
    'p, span, div, h1, h2, h3, h4, h5, h6, button, a, label'
  );

  textElements.forEach(element => {
    const htmlElement = element as HTMLElement;
    const computedStyle = window.getComputedStyle(htmlElement);

    // Basic checks for transparent or invisible text
    expect(computedStyle.color).not.toBe('transparent');
    expect(computedStyle.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(computedStyle.opacity).not.toBe('0');
  });
}

/**
 * Test structural accessibility
 */
export async function expectStructurallyAccessible(container: HTMLElement): Promise<void> {
  // Check for proper landmark usage
  const landmarks = container.querySelectorAll(
    'main, nav, aside, header, footer, section, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"]'
  );

  // If page content is present, should have main landmark
  const hasSignificantContent = container.querySelectorAll('p, div, section, article').length > 2;
  if (hasSignificantContent) {
    const hasMain = Array.from(landmarks).some(
      el => el.tagName === 'MAIN' || el.getAttribute('role') === 'main'
    );
    // This is a soft recommendation, not a hard requirement for components
    if (!hasMain) {
      console.warn('Consider adding a main landmark for better page structure');
    }
  }

  // Check for proper list structure
  const listItems = container.querySelectorAll('li');
  listItems.forEach(li => {
    const parent = li.parentElement;
    const isInList = parent && ['UL', 'OL', 'MENU'].includes(parent.tagName);
    const hasListRole =
      parent && ['list', 'menu', 'menubar'].includes(parent.getAttribute('role') || '');

    expect(isInList || hasListRole).toBe(true);
  });

  // Check for proper table structure
  const tableCells = container.querySelectorAll('td, th');
  tableCells.forEach(cell => {
    const table = cell.closest('table, [role="table"]');
    expect(table).toBeTruthy();
  });
}

/**
 * Custom matchers for specific accessibility patterns
 */
export const accessibilityMatchers = {
  /**
   * Test that form controls have proper labels
   */
  toHaveAccessibleLabel: (element: HTMLElement) => {
    const hasAriaLabel = element.hasAttribute('aria-label');
    const hasAriaLabelledBy = element.hasAttribute('aria-labelledby');
    const hasLabel =
      !!element.closest('label') || !!document.querySelector(`label[for="${element.id}"]`);
    const hasTitle = element.hasAttribute('title');

    const pass = hasAriaLabel || hasAriaLabelledBy || hasLabel || hasTitle;

    return {
      pass,
      message: () => `Expected element to have an accessible label`,
    };
  },

  /**
   * Test that interactive elements can receive keyboard focus
   */
  toBeKeyboardFocusable: (element: HTMLElement) => {
    const tabIndex = element.getAttribute('tabindex');
    const isNaturallyFocusable = ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A'].includes(
      element.tagName
    );
    const hasPositiveTabIndex = tabIndex !== null && parseInt(tabIndex) >= 0;

    const pass = isNaturallyFocusable || hasPositiveTabIndex;

    return {
      pass,
      message: () => `Expected element to be keyboard focusable`,
    };
  },

  /**
   * Test that elements have proper ARIA roles
   */
  toHaveValidAriaRole: (element: HTMLElement) => {
    const role = element.getAttribute('role');
    if (!role) return { pass: true, message: () => '' };

    // List of valid ARIA roles (simplified)
    const validRoles = [
      'alert',
      'application',
      'article',
      'banner',
      'button',
      'cell',
      'checkbox',
      'columnheader',
      'combobox',
      'complementary',
      'contentinfo',
      'definition',
      'dialog',
      'directory',
      'document',
      'form',
      'grid',
      'gridcell',
      'group',
      'heading',
      'img',
      'link',
      'list',
      'listbox',
      'listitem',
      'log',
      'main',
      'marquee',
      'math',
      'menu',
      'menubar',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'navigation',
      'note',
      'option',
      'presentation',
      'progressbar',
      'radio',
      'radiogroup',
      'region',
      'row',
      'rowgroup',
      'rowheader',
      'scrollbar',
      'search',
      'separator',
      'slider',
      'spinbutton',
      'status',
      'tab',
      'tablist',
      'tabpanel',
      'textbox',
      'timer',
      'toolbar',
      'tooltip',
      'tree',
      'treeitem',
    ];

    const pass = validRoles.includes(role);

    return {
      pass,
      message: () => `Expected element to have a valid ARIA role, but got "${role}"`,
    };
  },
};

/**
 * WCAG compliance test configurations
 */
export const wcagTestConfigs = {
  levelA: {
    tags: ['wcag2a'],
    rules: {
      // Level A requirements
      'image-alt': { enabled: true },
      'input-button-name': { enabled: true },
      label: { enabled: true },
      'link-name': { enabled: true },
    },
  },
  levelAA: {
    tags: ['wcag2a', 'wcag2aa'],
    rules: {
      // Level AA requirements (includes Level A)
      'color-contrast': { enabled: true },
      'focus-order-semantics': { enabled: true },
      'heading-order': { enabled: true },
    },
  },
  levelAAA: {
    tags: ['wcag2a', 'wcag2aa', 'wcag2aaa'],
    rules: {
      // Level AAA requirements (includes Level A and AA)
      'color-contrast-enhanced': { enabled: true },
    },
  },
};

/**
 * Utility to run accessibility tests with different configurations
 */
export async function testAccessibilityCompliance(
  container: HTMLElement,
  level: 'A' | 'AA' | 'AAA' = 'AA',
  context: 'component' | 'integration' | 'e2e' = 'component'
): Promise<void> {
  // Use the enhanced configuration with false-positive handling
  const config = createAccessibilityConfig(context);

  // Adjust tags based on WCAG level
  const levelTags = {
    A: ['wcag2a'],
    AA: ['wcag2a', 'wcag2aa'],
    AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa'],
  };

  const enhancedConfig = {
    ...config,
    tags: levelTags[level] || levelTags['AA'],
  };

  const results = await axe(container, enhancedConfig);
  expect(results).toHaveNoViolations();
}

/**
 * Helper to create accessible test scenarios with async support
 */
export const accessibilityScenarios = {
  /**
   * Test form accessibility with async validation and dynamic content
   */
  async testForm(container: HTMLElement): Promise<void> {
    await expectAccessible(container, {
      categories: ['keyboard', 'screen-reader'],
      wcagLevel: 'AA',
      waitForAsync: true,
      asyncTimeout: 3000,
    });

    // Wait for form validation states to stabilize
    await waitForAsyncContent(container, {
      waitCondition: () => {
        // Check if validation messages have loaded
        const errorElements = container.querySelectorAll(
          '[role="alert"], .error-message, [aria-invalid="true"] + *'
        );
        const loadingElements = container.querySelectorAll('[data-validating], .validating');
        return loadingElements.length === 0; // No validation in progress
      },
      timeout: 2000,
    });

    // Additional form-specific checks
    const formControls = container.querySelectorAll('input, select, textarea');
    formControls.forEach(control => {
      const htmlControl = control as HTMLElement;

      // Check for labels (may be async)
      const hasLabel =
        htmlControl.hasAttribute('aria-label') ||
        htmlControl.hasAttribute('aria-labelledby') ||
        htmlControl.closest('label') ||
        document.querySelector(`label[for="${htmlControl.id}"]`);

      expect(hasLabel).toBe(true);
    });
  },

  /**
   * Test navigation accessibility with dynamic menu content
   */
  async testNavigation(container: HTMLElement): Promise<void> {
    await expectAccessible(container, {
      categories: ['keyboard', 'structure'],
      wcagLevel: 'AA',
      waitForAsync: true,
      asyncTimeout: 2000,
    });

    // Wait for navigation menus to fully load
    await waitForAsyncContent(container, {
      waitCondition: () => {
        // Check if dropdowns/submenus have loaded
        const menuToggles = container.querySelectorAll('[aria-expanded]');
        const loadingMenus = container.querySelectorAll('.menu-loading, [data-menu-loading]');
        return loadingMenus.length === 0;
      },
      timeout: 1500,
    });

    // Navigation-specific checks
    const navElements = container.querySelectorAll('nav, [role="navigation"]');
    navElements.forEach(nav => {
      const hasAriaLabel = nav.hasAttribute('aria-label');
      const hasAriaLabelledBy = nav.hasAttribute('aria-labelledby');

      if (navElements.length > 1) {
        expect(hasAriaLabel || hasAriaLabelledBy).toBe(true);
      }
    });
  },

  /**
   * Test modal/dialog accessibility with dynamic content loading
   */
  async testModal(container: HTMLElement): Promise<void> {
    await expectAccessible(container, {
      categories: ['keyboard', 'screen-reader'],
      wcagLevel: 'AA',
      waitForAsync: true,
      asyncTimeout: 3000,
    });

    // Wait for modal content to fully load
    await waitForAsyncContent(container, {
      waitCondition: () => {
        // Check if modal content has finished loading
        const modalContent = container.querySelectorAll(
          '[role="dialog"] .content, [role="alertdialog"] .content'
        );
        const loadingContent = container.querySelectorAll('.modal-loading, [data-modal-loading]');
        return loadingContent.length === 0 && modalContent.length > 0;
      },
      timeout: 2000,
    });

    // Modal-specific checks
    const modals = container.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    modals.forEach(modal => {
      const htmlModal = modal as HTMLElement;

      expect(
        htmlModal.hasAttribute('aria-labelledby') || htmlModal.hasAttribute('aria-label')
      ).toBe(true);
      expect(htmlModal.getAttribute('aria-modal')).toBe('true');
    });
  },

  /**
   * Test data table accessibility with async data loading
   */
  async testDataTable(container: HTMLElement): Promise<void> {
    await expectAccessible(container, {
      categories: ['keyboard', 'screen-reader', 'structure'],
      wcagLevel: 'AA',
      waitForAsync: true,
      asyncTimeout: 4000,
    });

    // Wait for table data to load
    await waitForAsyncContent(container, {
      waitCondition: () => {
        const tables = container.querySelectorAll('table, [role="table"]');
        const loadingStates = container.querySelectorAll('.table-loading, [data-table-loading]');
        const emptyStates = container.querySelectorAll('.table-empty, [data-table-empty]');

        return (
          Array.from(tables).every(table => {
            const rows = table.querySelectorAll('tr, [role="row"]');
            return rows.length > 1 || emptyStates.length > 0; // Has data rows or empty state
          }) && loadingStates.length === 0
        );
      },
      timeout: 3000,
    });

    // Table-specific accessibility checks
    const tables = container.querySelectorAll('table, [role="table"]');
    tables.forEach(table => {
      const headers = table.querySelectorAll('th, [role="columnheader"]');
      const dataCells = table.querySelectorAll('td, [role="cell"]');

      // Tables should have headers if they have data
      if (dataCells.length > 0) {
        expect(headers.length).toBeGreaterThan(0);
      }
    });
  },

  /**
   * Test async loading states and feedback
   */
  async testLoadingStates(container: HTMLElement): Promise<void> {
    // Test loading state accessibility
    const loadingElements = container.querySelectorAll(
      '[aria-busy="true"], [data-loading], .loading, [role="status"]'
    );

    loadingElements.forEach(element => {
      const htmlElement = element as HTMLElement;

      // Loading elements should be announced
      const hasAriaLabel = htmlElement.hasAttribute('aria-label');
      const hasAriaLabelledBy = htmlElement.hasAttribute('aria-labelledby');
      const hasAriaLive = htmlElement.hasAttribute('aria-live');
      const hasStatusRole = htmlElement.getAttribute('role') === 'status';

      expect(hasAriaLabel || hasAriaLabelledBy || hasAriaLive || hasStatusRole).toBe(true);
    });

    // Wait for content to load, then test final state
    await waitForAccessibleContent(container, {
      timeout: 5000,
      skipOnTimeout: true,
    });

    await expectAccessible(container, {
      categories: ['screen-reader'],
      wcagLevel: 'AA',
    });
  },

  /**
   * Test dynamic content updates and live regions
   */
  async testLiveRegions(container: HTMLElement): Promise<void> {
    const liveRegions = container.querySelectorAll('[aria-live], [role="status"], [role="alert"]');

    liveRegions.forEach(region => {
      const htmlRegion = region as HTMLElement;
      const ariaLive = htmlRegion.getAttribute('aria-live');
      const role = htmlRegion.getAttribute('role');

      // Live regions should have appropriate politeness levels
      if (ariaLive) {
        expect(['polite', 'assertive', 'off']).toContain(ariaLive);
      } else if (role === 'status') {
        // Status role implies aria-live="polite"
        expect(true).toBe(true);
      } else if (role === 'alert') {
        // Alert role implies aria-live="assertive"
        expect(true).toBe(true);
      }
    });

    await expectAccessible(container, {
      categories: ['screen-reader'],
      wcagLevel: 'AA',
      waitForAsync: true,
    });
  },
};

// Severity-based testing functions
/**
 * Test only critical accessibility issues (fastest, for smoke tests)
 */
export async function expectCriticalAccessibility(
  renderResult: RenderResult | HTMLElement
): Promise<void> {
  await expectAccessible(renderResult, { severityLevel: 'critical' });
}

/**
 * Test essential accessibility issues (critical + high severity, for CI)
 */
export async function expectEssentialAccessibility(
  renderResult: RenderResult | HTMLElement
): Promise<void> {
  await expectAccessible(renderResult, { severityLevel: 'essential' });
}

/**
 * Test comprehensive accessibility (all except informational, for thorough testing)
 */
export async function expectComprehensiveAccessibility(
  renderResult: RenderResult | HTMLElement
): Promise<void> {
  await expectAccessible(renderResult, { severityLevel: 'comprehensive' });
}

/**
 * Full accessibility audit (all rules including informational)
 */
export async function expectFullAccessibilityAudit(
  renderResult: RenderResult | HTMLElement
): Promise<void> {
  await expectAccessible(renderResult, { severityLevel: 'fullAudit' });
}

/**
 * E2E accessibility testing (includes page-level rules)
 */
export async function expectE2EAccessibility(
  renderResult: RenderResult | HTMLElement
): Promise<void> {
  await expectAccessible(renderResult, { severityLevel: 'e2e' });
}

/**
 * Custom severity level testing
 */
export async function expectAccessibilityBySeverity(
  renderResult: RenderResult | HTMLElement,
  severityLevel: keyof typeof SEVERITY_LEVELS,
  additionalOptions: Omit<AccessibilityTestOptions, 'severityLevel'> = {}
): Promise<void> {
  await expectAccessible(renderResult, {
    ...additionalOptions,
    severityLevel,
  });
}

/**
 * Get rule configuration for a specific severity level
 */
export const getAccessibilityConfig = (severityLevel: keyof typeof SEVERITY_LEVELS) => {
  return severityConfigs[severityLevel] || severityConfigs.essential;
};

/**
 * Batch accessibility testing with different severity levels
 */
export const accessibilityTestSuite = {
  /**
   * Run smoke test (critical issues only)
   */
  async smokeTest(container: RenderResult | HTMLElement): Promise<void> {
    await expectCriticalAccessibility(container);
  },

  /**
   * Run standard CI test (critical + high severity)
   */
  async ciTest(container: RenderResult | HTMLElement): Promise<void> {
    await expectEssentialAccessibility(container);
  },

  /**
   * Run comprehensive test (all except informational)
   */
  async comprehensiveTest(container: RenderResult | HTMLElement): Promise<void> {
    await expectComprehensiveAccessibility(container);
  },

  /**
   * Run full audit (all rules)
   */
  async fullAudit(container: RenderResult | HTMLElement): Promise<void> {
    await expectFullAccessibilityAudit(container);
  },

  /**
   * Run progressive testing (start with critical, move to comprehensive)
   */
  async progressiveTest(container: RenderResult | HTMLElement): Promise<{
    critical: boolean;
    essential: boolean;
    comprehensive: boolean;
    errors: string[];
  }> {
    const results = {
      critical: false,
      essential: false,
      comprehensive: false,
      errors: [] as string[],
    };

    try {
      await expectCriticalAccessibility(container);
      results.critical = true;
    } catch (error) {
      results.errors.push(`Critical: ${error.message}`);
    }

    try {
      await expectEssentialAccessibility(container);
      results.essential = true;
    } catch (error) {
      results.errors.push(`Essential: ${error.message}`);
    }

    try {
      await expectComprehensiveAccessibility(container);
      results.comprehensive = true;
    } catch (error) {
      results.errors.push(`Comprehensive: ${error.message}`);
    }

    return results;
  },
};
