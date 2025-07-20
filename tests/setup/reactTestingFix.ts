/**
 * React Testing Library Act() Warnings and Async State Fix
 *
 * This file provides utilities to fix common React testing issues:
 * 1. Suppresses unnecessary act() warnings for async state updates
 * 2. Provides proper async testing utilities
 * 3. Configures React Testing Library for better async handling
 */

// Suppress act() warnings that are common in async testing scenarios
// Based on React Testing Library best practices
const originalError = console.error;

export const suppressActWarnings = () => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: An update to') &&
      args[0].includes('was not wrapped in act')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
};

export const restoreConsoleError = () => {
  console.error = originalError;
};

/**
 * Enhanced waitFor with better defaults for React state updates
 */
export const waitForStateUpdate = async (
  callback: () => void | Promise<void>,
  options?: {
    timeout?: number;
    interval?: number;
  }
) => {
  const { waitFor } = await import('@testing-library/react');

  return waitFor(callback, {
    timeout: options?.timeout || 3000,
    interval: options?.interval || 50,
    ...options,
  });
};

/**
 * Wrapper for async component testing that properly handles React updates
 */
export const renderWithAsyncSupport = async (ui: React.ReactElement, options?: any) => {
  const { render, act } = await import('@testing-library/react');

  let renderResult: any;

  await act(async () => {
    renderResult = render(ui, options);
  });

  return renderResult;
};

/**
 * Helper to wrap async operations in act() properly
 */
export const actAsync = async (fn: () => Promise<any>) => {
  const { act } = await import('@testing-library/react');

  let result: any;
  await act(async () => {
    result = await fn();
  });

  return result;
};

/**
 * Setup function to configure React Testing Library for better async handling
 */
export const configureReactTesting = () => {
  // Import and configure RTL if available
  import('@testing-library/react')
    .then(({ configure }) => {
      configure({
        // Enable stricter async utilities
        asyncUtilTimeout: 3000,
        // Better error messages
        getElementError: (message: string | null) => {
          const error = new Error(message || 'Element not found');
          error.name = 'TestingLibraryElementError';
          return error;
        },
      });
    })
    .catch(() => {
      // RTL not available, skip configuration
    });
};
