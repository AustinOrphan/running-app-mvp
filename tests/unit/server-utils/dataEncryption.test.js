import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  dataEncryption,
  encryptData,
  decryptData,
  encryptObject,
  decryptObject,
  encryptFields,
  decryptFields,
  encryptUserData,
  decryptUserData,
  encryptAuthData,
  decryptAuthData,
  generateEncryptionKey,
  validateEncryptionKey,
  SENSITIVE_FIELDS,
} from '../../../server/utils/dataEncryption.js';
import { logError, logInfo } from '../../../server/utils/logger.js';

// Mock dependencies
vi.mock('../../../server/utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

// Mock crypto for consistent testing
const mockIv = Buffer.from('1234567890123456');
const mockTag = Buffer.from('abcdefghijklmnop');
const mockEncryptedData = 'encrypted-data-hex';

vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn((length) => {
      if (length === 16) return mockIv;
      if (length === 32) return Buffer.from('12345678901234567890123456789012');
      return Buffer.alloc(length);
    }),
    scryptSync: vi.fn(() => Buffer.from('12345678901234567890123456789012')),
    createCipheriv: vi.fn(() => ({
      setAAD: vi.fn(),
      update: vi.fn(() => 'encrypted-data'),
      final: vi.fn(() => '-hex'),
      getAuthTag: vi.fn(() => mockTag),
    })),
    createDecipheriv: vi.fn(() => ({
      setAAD: vi.fn(),
      setAuthTag: vi.fn(),
      update: vi.fn((data) => {
        if (data === mockEncryptedData) return 'decrypted-';
        return data;
      }),
      final: vi.fn(() => 'data'),
    })),
  },
}));

describe('Data Encryption', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Initialization', () => {
    it('should initialize with environment key in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATA_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234'; // 64 chars hex

      // Force reinitialization
      const DataEncryption = dataEncryption.constructor;
      const instance = new DataEncryption();

      expect(logInfo).not.toHaveBeenCalledWith(
        'encryption',
        'key-init',
        'Using development encryption key'
      );
    });

    it('should throw error in production without encryption key', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATA_ENCRYPTION_KEY;

      const DataEncryption = dataEncryption.constructor;
      
      expect(() => new DataEncryption()).toThrow(
        'CRITICAL: DATA_ENCRYPTION_KEY environment variable must be set in production'
      );
    });

    it('should use development key in non-production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATA_ENCRYPTION_KEY;

      const DataEncryption = dataEncryption.constructor;
      const instance = new DataEncryption();

      expect(logInfo).toHaveBeenCalledWith(
        'encryption',
        'key-init',
        'Using development encryption key'
      );
    });

    it('should support hex encoded keys', () => {
      process.env.DATA_ENCRYPTION_KEY = '1234567890123456789012345678901234567890123456789012345678901234'; // 64 chars = 32 bytes

      const DataEncryption = dataEncryption.constructor;
      const instance = new DataEncryption();

      expect(logError).not.toHaveBeenCalled();
    });

    it('should support base64 encoded keys', () => {
      const key = Buffer.from('12345678901234567890123456789012').toString('base64');
      process.env.DATA_ENCRYPTION_KEY = key;

      const DataEncryption = dataEncryption.constructor;
      const instance = new DataEncryption();

      expect(logError).not.toHaveBeenCalled();
    });

    it('should throw error for invalid key length', () => {
      process.env.DATA_ENCRYPTION_KEY = '1234'; // Too short

      const DataEncryption = dataEncryption.constructor;
      
      expect(() => new DataEncryption()).toThrow('Invalid DATA_ENCRYPTION_KEY format');
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('Encryption/Decryption', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should encrypt data', () => {
      const plaintext = 'sensitive data';
      const result = encryptData(plaintext);

      expect(result).toEqual({
        data: mockEncryptedData,
        iv: mockIv.toString('hex'),
        tag: mockTag.toString('hex'),
        encrypted: true,
      });

      expect(crypto.createCipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        mockIv
      );
    });

    it('should decrypt data', () => {
      const encryptedData = {
        data: mockEncryptedData,
        iv: mockIv.toString('hex'),
        tag: mockTag.toString('hex'),
        encrypted: true,
      };

      const result = decryptData(encryptedData);

      expect(result).toBe('decrypted-data');
      expect(crypto.createDecipheriv).toHaveBeenCalledWith(
        'aes-256-gcm',
        expect.any(Buffer),
        mockIv
      );
    });

    it('should throw error when decrypting non-encrypted data', () => {
      const invalidData = {
        data: 'not encrypted',
        iv: 'abc',
        tag: 'def',
        encrypted: false,
      };

      expect(() => decryptData(invalidData)).toThrow('Data is not encrypted');
    });

    it('should handle encryption errors gracefully', () => {
      vi.mocked(crypto.createCipheriv).mockImplementationOnce(() => {
        throw new Error('Cipher error');
      });

      expect(() => encryptData('test')).toThrow('Encryption failed');
      expect(logError).toHaveBeenCalledWith(
        'encryption',
        'encrypt',
        expect.any(Error)
      );
    });

    it('should handle decryption errors gracefully', () => {
      vi.mocked(crypto.createDecipheriv).mockImplementationOnce(() => {
        throw new Error('Decipher error');
      });

      const encryptedData = {
        data: 'invalid',
        iv: mockIv.toString('hex'),
        tag: mockTag.toString('hex'),
        encrypted: true,
      };

      expect(() => decryptData(encryptedData)).toThrow('Decryption failed');
      expect(logError).toHaveBeenCalledWith(
        'encryption',
        'decrypt',
        expect.any(Error)
      );
    });
  });

  describe('Object Encryption/Decryption', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      
      // Mock for JSON string encryption
      vi.mocked(crypto.createCipheriv).mockReturnValue({
        setAAD: vi.fn(),
        update: vi.fn((data) => {
          if (data.includes('{')) return 'encrypted-json';
          return 'encrypted';
        }),
        final: vi.fn(() => '-data'),
        getAuthTag: vi.fn(() => mockTag),
      });

      vi.mocked(crypto.createDecipheriv).mockReturnValue({
        setAAD: vi.fn(),
        setAuthTag: vi.fn(),
        update: vi.fn((data) => {
          if (data === 'encrypted-json-data') return '{"name":"John","age":';
          return 'decrypted-';
        }),
        final: vi.fn(() => '30}'),
      });
    });

    it('should encrypt objects', () => {
      const obj = { name: 'John', age: 30 };
      const result = encryptObject(obj);

      expect(result).toEqual({
        data: 'encrypted-json-data',
        iv: mockIv.toString('hex'),
        tag: mockTag.toString('hex'),
        encrypted: true,
      });
    });

    it('should decrypt objects', () => {
      const encryptedData = {
        data: 'encrypted-json-data',
        iv: mockIv.toString('hex'),
        tag: mockTag.toString('hex'),
        encrypted: true,
      };

      const result = decryptObject(encryptedData);

      expect(result).toEqual({ name: 'John', age: 30 });
    });
  });

  describe('Field-level Encryption', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
      
      // Reset to default mocks for field encryption
      vi.mocked(crypto.createCipheriv).mockReturnValue({
        setAAD: vi.fn(),
        update: vi.fn(() => 'encrypted-data'),
        final: vi.fn(() => '-hex'),
        getAuthTag: vi.fn(() => mockTag),
      });

      vi.mocked(crypto.createDecipheriv).mockReturnValue({
        setAAD: vi.fn(),
        setAuthTag: vi.fn(),
        update: vi.fn((data) => {
          if (data === mockEncryptedData) return 'decrypted-';
          return data;
        }),
        final: vi.fn(() => 'data'),
      });
    });

    it('should encrypt specific fields', () => {
      const obj = {
        username: 'john',
        password: 'secret123',
        email: 'john@example.com',
        age: 30,
      };

      const result = encryptFields(obj, ['password', 'email']);

      expect(result.username).toBe('john');
      expect(result.age).toBe(30);
      expect(result.password).toEqual({
        data: mockEncryptedData,
        iv: expect.any(String),
        tag: expect.any(String),
        encrypted: true,
      });
      expect(result.email).toEqual({
        data: mockEncryptedData,
        iv: expect.any(String),
        tag: expect.any(String),
        encrypted: true,
      });
    });

    it('should handle missing fields gracefully', () => {
      const obj = { username: 'john' };
      const result = encryptFields(obj, ['password', 'email']);

      expect(result).toEqual({ username: 'john' });
    });

    it('should handle null/undefined values', () => {
      const obj = {
        username: 'john',
        password: null,
        email: undefined,
      };

      const result = encryptFields(obj, ['password', 'email']);

      expect(result).toEqual({
        username: 'john',
        password: null,
        email: undefined,
      });
    });

    it('should encrypt non-string values as JSON', () => {
      const obj = {
        username: 'john',
        settings: { theme: 'dark', notifications: true },
      };

      const result = encryptFields(obj, ['settings']);

      expect(result.username).toBe('john');
      expect(result.settings).toHaveProperty('encrypted', true);
    });

    it('should decrypt specific fields', () => {
      const obj = {
        username: 'john',
        password: {
          data: mockEncryptedData,
          iv: mockIv.toString('hex'),
          tag: mockTag.toString('hex'),
          encrypted: true,
        },
        age: 30,
      };

      const result = decryptFields(obj, ['password']);

      expect(result.username).toBe('john');
      expect(result.age).toBe(30);
      expect(result.password).toBe('decrypted-data');
    });

    it('should handle decryption errors for individual fields', () => {
      vi.mocked(crypto.createDecipheriv).mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const obj = {
        username: 'john',
        password: {
          data: 'invalid',
          iv: mockIv.toString('hex'),
          tag: mockTag.toString('hex'),
          encrypted: true,
        },
      };

      const result = decryptFields(obj, ['password']);

      // Should keep encrypted data on failure
      expect(result.password).toEqual(obj.password);
      expect(logError).toHaveBeenCalledWith(
        'encryption',
        'field-decrypt',
        expect.any(Error),
        undefined,
        { field: 'password' }
      );
    });

    it('should parse JSON values after decryption when possible', () => {
      vi.mocked(crypto.createDecipheriv).mockReturnValueOnce({
        setAAD: vi.fn(),
        setAuthTag: vi.fn(),
        update: vi.fn(() => '{"theme":"dark",'),
        final: vi.fn(() => '"notifications":true}'),
      });

      const obj = {
        settings: {
          data: 'encrypted-settings',
          iv: mockIv.toString('hex'),
          tag: mockTag.toString('hex'),
          encrypted: true,
        },
      };

      const result = decryptFields(obj, ['settings']);

      expect(result.settings).toEqual({
        theme: 'dark',
        notifications: true,
      });
    });
  });

  describe('User Data Encryption', () => {
    it('should encrypt user sensitive fields', () => {
      const userData = {
        id: '123',
        username: 'john',
        email: 'john@example.com',
        phone: '555-1234',
        address: '123 Main St',
        fullName: 'John Doe',
        role: 'user',
      };

      const result = encryptUserData(userData);

      expect(result.id).toBe('123');
      expect(result.username).toBe('john');
      expect(result.role).toBe('user');
      expect(result.email).toHaveProperty('encrypted', true);
      expect(result.phone).toHaveProperty('encrypted', true);
      expect(result.address).toHaveProperty('encrypted', true);
      expect(result.fullName).toHaveProperty('encrypted', true);
    });

    it('should decrypt user sensitive fields', () => {
      const encryptedUserData = {
        id: '123',
        username: 'john',
        email: {
          data: mockEncryptedData,
          iv: mockIv.toString('hex'),
          tag: mockTag.toString('hex'),
          encrypted: true,
        },
        role: 'user',
      };

      const result = decryptUserData(encryptedUserData);

      expect(result.id).toBe('123');
      expect(result.username).toBe('john');
      expect(result.role).toBe('user');
      expect(result.email).toBe('decrypted-data');
    });
  });

  describe('Auth Data Encryption', () => {
    it('should encrypt auth sensitive fields', () => {
      const authData = {
        userId: '123',
        password: 'hashedpassword',
        resetToken: 'reset-token-123',
        mfaSecret: 'mfa-secret',
        lastLogin: new Date().toISOString(),
      };

      const result = encryptAuthData(authData);

      expect(result.userId).toBe('123');
      expect(result.lastLogin).toBe(authData.lastLogin);
      expect(result.password).toHaveProperty('encrypted', true);
      expect(result.resetToken).toHaveProperty('encrypted', true);
      expect(result.mfaSecret).toHaveProperty('encrypted', true);
    });

    it('should decrypt auth sensitive fields', () => {
      const encryptedAuthData = {
        userId: '123',
        password: {
          data: mockEncryptedData,
          iv: mockIv.toString('hex'),
          tag: mockTag.toString('hex'),
          encrypted: true,
        },
        lastLogin: new Date().toISOString(),
      };

      const result = decryptAuthData(encryptedAuthData);

      expect(result.userId).toBe('123');
      expect(result.lastLogin).toBe(encryptedAuthData.lastLogin);
      expect(result.password).toBe('decrypted-data');
    });
  });

  describe('Key Generation and Validation', () => {
    it('should generate valid encryption keys', () => {
      vi.mocked(crypto.randomBytes).mockReturnValueOnce(
        Buffer.from('12345678901234567890123456789012')
      );

      const keys = generateEncryptionKey();

      expect(keys).toHaveProperty('hex');
      expect(keys).toHaveProperty('base64');
      expect(keys.hex).toHaveLength(64); // 32 bytes * 2
      expect(Buffer.from(keys.hex, 'hex').length).toBe(32);
      expect(Buffer.from(keys.base64, 'base64').length).toBe(32);
    });

    it('should validate hex encoded keys', () => {
      const validHexKey = '1234567890123456789012345678901234567890123456789012345678901234';
      const invalidHexKey = '12345';

      expect(validateEncryptionKey(validHexKey)).toBe(true);
      expect(validateEncryptionKey(invalidHexKey)).toBe(false);
    });

    it('should validate base64 encoded keys', () => {
      const validBase64Key = Buffer.from('12345678901234567890123456789012').toString('base64');
      const invalidBase64Key = 'SGVsbG8='; // "Hello" in base64

      expect(validateEncryptionKey(validBase64Key)).toBe(true);
      expect(validateEncryptionKey(invalidBase64Key)).toBe(false);
    });

    it('should return false for invalid key formats', () => {
      expect(validateEncryptionKey('not-a-valid-key')).toBe(false);
      expect(validateEncryptionKey('')).toBe(false);
      expect(validateEncryptionKey('!@#$%')).toBe(false);
    });
  });

  describe('Sensitive Fields Constants', () => {
    it('should have correct sensitive field definitions', () => {
      expect(SENSITIVE_FIELDS.USER).toEqual(['email', 'phone', 'address', 'fullName']);
      expect(SENSITIVE_FIELDS.AUTH).toEqual(['password', 'resetToken', 'mfaSecret']);
      expect(SENSITIVE_FIELDS.PAYMENT).toEqual(['cardNumber', 'accountNumber', 'routingNumber']);
      expect(SENSITIVE_FIELDS.PERSONAL).toEqual(['ssn', 'taxId', 'driversLicense']);
      expect(SENSITIVE_FIELDS.MEDICAL).toEqual(['medicalConditions', 'medications', 'allergies']);
    });
  });
});