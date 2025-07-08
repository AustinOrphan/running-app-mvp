import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEnvVar,
  getAppVersion,
  getBuildDate,
  getEnvironment,
  isDevelopment,
  isProduction,
  getAppInfo,
} from '../../../src/utils/env';

// Mock import.meta.env
const mockImportMeta = {
  env: {} as Record<string, string>,
};

Object.defineProperty(globalThis, 'import', {
  value: {
    meta: mockImportMeta,
  },
  writable: true,
});

describe('env utilities', () => {
  beforeEach(() => {
    // Clear mock environment variables
    mockImportMeta.env = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getEnvVar', () => {
    it('should return environment variable value when it exists', () => {
      mockImportMeta.env.VITE_TEST_VAR = 'test-value';

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
      mockImportMeta.env.VITE_NULL_VAR = null as any;
      mockImportMeta.env.VITE_UNDEFINED_VAR = undefined as any;

      const nullResult = getEnvVar('VITE_NULL_VAR' as keyof ImportMetaEnv, 'fallback');
      const undefinedResult = getEnvVar('VITE_UNDEFINED_VAR' as keyof ImportMetaEnv, 'fallback');

      expect(nullResult).toBe('fallback');
      expect(undefinedResult).toBe('fallback');
    });

    it('should handle errors gracefully and return fallback', () => {
      // Mock import.meta to throw an error
      Object.defineProperty(globalThis, 'import', {
        get() {
          throw new Error('Import meta not available');
        },
        configurable: true,
      });

      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'error-fallback');

      expect(result).toBe('error-fallback');

      // Restore import.meta
      Object.defineProperty(globalThis, 'import', {
        value: {
          meta: mockImportMeta,
        },
        writable: true,
      });
    });

    it('should handle missing import.meta.env gracefully', () => {
      const originalImportMeta = globalThis.import;
      
      Object.defineProperty(globalThis, 'import', {
        value: {
          meta: {},
        },
        writable: true,
      });

      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'no-env-fallback');

      expect(result).toBe('no-env-fallback');

      // Restore original
      Object.defineProperty(globalThis, 'import', {
        value: originalImportMeta,
        writable: true,
      });
    });
  });

  describe('getAppVersion', () => {
    it('should return version from environment when available', () => {
      mockImportMeta.env.VITE_APP_VERSION = '2.1.0';

      const result = getAppVersion();

      expect(result).toBe('2.1.0');
    });

    it('should return default version when not set', () => {
      const result = getAppVersion();

      expect(result).toBe('1.0.0');
    });

    it('should handle empty string version', () => {
      mockImportMeta.env.VITE_APP_VERSION = '';

      const result = getAppVersion();

      expect(result).toBe('1.0.0');
    });
  });

  describe('getBuildDate', () => {
    it('should return build date from environment when available', () => {
      mockImportMeta.env.VITE_APP_BUILD_DATE = '2024-01-15';

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
      
      mockImportMeta.env.VITE_APP_BUILD_DATE = '';

      const result = getBuildDate();

      expect(result).toBe('2024-02-14');

      vi.useRealTimers();
    });
  });

  describe('getEnvironment', () => {
    it('should return environment mode when available', () => {
      mockImportMeta.env.MODE = 'production';

      const result = getEnvironment();

      expect(result).toBe('production');
    });

    it('should return development as default', () => {
      const result = getEnvironment();

      expect(result).toBe('development');
    });

    it('should handle custom environment modes', () => {
      mockImportMeta.env.MODE = 'staging';

      const result = getEnvironment();

      expect(result).toBe('staging');
    });
  });

  describe('isDevelopment', () => {
    it('should return true when in development mode', () => {
      mockImportMeta.env.MODE = 'development';

      const result = isDevelopment();

      expect(result).toBe(true);
    });

    it('should return false when in production mode', () => {
      mockImportMeta.env.MODE = 'production';

      const result = isDevelopment();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      mockImportMeta.env.MODE = 'staging';

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
      mockImportMeta.env.MODE = 'production';

      const result = isProduction();

      expect(result).toBe(true);
    });

    it('should return false when in development mode', () => {
      mockImportMeta.env.MODE = 'development';

      const result = isProduction();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      mockImportMeta.env.MODE = 'staging';

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

      mockImportMeta.env.VITE_APP_VERSION = '3.2.1';
      mockImportMeta.env.VITE_APP_BUILD_DATE = '2024-01-20';
      mockImportMeta.env.MODE = 'production';

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
      mockImportMeta.env.VITE_APP_VERSION = '1.5.0';
      mockImportMeta.env.MODE = 'staging';

      const result1 = getAppInfo();
      const result2 = getAppInfo();

      expect(result1).toEqual(result2);
    });

    it('should reflect environment changes', () => {
      mockImportMeta.env.MODE = 'development';
      const devResult = getAppInfo();

      mockImportMeta.env.MODE = 'production';
      const prodResult = getAppInfo();

      expect(devResult.isDev).toBe(true);
      expect(devResult.isProd).toBe(false);
      expect(prodResult.isDev).toBe(false);
      expect(prodResult.isProd).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle various falsy values correctly', () => {
      mockImportMeta.env.VITE_FALSE_VAR = 'false';
      mockImportMeta.env.VITE_ZERO_VAR = '0';
      mockImportMeta.env.VITE_EMPTY_VAR = '';

      expect(getEnvVar('VITE_FALSE_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('false');
      expect(getEnvVar('VITE_ZERO_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('0');
      expect(getEnvVar('VITE_EMPTY_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('fallback');
    });

    it('should handle numeric environment variables as strings', () => {
      mockImportMeta.env.VITE_NUMERIC_VAR = '123';

      const result = getEnvVar('VITE_NUMERIC_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('123');
      expect(typeof result).toBe('string');
    });

    it('should handle special characters in environment variables', () => {
      mockImportMeta.env.VITE_SPECIAL_VAR = 'value with spaces & symbols!@#$%^&*()';

      const result = getEnvVar('VITE_SPECIAL_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('value with spaces & symbols!@#$%^&*()');
    });

    it('should handle very long environment variable values', () => {
      const longValue = 'x'.repeat(1000);
      mockImportMeta.env.VITE_LONG_VAR = longValue;

      const result = getEnvVar('VITE_LONG_VAR' as keyof ImportMetaEnv);

      expect(result).toBe(longValue);
      expect(result.length).toBe(1000);
    });
  });

  describe('type safety and TypeScript integration', () => {
    it('should work with proper ImportMetaEnv keys', () => {
      // This test mainly validates that TypeScript types are working correctly
      mockImportMeta.env.MODE = 'test';
      mockImportMeta.env.VITE_APP_VERSION = '1.0.0';

      expect(() => {
        getEnvVar('MODE');
        getEnvVar('VITE_APP_VERSION' as keyof ImportMetaEnv);
      }).not.toThrow();
    });
  });
});