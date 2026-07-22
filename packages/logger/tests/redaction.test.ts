import { describe, it, expect } from 'vitest';
import {
  hashEmail,
  maskIP,
  maskPhone,
  isAlwaysRedactKey,
  redactString,
  redactValue,
  redactObject,
  createRedactor,
} from '../src/redaction.js';

describe('Redaction', () => {
  describe('hashEmail', () => {
    it('should hash email addresses consistently', () => {
      const email = 'user@example.com';
      const hash1 = hashEmail(email);
      const hash2 = hashEmail(email);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{12}@hash$/);
    });

    it('should normalize email to lowercase before hashing', () => {
      const hash1 = hashEmail('User@Example.com');
      const hash2 = hashEmail('user@example.com');

      expect(hash1).toBe(hash2);
    });
  });

  describe('maskIP', () => {
    it('should mask last two octets of IPv4 address', () => {
      expect(maskIP('192.168.1.1')).toBe('192.168.xxx.xxx');
      expect(maskIP('10.0.0.1')).toBe('10.0.xxx.xxx');
    });

    it('should return masked value for invalid IP', () => {
      expect(maskIP('invalid')).toBe('xxx.xxx.xxx.xxx');
    });
  });

  describe('maskPhone', () => {
    it('should mask phone numbers keeping last 4 digits', () => {
      expect(maskPhone('555-123-4567')).toBe('***-***-4567');
      expect(maskPhone('5551234567')).toBe('***-***-4567');
      expect(maskPhone('(555) 123-4567')).toBe('***-***-4567');
    });

    it('should handle short numbers', () => {
      expect(maskPhone('123')).toBe('***-***-****');
    });
  });

  describe('isAlwaysRedactKey', () => {
    it('should identify sensitive keys', () => {
      expect(isAlwaysRedactKey('password')).toBe(true);
      expect(isAlwaysRedactKey('userPassword')).toBe(true);
      expect(isAlwaysRedactKey('api_key')).toBe(true);
      expect(isAlwaysRedactKey('apiKey')).toBe(true);
      expect(isAlwaysRedactKey('token')).toBe(true);
      expect(isAlwaysRedactKey('jwt')).toBe(true);
      expect(isAlwaysRedactKey('secret')).toBe(true);
      expect(isAlwaysRedactKey('authorization')).toBe(true);
    });

    it('should not flag safe keys', () => {
      expect(isAlwaysRedactKey('username')).toBe(false);
      expect(isAlwaysRedactKey('email')).toBe(false);
      expect(isAlwaysRedactKey('userId')).toBe(false);
    });
  });

  describe('redactString', () => {
    it('should redact JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      expect(redactString(jwt)).toBe('[REDACTED_JWT]');
    });

    it('should redact credit card numbers', () => {
      const text = 'Card number is 4532-1234-5678-9010';
      const redacted = redactString(text);

      expect(redacted).toContain('[REDACTED_CC]');
      expect(redacted).not.toContain('4532-1234-5678-9010');
    });

    it('should mask phone numbers when enabled', () => {
      const text = 'Call me at 555-123-4567';
      const redacted = redactString(text, { redactPhones: true });

      expect(redacted).toContain('***-***-4567');
      expect(redacted).not.toContain('555-123-4567');
    });

    it('should mask IP addresses when enabled', () => {
      const text = 'From IP 192.168.1.1';
      const redacted = redactString(text, { maskIPs: true });

      expect(redacted).toContain('192.168.xxx.xxx');
      expect(redacted).not.toContain('192.168.1.1');
    });
  });

  describe('redactValue', () => {
    it('should redact values with sensitive keys', () => {
      expect(redactValue('secret123', 'password')).toBe('[REDACTED]');
      expect(redactValue('abc123', 'apiKey')).toBe('[REDACTED]');
      expect(redactValue('token123', 'jwt')).toBe('[REDACTED]');
    });

    it('should hash emails when enabled', () => {
      const email = 'user@example.com';
      const result = redactValue(email, 'email', { hashEmails: true });

      expect(result).toMatch(/^[a-f0-9]{12}@hash$/);
      expect(result).not.toBe(email);
    });

    it('should not hash emails when disabled', () => {
      const email = 'user@example.com';
      const result = redactValue(email, 'email', { hashEmails: false });

      expect(result).toBe(email);
    });

    it('should recursively redact arrays', () => {
      const arr = [
        { password: 'secret' },
        { apiKey: 'key123' },
        'normal value',
      ];
      const result = redactValue(arr, 'data') as any[];

      expect(result[0].password).toBe('[REDACTED]');
      expect(result[1].apiKey).toBe('[REDACTED]');
      expect(result[2]).toBe('normal value');
    });

    it('should recursively redact objects', () => {
      const obj = {
        username: 'john',
        password: 'secret123',
        nested: {
          apiKey: 'key123',
        },
      };
      const result = redactValue(obj, 'data') as any;

      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
      expect(result.nested.apiKey).toBe('[REDACTED]');
    });
  });

  describe('redactObject', () => {
    it('should redact entire object', () => {
      const obj = {
        username: 'john',
        email: 'john@example.com',
        password: 'secret123',
        apiKey: 'key123',
        userId: 'user-123',
      };

      const result = redactObject(obj, { hashEmails: true });

      expect(result.username).toBe('john');
      expect(result.email).toMatch(/^[a-f0-9]{12}@hash$/);
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.userId).toBe('user-123');
    });

    it('should handle nested objects', () => {
      const obj = {
        user: {
          credentials: {
            password: 'secret',
            token: 'abc123',
          },
          profile: {
            email: 'user@example.com',
          },
        },
      };

      const result = redactObject(obj, { hashEmails: true });

      expect((result.user as any).credentials.password).toBe('[REDACTED]');
      expect((result.user as any).credentials.token).toBe('[REDACTED]');
      expect((result.user as any).profile.email).toMatch(/^[a-f0-9]{12}@hash$/);
    });
  });

  describe('createRedactor', () => {
    it('should create redactor with options', () => {
      const redactor = createRedactor({ hashEmails: true, maskIPs: true });

      const obj = {
        email: 'user@example.com',
        ip: '192.168.1.1',
        password: 'secret',
      };

      const result = redactor.redact(obj);

      expect(result.email).toMatch(/^[a-f0-9]{12}@hash$/);
      expect(result.password).toBe('[REDACTED]');
    });

    it('should redact strings', () => {
      const redactor = createRedactor({ redactPhones: true });
      const text = 'Call 555-123-4567';
      const result = redactor.redactString(text);

      expect(result).toContain('***-***-4567');
    });

    it('should redact individual values', () => {
      const redactor = createRedactor();
      const result = redactor.redactValue('secret123', 'password');

      expect(result).toBe('[REDACTED]');
    });
  });
});
