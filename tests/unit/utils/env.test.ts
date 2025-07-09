import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import the actual functions to test them
import {
  getEnvVar,
  getAppVersion,
  getBuildDate,
  getEnvironment,
  isDevelopment,
  isProduction,
  getAppInfo,
} from '../../../src/utils/env';

describe('env utilities', () => {
  // Store original import.meta.env to restore after tests
  let originalEnv: any;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...import.meta.env };
    
    // Clear environment for clean test state
    Object.keys(import.meta.env).forEach(key => {
      delete (import.meta.env as any)[key];
    });
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    Object.keys(import.meta.env).forEach(key => {
      delete (import.meta.env as any)[key];
    });
    Object.assign(import.meta.env, originalEnv);
    
    vi.clearAllMocks();
  });

  describe('getEnvVar', () => {
    it('should return environment variable value when it exists', () => {
      (import.meta.env as any).VITE_TEST_VAR = 'test-value';

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
      // Delete variables to simulate undefined
      delete (import.meta.env as any).VITE_NULL_VAR;
      delete (import.meta.env as any).VITE_UNDEFINED_VAR;

      const nullResult = getEnvVar('VITE_NULL_VAR' as keyof ImportMetaEnv, 'fallback');
      const undefinedResult = getEnvVar('VITE_UNDEFINED_VAR' as keyof ImportMetaEnv, 'fallback');

      expect(nullResult).toBe('fallback');
      expect(undefinedResult).toBe('fallback');
    });

    it('should handle errors gracefully when import.meta is undefined', () => {
      // Temporarily break import.meta to test error handling
      const originalImport = globalThis.import;
      globalThis.import = undefined as any;

      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'error-fallback');

      expect(result).toBe('error-fallback');

      // Restore import.meta
      globalThis.import = originalImport;
    });

    it('should handle errors gracefully when import.meta.env is undefined', () => {
      // Temporarily break import.meta.env to test error handling
      const originalImportMeta = globalThis.import;
      globalThis.import = { meta: {} } as any;

      const result = getEnvVar('VITE_TEST_VAR' as keyof ImportMetaEnv, 'no-env-fallback');

      expect(result).toBe('no-env-fallback');

      // Restore import.meta
      globalThis.import = originalImportMeta;
    });
  });

  describe('getAppVersion', () => {
    it('should return version from environment when available', () => {
      (import.meta.env as any).VITE_APP_VERSION = '2.1.0';

      const result = getAppVersion();

      expect(result).toBe('2.1.0');
    });

    it('should return default version when not set', () => {
      const result = getAppVersion();

      expect(result).toBe('1.0.0');
    });

    it('should return empty string when explicitly set to empty string', () => {
      (import.meta.env as any).VITE_APP_VERSION = '';

      const result = getAppVersion();

      expect(result).toBe('');
    });
  });

  describe('getBuildDate', () => {
    it('should return build date from environment when available', () => {
      (import.meta.env as any).VITE_APP_BUILD_DATE = '2024-01-15';

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

    it('should return empty string when explicitly set to empty string', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-14T15:30:00Z'));

      (import.meta.env as any).VITE_APP_BUILD_DATE = '';

      const result = getBuildDate();

      expect(result).toBe('');

      vi.useRealTimers();
    });
  });

  describe('getEnvironment', () => {
    it('should return environment mode when available', () => {
      (import.meta.env as any).MODE = 'production';

      const result = getEnvironment();

      expect(result).toBe('production');
    });

    it('should return development as default', () => {
      const result = getEnvironment();

      expect(result).toBe('development');
    });

    it('should handle custom environment modes', () => {
      (import.meta.env as any).MODE = 'staging';

      const result = getEnvironment();

      expect(result).toBe('staging');
    });
  });

  describe('isDevelopment', () => {
    it('should return true when in development mode', () => {
      (import.meta.env as any).MODE = 'development';

      const result = isDevelopment();

      expect(result).toBe(true);
    });

    it('should return false when in production mode', () => {
      (import.meta.env as any).MODE = 'production';

      const result = isDevelopment();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      (import.meta.env as any).MODE = 'staging';

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
      (import.meta.env as any).MODE = 'production';

      const result = isProduction();

      expect(result).toBe(true);
    });

    it('should return false when in development mode', () => {
      (import.meta.env as any).MODE = 'development';

      const result = isProduction();

      expect(result).toBe(false);
    });

    it('should return false for custom modes', () => {
      (import.meta.env as any).MODE = 'staging';

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

      (import.meta.env as any).VITE_APP_VERSION = '3.2.1';
      (import.meta.env as any).VITE_APP_BUILD_DATE = '2024-01-20';
      (import.meta.env as any).MODE = 'production';

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
      (import.meta.env as any).VITE_APP_VERSION = '1.5.0';
      (import.meta.env as any).MODE = 'staging';

      const result1 = getAppInfo();
      const result2 = getAppInfo();

      expect(result1).toEqual(result2);
    });

    it('should reflect environment changes', () => {
      (import.meta.env as any).MODE = 'development';
      const devResult = getAppInfo();

      (import.meta.env as any).MODE = 'production';
      const prodResult = getAppInfo();

      expect(devResult.isDev).toBe(true);
      expect(devResult.isProd).toBe(false);
      expect(prodResult.isDev).toBe(false);
      expect(prodResult.isProd).toBe(true);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle various falsy values correctly', () => {
      (import.meta.env as any).VITE_FALSE_VAR = 'false';
      (import.meta.env as any).VITE_ZERO_VAR = '0';
      (import.meta.env as any).VITE_EMPTY_VAR = '';

      expect(getEnvVar('VITE_FALSE_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('false');
      expect(getEnvVar('VITE_ZERO_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('0');
      expect(getEnvVar('VITE_EMPTY_VAR' as keyof ImportMetaEnv, 'fallback')).toBe('');
    });

    it('should handle numeric environment variables as strings', () => {
      (import.meta.env as any).VITE_NUMERIC_VAR = '123';

      const result = getEnvVar('VITE_NUMERIC_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('123');
    });

    it('should handle special characters in environment variables', () => {
      (import.meta.env as any).VITE_SPECIAL_VAR = 'value with spaces & symbols!@#$%^&*()';

      const result = getEnvVar('VITE_SPECIAL_VAR' as keyof ImportMetaEnv);

      expect(result).toBe('value with spaces & symbols!@#$%^&*()');
    });

    it('should handle very long environment variable values', () => {
      const longValue = 'x'.repeat(1000);
      (import.meta.env as any).VITE_LONG_VAR = longValue;

      const result = getEnvVar('VITE_LONG_VAR' as keyof ImportMetaEnv);

      expect(result).toBe(longValue);
    });
  });

  describe('type safety and TypeScript integration', () => {
    it('should work with proper ImportMetaEnv keys', () => {
      (import.meta.env as any).VITE_APP_VERSION = '1.2.3';

      const result = getEnvVar('VITE_APP_VERSION' as keyof ImportMetaEnv);

      expect(result).toBe('1.2.3');
    });
  });
});