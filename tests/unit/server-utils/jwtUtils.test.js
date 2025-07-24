import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  extractTokenFromHeader,
  blacklistToken,
  isTokenBlacklisted,
} from '../../../server/utils/jwtUtils.js';

describe('JWT Utilities', () => {
  describe('extractTokenFromHeader', () => {
    it('should extract token from valid Bearer header', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
      const result = extractTokenFromHeader(authHeader);
      
      expect(result).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature');
    });

    it('should return null for undefined header', () => {
      expect(extractTokenFromHeader(undefined)).toBeNull();
    });

    it('should return null for empty header', () => {
      expect(extractTokenFromHeader('')).toBeNull();
    });

    it('should return null for header without Bearer prefix', () => {
      expect(extractTokenFromHeader('Basic dXNlcjpwYXNz')).toBeNull();
    });

    it('should return null for malformed Bearer header', () => {
      expect(extractTokenFromHeader('Bearer')).toBeNull();
      expect(extractTokenFromHeader('BearerToken')).toBeNull();
      expect(extractTokenFromHeader('Bearer token extra parts')).toBeNull();
    });

    it('should handle headers with extra spaces', () => {
      const authHeader = 'Bearer  token-with-extra-space';
      expect(extractTokenFromHeader(authHeader)).toBeNull();
    });

    it('should be case sensitive for Bearer prefix', () => {
      expect(extractTokenFromHeader('bearer token')).toBeNull();
      expect(extractTokenFromHeader('BEARER token')).toBeNull();
    });
  });

  describe('Token Blacklisting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('blacklistToken', () => {
      it('should add token to blacklist', () => {
        const jti = 'token-to-blacklist';
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;

        blacklistToken(jti, expiresAt);

        expect(isTokenBlacklisted(jti)).toBe(true);
      });

      it('should automatically remove token after expiration', () => {
        const jti = 'expiring-token';
        const expiresAt = Math.floor(Date.now() / 1000) + 2;

        blacklistToken(jti, expiresAt);
        expect(isTokenBlacklisted(jti)).toBe(true);

        vi.advanceTimersByTime(3000);

        expect(isTokenBlacklisted(jti)).toBe(false);
      });

      it('should not schedule removal for already expired tokens', () => {
        const jti = 'already-expired';
        const expiresAt = Math.floor(Date.now() / 1000) - 100;

        blacklistToken(jti, expiresAt);

        expect(isTokenBlacklisted(jti)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      });

      it('should handle multiple blacklisted tokens', () => {
        const tokens = ['token1', 'token2', 'token3'];
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;

        tokens.forEach(jti => blacklistToken(jti, expiresAt));

        tokens.forEach(jti => {
          expect(isTokenBlacklisted(jti)).toBe(true);
        });

        expect(isTokenBlacklisted('non-blacklisted')).toBe(false);
      });

      it('should handle concurrent blacklisting', () => {
        const expiresAt = Math.floor(Date.now() / 1000) + 3600;

        // Blacklist multiple tokens at once
        for (let i = 0; i < 100; i++) {
          blacklistToken(`token-${i}`, expiresAt);
        }

        // Verify all are blacklisted
        for (let i = 0; i < 100; i++) {
          expect(isTokenBlacklisted(`token-${i}`)).toBe(true);
        }
      });

      it('should handle different expiration times correctly', () => {
        const now = Math.floor(Date.now() / 1000);
        
        blacklistToken('token-1min', now + 60);
        blacklistToken('token-5min', now + 300);
        blacklistToken('token-1hour', now + 3600);

        // All should be blacklisted initially
        expect(isTokenBlacklisted('token-1min')).toBe(true);
        expect(isTokenBlacklisted('token-5min')).toBe(true);
        expect(isTokenBlacklisted('token-1hour')).toBe(true);

        // Fast forward 2 minutes
        vi.advanceTimersByTime(120 * 1000);

        // Only 1min token should be removed
        expect(isTokenBlacklisted('token-1min')).toBe(false);
        expect(isTokenBlacklisted('token-5min')).toBe(true);
        expect(isTokenBlacklisted('token-1hour')).toBe(true);
      });
    });

    describe('isTokenBlacklisted', () => {
      it('should return false for non-blacklisted tokens', () => {
        expect(isTokenBlacklisted('random-token')).toBe(false);
        expect(isTokenBlacklisted('')).toBe(false);
      });

      it('should handle edge cases', () => {
        blacklistToken('test-token', Math.floor(Date.now() / 1000) + 3600);

        expect(isTokenBlacklisted('test-token')).toBe(true);
        expect(isTokenBlacklisted('test-token2')).toBe(false);
        expect(isTokenBlacklisted('test')).toBe(false);
        expect(isTokenBlacklisted('token')).toBe(false);
      });

      it('should handle special characters in token IDs', () => {
        const specialTokens = [
          'token-with-dash',
          'token_with_underscore',
          'token.with.dot',
          'token:with:colon',
          'token/with/slash',
        ];

        const expiresAt = Math.floor(Date.now() / 1000) + 3600;
        
        specialTokens.forEach(jti => {
          blacklistToken(jti, expiresAt);
          expect(isTokenBlacklisted(jti)).toBe(true);
        });
      });
    });
  });

  describe('Production Environment Warnings', () => {
    let consoleWarnSpy;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should warn when using in-memory blacklist in production', async () => {
      // Dynamic import to trigger the warning
      process.env.NODE_ENV = 'production';
      
      // Clear the module cache to force re-evaluation
      vi.resetModules();
      
      // Re-import the module
      await import('../../../server/utils/jwtUtils.js');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'WARNING: Using in-memory token blacklist in production. This is not recommended!'
      );
    });

    it('should not warn in development environment', async () => {
      process.env.NODE_ENV = 'development';
      
      vi.resetModules();
      await import('../../../server/utils/jwtUtils.js');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not warn in test environment', async () => {
      process.env.NODE_ENV = 'test';
      
      vi.resetModules();
      await import('../../../server/utils/jwtUtils.js');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error scenarios', () => {
    it('should handle environment variables not being set', () => {
      delete process.env.JWT_SECRET;
      delete process.env.JWT_ACCESS_EXPIRY;
      delete process.env.JWT_REFRESH_EXPIRY;

      // These functions should still work without JWT_SECRET
      expect(extractTokenFromHeader('Bearer token')).toBe('token');
      expect(isTokenBlacklisted('some-token')).toBe(false);
      
      // Blacklisting should work without JWT_SECRET
      blacklistToken('test-token', Math.floor(Date.now() / 1000) + 3600);
      expect(isTokenBlacklisted('test-token')).toBe(true);
    });
  });
});