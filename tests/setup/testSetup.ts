import '@testing-library/jest-dom';
import { vi, afterEach, beforeAll } from 'vitest';
import 'jest-axe/extend-expect';
import { TestEnvironmentValidator } from './validateTestEnvironment';

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

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock fetch globally with default safe response
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve([]),
  text: () => Promise.resolve(''),
}) as any;

// Mock scrollTo
global.scrollTo = vi.fn();

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Validate test environment before running tests
beforeAll(async () => {
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

// Reset all mocks after each test
afterEach(() => {
  vi.clearAllMocks();
  localStorageMock.clear();
});
