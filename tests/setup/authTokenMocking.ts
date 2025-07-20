/**
 * Authentication Token Mocking Setup for Vitest
 *
 * This module provides utilities for mocking localStorage authentication tokens
 * in tests, ensuring that apiFetch utilities can access required authentication
 * data in the test environment.
 */

import { vi } from 'vitest';

// Mock localStorage for authentication tokens
export const createAuthTokenMocks = () => {
  const mockLocalStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };

  // Make localStorage available globally
  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
  });

  return mockLocalStorage;
};

// Set up default auth tokens for tests
export const setupAuthTokens = (mockLocalStorage: any) => {
  const mockToken = 'mock-jwt-token-123';
  const mockRefreshToken = 'mock-refresh-token-456';

  // Mock localStorage.getItem to return mock tokens
  mockLocalStorage.getItem.mockImplementation((key: string) => {
    switch (key) {
      case 'accessToken':
        return mockToken;
      case 'refreshToken':
        return mockRefreshToken;
      case 'authToken':
        return mockToken; // Backward compatibility
      default:
        return null;
    }
  });

  return { mockToken, mockRefreshToken };
};

// Setup function to be called in test setup files
export const setupAuthTokenMocking = () => {
  console.log('Authentication token mocking configured');

  const mockLocalStorage = createAuthTokenMocks();
  const tokens = setupAuthTokens(mockLocalStorage);

  return { mockLocalStorage, ...tokens };
};

// Reset function for between tests
export const resetAuthTokens = (mockLocalStorage: any) => {
  mockLocalStorage.getItem.mockReset();
  mockLocalStorage.setItem.mockReset();
  mockLocalStorage.removeItem.mockReset();
  mockLocalStorage.clear.mockReset();
};
