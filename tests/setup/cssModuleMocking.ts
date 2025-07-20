/**
 * CSS Module Mocking for Tests
 *
 * This module provides CSS module mocking to ensure tests can use predictable
 * class names instead of CSS module hashed names like "_active_f4aee4".
 *
 * Based on Vite CSS modules best practices for testing environments.
 */

// import { vi } from 'vitest';

// CSS module mock that returns the original class name
export const createCSSModuleMock = (cssContent?: string) => {
  // For CSS modules, return a Proxy that returns the class name as-is
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop === 'string') {
          // Return the original class name for testing
          return prop;
        }
        return undefined;
      },
      has() {
        return true;
      },
      ownKeys() {
        // If we have CSS content, try to extract class names
        if (cssContent) {
          const classNames = cssContent.match(/\.([a-zA-Z0-9_-]+)/g);
          return classNames ? classNames.map(name => name.slice(1)) : [];
        }
        return [];
      },
      getOwnPropertyDescriptor() {
        return {
          enumerable: true,
          configurable: true,
        };
      },
    }
  );
};

// Mock CSS file imports to return empty string
export const createCSSMock = () => '';

// Mock SCSS/SASS file imports to return empty string
export const createSCSSMock = () => '';

// Mock Less file imports to return empty string
export const createLessMock = () => '';

// Mock Stylus file imports to return empty string
export const createStylusMock = () => '';

// Setup CSS module mocking in Vitest using module resolution
export const setupCSSModuleMocking = () => {
  // Note: Vitest handles CSS modules differently than Jest
  // We'll configure this through Vite config instead
  console.log('CSS module mocking configured through Vite config');
};

// Advanced CSS module mock that can handle specific class names
export const createNamedCSSModuleMock = (classNames: string[]) => {
  const mockObject: Record<string, string> = {};

  // Create predictable mappings for known class names
  classNames.forEach(className => {
    mockObject[className] = className;
  });

  return new Proxy(mockObject, {
    get(target, prop) {
      if (typeof prop === 'string') {
        // Return known class name or fall back to the prop itself
        return target[prop] || prop;
      }
      return undefined;
    },
    has(target, prop) {
      return typeof prop === 'string';
    },
    ownKeys(target) {
      return Object.keys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      return {
        enumerable: true,
        configurable: true,
        value: target[prop as string] || prop,
      };
    },
  });
};

// Common CSS class names used in the application
export const commonCSSClasses = {
  // Layout classes
  container: 'container',
  wrapper: 'wrapper',
  content: 'content',
  header: 'header',
  footer: 'footer',
  sidebar: 'sidebar',

  // State classes
  active: 'active',
  inactive: 'inactive',
  loading: 'loading',
  disabled: 'disabled',
  selected: 'selected',
  expanded: 'expanded',
  collapsed: 'collapsed',

  // Component classes
  button: 'button',
  input: 'input',
  modal: 'modal',
  card: 'card',
  table: 'table',
  row: 'row',
  cell: 'cell',

  // Utility classes
  hidden: 'hidden',
  visible: 'visible',
  error: 'error',
  success: 'success',
  warning: 'warning',
  primary: 'primary',
  secondary: 'secondary',

  // Sorting classes
  sortable: 'sortable',
  sortAsc: 'sort-asc',
  sortDesc: 'sort-desc',

  // Animation classes
  fade: 'fade',
  slide: 'slide',
  bounce: 'bounce',
};

// Create a comprehensive CSS module mock with common classes
export const createComprehensiveCSSModuleMock = () => {
  return createNamedCSSModuleMock(Object.values(commonCSSClasses));
};
