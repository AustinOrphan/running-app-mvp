import '@testing-library/jest-dom';
import { vi, afterEach, beforeAll, beforeEach } from 'vitest';
import 'jest-axe/extend-expect';
import { TestEnvironmentValidator } from './validateTestEnvironment';
import { createEndpointMocks } from './mockFactory';
import { suppressActWarnings, restoreConsoleError, configureReactTesting } from './reactTestingFix';
import {
  setupIntegrationTestMocks,
  resetIntegrationTestMocks,
  configureSuccessfulResponses,
} from './integrationTestMocking';
import { setupCSSModuleMocking } from './cssModuleMocking';

// Set up integration test mocks globally
setupIntegrationTestMocks();

// Set up CSS module mocking globally
setupCSSModuleMocking();

// Mock window.matchMedia for responsive tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock ResizeObserver for jsdom environment
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Ensure ResizeObserver is available globally for Recharts
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = ResizeObserverMock;
}
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverMock;
}

// Mock fetch globally with endpoint-specific responses
global.fetch = createEndpointMocks() as any;

// Mock scrollTo
global.scrollTo = vi.fn();

// Mock localStorage with authentication tokens
const localStorageMock = (() => {
  let store: Record<string, string> = {
    // Pre-populate with mock authentication tokens
    accessToken: 'mock-jwt-token-123',
    refreshToken: 'mock-refresh-token-456',
    authToken: 'mock-jwt-token-123', // Backward compatibility
  };

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {
        // Preserve auth tokens even after clear() for test stability
        accessToken: 'mock-jwt-token-123',
        refreshToken: 'mock-refresh-token-456',
        authToken: 'mock-jwt-token-123',
      };
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Validate test environment before running tests
beforeAll(async () => {
  // Configure React Testing Library for better async handling
  configureReactTesting();

  // Suppress act() warnings for async state updates
  suppressActWarnings();

  // Configure successful responses for integration tests
  configureSuccessfulResponses();

  // Only run validation if not in CI or if explicitly requested
  const shouldValidate =
    process.env.VALIDATE_TEST_ENV === 'true' ||
    (!process.env.CI && process.env.NODE_ENV !== 'test');

  if (shouldValidate) {
    const validator = new TestEnvironmentValidator();
    const result = await validator.validateEnvironment();

    if (!result.isValid) {
      console.error('\n🚨 Test Environment Validation Failed:');
      console.error(validator.generateReport(result));
      throw new Error('Test environment validation failed. Please fix the errors above.');
    }

    // Show warnings if any
    if (result.warnings.length > 0 || result.recommendations.length > 0) {
      console.warn('\n⚠️  Test Environment Validation Warnings:');
      console.warn(validator.generateReport(result));
    }
  }
});

// Note: Recharts components are mocked individually in test files as needed

// Reset fetch mock before each test to ensure clean state
beforeEach(() => {
  // Reset fetch to use our endpoint-specific mocks
  global.fetch = createEndpointMocks() as any;

  // Reset integration test mocks
  resetIntegrationTestMocks();
  configureSuccessfulResponses();
});

// Reset all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});

// Cleanup React testing configuration after all tests
afterAll(() => {
  restoreConsoleError();
});
