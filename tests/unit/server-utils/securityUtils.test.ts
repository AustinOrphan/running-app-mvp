import {
  hashPassword,
  comparePassword,
  generateSecureToken,
  validateEmail,
  validatePassword,
  sanitizeInput,
  generateCSRFToken,
  validateCSRFToken,
  rateLimitKey,
  isRateLimited,
  resetRateLimit,
  encryptSensitiveData,
  decryptSensitiveData,
  maskPII,
  validateURL,
  generateOTP,
  validateOTP,
  getPasswordStrength,
} from '../../../server/utils/securityUtils.js';
import type { PasswordStrengthResult } from '../../../server/utils/securityUtils.js';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest
    .fn()
    .mockImplementation((password: string, rounds: number) =>
      Promise.resolve(`hashed_${password}_${rounds}`)
    ),
  compare: jest
    .fn()
    .mockImplementation((password: string, hash: string) =>
      Promise.resolve(hash === `hashed_${password}_10`)
    ),
}));

// Mock crypto
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockImplementation((size: number) => ({
    toString: (encoding: string) => {
      if (encoding === 'hex') return 'a'.repeat(size * 2);
      if (encoding === 'base64') return 'A'.repeat(Math.ceil((size * 4) / 3));
      return 'random';
    },
  })),
  createCipheriv: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnValue('encrypted'),
    final: jest.fn().mockReturnValue('data'),
    getAuthTag: jest.fn().mockReturnValue(Buffer.from('authtag')),
  })),
  createDecipheriv: jest.fn().mockImplementation(() => ({
    setAuthTag: jest.fn(),
    update: jest.fn().mockReturnValue('decrypted'),
    final: jest.fn().mockReturnValue('data'),
  })),
}));

describe('Security Utilities', () => {
  describe('Password Hashing', () => {
    it('hashes passwords correctly', async () => {
      const password = 'MySecurePassword123!';
      const hash = await hashPassword(password);

      expect(hash).toBe('hashed_MySecurePassword123!_10');
    });

    it('compares passwords correctly', async () => {
      const password = 'MySecurePassword123!';
      const hash = 'hashed_MySecurePassword123!_10';

      const isValid = await comparePassword(password, hash);
      expect(isValid).toBe(true);

      const isInvalid = await comparePassword('WrongPassword', hash);
      expect(isInvalid).toBe(false);
    });
  });

  describe('Token Generation', () => {
    it('generates secure tokens', () => {
      const token = generateSecureToken();
      expect(token).toMatch(/^a{64}$/);
      expect(token).toHaveLength(64);
    });

    it('generates tokens of specified length', () => {
      const token = generateSecureToken(16);
      expect(token).toMatch(/^a{32}$/);
      expect(token).toHaveLength(32);
    });
  });

  describe('Email Validation', () => {
    it('validates correct email addresses', () => {
      const validEmails = [
        'user@example.com',
        'test.user@example.co.uk',
        'user+tag@example.com',
        'user123@subdomain.example.com',
      ];

      validEmails.forEach(email => {
        expect(validateEmail(email)).toBe(true);
      });
    });

    it('rejects invalid email addresses', () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user@.com',
        'user@example',
        'user @example.com',
        'user@exam ple.com',
      ];

      invalidEmails.forEach(email => {
        expect(validateEmail(email)).toBe(false);
      });
    });
  });

  describe('Password Validation', () => {
    it('validates strong passwords', () => {
      const result = validatePassword('MySecure123!Pass');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects passwords shorter than 8 characters', () => {
      const result = validatePassword('Abc123!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters long');
    });

    it('requires uppercase letters', () => {
      const result = validatePassword('mysecure123!pass');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one uppercase letter');
    });

    it('requires lowercase letters', () => {
      const result = validatePassword('MYSECURE123!PASS');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one lowercase letter');
    });

    it('requires numbers', () => {
      const result = validatePassword('MySecurePass!');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one number');
    });

    it('requires special characters', () => {
      const result = validatePassword('MySecure123Pass');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Password must contain at least one special character');
    });
  });

  describe('Input Sanitization', () => {
    it('sanitizes HTML tags', () => {
      const input = '<script>alert("xss")</script>Hello';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;Hello');
    });

    it('handles special characters', () => {
      const input = 'Test & "quotes" <tag> \'single\'';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe('Test &amp; &quot;quotes&quot; &lt;tag&gt; &#x27;single&#x27;');
    });

    it('preserves normal text', () => {
      const input = 'Normal text without special characters';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe(input);
    });
  });

  describe('CSRF Token Management', () => {
    it('generates CSRF tokens', () => {
      const token = generateCSRFToken();
      expect(token).toMatch(/^a{64}$/);
    });

    it('validates matching CSRF tokens', () => {
      const sessionToken = 'session-token-123';
      const requestToken = 'session-token-123';

      expect(validateCSRFToken(sessionToken, requestToken)).toBe(true);
    });

    it('rejects mismatched CSRF tokens', () => {
      const sessionToken = 'session-token-123';
      const requestToken = 'different-token-456';

      expect(validateCSRFToken(sessionToken, requestToken)).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      // Clear rate limit storage
      resetRateLimit('test-key');
    });

    it('tracks rate limit attempts', () => {
      const key = 'test-key';

      expect(isRateLimited(key, 3)).toBe(false);
      expect(isRateLimited(key, 3)).toBe(false);
      expect(isRateLimited(key, 3)).toBe(false);
      expect(isRateLimited(key, 3)).toBe(true);
    });

    it('generates rate limit keys', () => {
      const key = rateLimitKey('login', '192.168.1.1');
      expect(key).toBe('login:192.168.1.1');
    });

    it('resets rate limits', () => {
      const key = 'test-key';

      isRateLimited(key, 2);
      isRateLimited(key, 2);
      expect(isRateLimited(key, 2)).toBe(true);

      resetRateLimit(key);
      expect(isRateLimited(key, 2)).toBe(false);
    });

    it('handles window expiration', () => {
      jest.useFakeTimers();
      const key = 'test-key';

      isRateLimited(key, 2, 1000); // 1 second window
      isRateLimited(key, 2, 1000);
      expect(isRateLimited(key, 2, 1000)).toBe(true);

      jest.advanceTimersByTime(1001);
      expect(isRateLimited(key, 2, 1000)).toBe(false);

      jest.useRealTimers();
    });
  });

  describe('Data Encryption', () => {
    const originalKey = process.env.ENCRYPTION_KEY;

    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes in hex
    });

    afterEach(() => {
      process.env.ENCRYPTION_KEY = originalKey;
    });

    it('encrypts and decrypts data', () => {
      const data = 'sensitive information';
      const encrypted = encryptSensitiveData(data);

      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted.encrypted).toBe('encrypteddata');

      const decrypted = decryptSensitiveData(encrypted);
      expect(decrypted).toBe('decrypteddata');
    });

    it('throws error without encryption key', () => {
      delete process.env.ENCRYPTION_KEY;

      expect(() => encryptSensitiveData('data')).toThrow('ENCRYPTION_KEY not configured');
      expect(() => decryptSensitiveData({ encrypted: '', iv: '', authTag: '' })).toThrow(
        'ENCRYPTION_KEY not configured'
      );
    });
  });

  describe('PII Masking', () => {
    it('masks email addresses', () => {
      expect(maskPII('user@example.com')).toBe('u***@e******.com');
      expect(maskPII('a@b.c')).toBe('*@*.c');
    });

    it('masks phone numbers', () => {
      expect(maskPII('+1234567890')).toBe('+1*******90');
      expect(maskPII('123-456-7890')).toBe('1**-***-**90');
    });

    it('masks credit card numbers', () => {
      expect(maskPII('1234567812345678')).toBe('************5678');
      expect(maskPII('1234-5678-1234-5678')).toBe('****-****-****-5678');
    });

    it('masks SSN patterns', () => {
      expect(maskPII('123-45-6789')).toBe('***-**-6789');
    });

    it('preserves non-PII text', () => {
      expect(maskPII('Regular text')).toBe('Regular text');
    });
  });

  describe('URL Validation', () => {
    it('validates correct URLs', () => {
      const validURLs = [
        'https://example.com',
        'https://sub.example.com/path',
        'https://example.com:8080',
        'https://example.com/path?query=value',
      ];

      validURLs.forEach(url => {
        expect(validateURL(url)).toBe(true);
      });
    });

    it('rejects invalid URLs', () => {
      const invalidURLs = [
        'not a url',
        'ftp://example.com',
        'javascript:alert(1)',
        '//example.com',
        'https://',
        'example.com',
      ];

      invalidURLs.forEach(url => {
        expect(validateURL(url)).toBe(false);
      });
    });
  });

  describe('OTP Generation and Validation', () => {
    it('generates 6-digit OTP', () => {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('generates OTP with custom length', () => {
      const otp = generateOTP(8);
      expect(otp).toMatch(/^\d{8}$/);
    });

    it('validates correct OTP within time window', () => {
      const secret = 'test-secret';
      const otp = generateOTP(6);

      // Mock the OTP generation to return same value
      jest.spyOn(Math, 'floor').mockReturnValue(parseInt(otp));

      expect(validateOTP(otp, secret)).toBe(true);

      jest.restoreAllMocks();
    });

    it('rejects incorrect OTP', () => {
      const secret = 'test-secret';
      expect(validateOTP('000000', secret)).toBe(false);
    });
  });

  describe('Password Strength', () => {
    it('rates weak passwords', () => {
      const result = getPasswordStrength('abc123');
      expect(result.score).toBeLessThan(3);
      expect(result.strength).toBe('weak');
      expect(result.feedback).toContain('too short');
    });

    it('rates medium passwords', () => {
      const result = getPasswordStrength('MyPassword123');
      expect(result.score).toBeGreaterThanOrEqual(3);
      expect(result.score).toBeLessThan(4);
      expect(result.strength).toBe('medium');
    });

    it('rates strong passwords', () => {
      const result = getPasswordStrength('MySecure!Pass123Word');
      expect(result.score).toBe(5);
      expect(result.strength).toBe('strong');
      expect(result.feedback).toHaveLength(0);
    });

    it('provides feedback for improvements', () => {
      const result = getPasswordStrength('password');
      expect(result.feedback).toContain('Avoid common passwords');

      const result2 = getPasswordStrength('abcdefgh');
      expect(result2.feedback).toContain('Add uppercase letters');
      expect(result2.feedback).toContain('Add numbers');
      expect(result2.feedback).toContain('Add special characters');
    });
  });
});
