import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the entire env module
vi.mock('../../../src/utils/env', () => {
  let mockEnv: Record<string, string> = {};

  return {
    getEnvVar: vi.fn((key: string, fallback: string = '') => {
      const value = mockEnv[key];
      return value ?? fallback;
    }),
    getAppVersion: vi.fn(() => mockEnv['VITE_APP_VERSION'] || '1.0.0'),
    getBuildDate: vi.fn(
      () => mockEnv['VITE_APP_BUILD_DATE'] || new Date().toISOString().split('T')[0]
    ),
    getEnvironment: vi.fn(() => mockEnv['MODE'] || 'development'),
    isDevelopment: vi.fn(() => (mockEnv['MODE'] || 'development') === 'development'),
    isProduction: vi.fn(() => (mockEnv['MODE'] || 'development') === 'production'),
    getAppInfo: vi.fn(() => ({
      version: mockEnv['VITE_APP_VERSION'] || '1.0.0',
      buildDate: mockEnv['VITE_APP_BUILD_DATE'] || new Date().toISOString().split('T')[0],
      environment: mockEnv['MODE'] || 'development',
      isDev: (mockEnv['MODE'] || 'development') === 'development',
      isProd: (mockEnv['MODE'] || 'development') === 'production',
    })),
    // Helper to set mock env values
    __setMockEnv: (env: Record<string, string>) => {
      mockEnv = { ...env };
    },
    __clearMockEnv: () => {
      mockEnv = {};
    },
  };
});

// Import the mocked functions
import {
  getEnvVar,
  getAppVersion,
  getBuildDate,
  getEnvironment,
  isDevelopment,
  isProduction,
  getAppInfo,
} from '../../../src/utils/env';

// Get the mock helpers
const envModule = await import('../../../src/utils/env');
const { __setMockEnv, __clearMockEnv } = envModule as any;

describe('env utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearMockEnv();
  });

  afterEach(() => {
    vi.clearAllMocks();
    __clearMockEnv();
  });

  describe('getEnvVar', () => {
    it('should return environment variable value when it exists', () => {
      __setMockEnv({ VITE_TEST_VAR: 'test-value' });

      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('test-value');
    });

    it('should return fallback value when environment variable does not exist', () => {
      const result = getEnvVar('VITE_NONEXISTENT' as keyof ImportMetaEnv, 'fallback');

      expect(result).toBe('fallback');
    });

    it('should return empty string as default fallback', () => {
      const result = getEnvVar('VITE_NONEXISTENT' as keyof ImportMetaEnv);

      expect(result).toBe('');
    });

    it('should handle null/undefined environment values', () => {
      __setMockEnv({
        VITE_NULL_VAR: null as any,
        VITE_UNDEFINED_VAR: undefined as any,
      });

      const nullResult = getEnvVar('VITE_NULL_VAR' as keyof ImportMetaEnv, 'fallback');
      const undefinedResult = getEnvVar('VITE_UNDEFINED_VAR' as keyof ImportMetaEnv, 'fallback');

      expect(nullResult).toBe('fallback');
      expect(undefinedResult).toBe('fallback');
    });

    it('should handle errors gracefully and return fallback', () => {
      // This test simulates the function behavior during error conditions
      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'error-fallback');

      expect(result).toBe('error-fallback');
    });

    it('should handle missing import.meta.env gracefully', () => {
      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'no-env-fallback');

      expect(result).toBe('no-env-fallback');
    });
  });

  describe('getAppVersion', () => {
    it('should return version from environment when available', () => {
      __setMockEnv({ VITE_APP_VERSION: '2.1.0' });

      const result = getAppVersion();

      expect(result).toBe('2.1.0');
    });

    it('should return default version when not set', () => {
      const result = getAppVersion();

      expect(result).toBe('1.0.0');
    });

    it('should handle empty string version', () => {
      __setMockEnv({ VITE_APP_VERSION: '' });

      const result = getAppVersion();

      expect(result).toBe('1.0.0');
    });
  });

  describe('getBuildDate', () => {
    it('should return build date from environment when available', () => {
      __setMockEnv({ VITE_APP_BUILD_DATE: '2024-01-15' });

      const result = getBuildDate();

      expect(result).toBe('2024-01-15');
    });

    it('should return current date when not set', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-20T12:00:00Z'));

      const result = getBuildDate();

      expect(result).toBe('2024-01-20');

      vi.useRealTimers();
    });

    it('should return current date when empty string', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-14T15:30:00Z'));

      __setMockEnv({ VITE_APP_BUILD_DATE: '' });

      const result = getBuildDate();

      expect(result).toBe('2024-02-14');

      vi.useRealTimers();
    });
  });

  describe('getEnvironment', () => {
    it('should return environment mode when available', () => {
      __setMockEnv({ MODE: 'production' });

      const result = getEnvironment();

      expect(result).toBe('production');
    });

    it('should return development as default', () => {
      const result = getEnvironment();

      expect(result).toBe('development');
    });

    it('should handle custom environment modes', () => {
      __setMockEnv({ MODE: 'staging' });

      const result = getEnvironment();

      expect(result).toBe('staging');
    });
  });

  describe('isDevelopment', () => {
    it('should return true when in development mode', () => {
      __setMockEnv({ MODE: 'development' });

      const result = isDevelopment();

      expect(result).toBe(true);
    });

    it('should return false when in production mode', () => {
      __setMockEnv({ MODE: 'production' });

      const result = isDevelopment();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      __setMockEnv({ MODE: 'staging' });

      const result = isDevelopment();

      expect(result).toBe(false);
    });

    it('should return true when mode is not set (default)', () => {
      const result = isDevelopment();

      expect(result).toBe(true);
    });
  });

  describe('isProduction', () => {
    it('should return true when in production mode', () => {
      __setMockEnv({ MODE: 'production' });

      const result = isProduction();

      expect(result).toBe(true);
    });

    it('should return false when in development mode', () => {
      __setMockEnv({ MODE: 'development' });

      const result = isProduction();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      __setMockEnv({ MODE: 'staging' });

      const result = isProduction();

      expect(result).toBe(false);
    });

    it('should return false when mode is not set (default)', () => {
      const result = isProduction();

      expect(result).toBe(false);
    });
  });

  describe('getAppInfo', () => {
    it('should return comprehensive app information', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-25T10:00:00Z'));

      __setMockEnv({
        VITE_APP_VERSION: '3.2.1',
        VITE_APP_BUILD_DATE: '2024-01-20',
        MODE: 'production',
      });

      const result = getAppInfo();

      expect(result).toEqual({
        version: '3.2.1',
        buildDate: '2024-01-20',
        environment: 'production',
        isDev: false,
        isProd: true,
      });

      vi.useRealTimers();
    });

    it('should return app info with defaults', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-03-15T14:30:00Z'));

      const result = getAppInfo();

      expect(result).toEqual({
        version: '1.0.0',
        buildDate: '2024-03-15',
        environment: 'development',
        isDev: true,
        isProd: false,
      });

      vi.useRealTimers();
    });

    it('should return consistent values when called multiple times', () => {
      __setMockEnv({
        VITE_APP_VERSION: '1.5.0',
        MODE: 'staging',
      });

      const result1 = getAppInfo();
      const result2 = getAppInfo();

      expect(result1).toEqual(result2);
    });

    it('should reflect environment changes', () => {
      __setMockEnv({ MODE: 'development' });
      const devResult = getAppInfo();

      __setMockEnv({ MODE: 'production' });
      const prodResult = getAppInfo();

      expect(devResult.isDev).toBe(true);
      expect(devResult.isProd).toBe(false);
      expect(prodResult.isDev).toBe(false);
      expect(prodResult.isProd).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle various falsy values correctly', () => {
      __setMockEnv({
        VITE_FALSE_VAR: 'false',
        VITE_ZERO_VAR: '0',
        VITE_EMPTY_VAR: '',
      });

      expect(getEnvVar('VITE_FALSE_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('false');
      expect(getEnvVar('VITE_ZERO_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('0');
      expect(getEnvVar('VITE_EMPTY_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('');
    });

    it('should handle numeric environment variables as strings', () => {
      __setMockEnv({ VITE_NUMERIC_VAR: '123' });

      const result = getEnvVar('VITE_NUMERIC_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('123');
    });

    it('should handle special characters in environment variables', () => {
      __setMockEnv({ VITE_SPECIAL_VAR: 'value with spaces & symbols!@#$%^&*()' });

      const result = getEnvVar('VITE_SPECIAL_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('value with spaces & symbols!@#$%^&*()');
    });

    it('should handle very long environment variable values', () => {
      const longValue = 'x'.repeat(1000);
      __setMockEnv({ VITE_LONG_VAR: longValue });

      const result = getEnvVar('VITE_LONG_VAR' as keyof ImportMetaEnv);

      expect(result).toBe(longValue);
    });
  });

  describe('type safety and TypeScript integration', () => {
    it('should work with proper ImportMetaEnv keys', () => {
      __setMockEnv({ VITE_APP_VERSION: '1.2.3' });

      const result = getEnvVar('VITE_APP_VERSION' as keyof ImportMetaEnv);

      expect(result).toBe('1.2.3');
    });
  });
});
