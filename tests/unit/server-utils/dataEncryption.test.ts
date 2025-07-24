import {
  dataEncryption,
  encryptData,
  decryptData,
  encryptObject,
  decryptObject,
  encryptFields,
  decryptFields,
  generateEncryptionKey,
  validateEncryptionKey,
  encryptUserData,
  decryptUserData,
  encryptAuthData,
  decryptAuthData,
  SENSITIVE_FIELDS,
  DataEncryption,
} from '../../../server/utils/dataEncryption.js';
import type { EncryptedData } from '../../../server/utils/dataEncryption.js';
import crypto from 'crypto';

describe('Data Encryption Utilities', () => {
  const originalEnv = process.env.DATA_ENCRYPTION_KEY;

  beforeEach(() => {
    // Set a test encryption key
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.DATA_ENCRYPTION_KEY = originalEnv;
  });

  describe('DataEncryption class', () => {
    describe('initialization', () => {
      it('initializes with valid hex key', () => {
        const hexKey = crypto.randomBytes(32).toString('hex');
        process.env.DATA_ENCRYPTION_KEY = hexKey;

        expect(() => new DataEncryption()).not.toThrow();
      });

      it('initializes with valid base64 key', () => {
        const base64Key = crypto.randomBytes(32).toString('base64');
        process.env.DATA_ENCRYPTION_KEY = base64Key;

        expect(() => new DataEncryption()).not.toThrow();
      });

      it('throws error in production without key', () => {
        delete process.env.DATA_ENCRYPTION_KEY;
        process.env.NODE_ENV = 'production';

        expect(() => new DataEncryption()).toThrow(
          'CRITICAL: DATA_ENCRYPTION_KEY environment variable must be set in production'
        );

        process.env.NODE_ENV = 'test';
      });

      it('uses development key when no key provided in non-production', () => {
        delete process.env.DATA_ENCRYPTION_KEY;
        process.env.NODE_ENV = 'development';

        const encryption = new DataEncryption();
        const data = 'test data';
        const encrypted = encryption.encrypt(data);
        const decrypted = encryption.decrypt(encrypted);

        expect(decrypted).toBe(data);

        process.env.NODE_ENV = 'test';
      });

      it('throws error with invalid key length', () => {
        process.env.DATA_ENCRYPTION_KEY = 'short-key';

        expect(() => new DataEncryption()).toThrow('Invalid DATA_ENCRYPTION_KEY format');
      });
    });

    describe('encrypt and decrypt', () => {
      let encryption: DataEncryption;

      beforeEach(() => {
        encryption = new DataEncryption();
      });

      it('encrypts and decrypts string data correctly', () => {
        const plaintext = 'This is sensitive data';

        const encrypted = encryption.encrypt(plaintext);

        expect(encrypted).toHaveProperty('data');
        expect(encrypted).toHaveProperty('iv');
        expect(encrypted).toHaveProperty('tag');
        expect(encrypted).toHaveProperty('encrypted', true);

        expect(encrypted.data).not.toBe(plaintext);
        expect(encrypted.iv).toMatch(/^[0-9a-f]{32}$/);
        expect(encrypted.tag).toMatch(/^[0-9a-f]{32}$/);

        const decrypted = encryption.decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
      });

      it('produces different ciphertext for same plaintext', () => {
        const plaintext = 'Same data';

        const encrypted1 = encryption.encrypt(plaintext);
        const encrypted2 = encryption.encrypt(plaintext);

        expect(encrypted1.data).not.toBe(encrypted2.data);
        expect(encrypted1.iv).not.toBe(encrypted2.iv);

        expect(encryption.decrypt(encrypted1)).toBe(plaintext);
        expect(encryption.decrypt(encrypted2)).toBe(plaintext);
      });

      it('handles empty string', () => {
        const plaintext = '';

        const encrypted = encryption.encrypt(plaintext);
        const decrypted = encryption.decrypt(encrypted);

        expect(decrypted).toBe(plaintext);
      });

      it('handles unicode characters', () => {
        const plaintext = '🔐 Unicode test 测试 тест';

        const encrypted = encryption.encrypt(plaintext);
        const decrypted = encryption.decrypt(encrypted);

        expect(decrypted).toBe(plaintext);
      });

      it('throws error when decrypting invalid data', () => {
        const invalidData: EncryptedData = {
          data: 'invalid-hex',
          iv: crypto.randomBytes(16).toString('hex'),
          tag: crypto.randomBytes(16).toString('hex'),
          encrypted: true,
        };

        expect(() => encryption.decrypt(invalidData)).toThrow('Decryption failed');
      });

      it('throws error when decrypting with wrong tag', () => {
        const encrypted = encryption.encrypt('test');
        encrypted.tag = crypto.randomBytes(16).toString('hex');

        expect(() => encryption.decrypt(encrypted)).toThrow('Decryption failed');
      });

      it('throws error when decrypting non-encrypted data', () => {
        const nonEncrypted = {
          data: 'test',
          iv: 'iv',
          tag: 'tag',
          encrypted: false,
        } as EncryptedData;

        expect(() => encryption.decrypt(nonEncrypted)).toThrow('Data is not encrypted');
      });
    });

    describe('encryptObject and decryptObject', () => {
      let encryption: DataEncryption;

      beforeEach(() => {
        encryption = new DataEncryption();
      });

      it('encrypts and decrypts objects correctly', () => {
        const obj = {
          name: 'John Doe',
          age: 30,
          email: 'john@example.com',
          nested: {
            key: 'value',
          },
        };

        const encrypted = encryption.encryptObject(obj);
        const decrypted = encryption.decryptObject(encrypted);

        expect(decrypted).toEqual(obj);
      });

      it('handles arrays in objects', () => {
        const obj = {
          items: ['one', 'two', 'three'],
          numbers: [1, 2, 3],
        };

        const encrypted = encryption.encryptObject(obj);
        const decrypted = encryption.decryptObject(encrypted);

        expect(decrypted).toEqual(obj);
      });
    });

    describe('encryptFields and decryptFields', () => {
      let encryption: DataEncryption;

      beforeEach(() => {
        encryption = new DataEncryption();
      });

      it('encrypts only specified fields', () => {
        const obj = {
          publicData: 'visible',
          sensitiveData: 'secret',
          morePublic: 'also visible',
        };

        const encrypted = encryption.encryptFields(obj, ['sensitiveData']);

        expect(encrypted.publicData).toBe('visible');
        expect(encrypted.morePublic).toBe('also visible');
        expect(encrypted.sensitiveData).toHaveProperty('encrypted', true);
      });

      it('decrypts only encrypted fields', () => {
        const obj = {
          publicData: 'visible',
          sensitiveData: 'secret',
          moreSecret: 'also secret',
        };

        const encrypted = encryption.encryptFields(obj, ['sensitiveData', 'moreSecret']);
        const decrypted = encryption.decryptFields(encrypted, ['sensitiveData', 'moreSecret']);

        expect(decrypted).toEqual(obj);
      });

      it('handles null and undefined fields gracefully', () => {
        const obj = {
          data: 'value',
          nullField: null,
          undefinedField: undefined,
        };

        const encrypted = encryption.encryptFields(obj, ['nullField', 'undefinedField', 'data']);

        expect(encrypted.nullField).toBeNull();
        expect(encrypted.undefinedField).toBeUndefined();
        expect(encrypted.data).toHaveProperty('encrypted', true);
      });

      it('encrypts non-string values by converting to JSON', () => {
        const obj = {
          numberField: 42,
          booleanField: true,
          objectField: { nested: 'value' },
        };

        const encrypted = encryption.encryptFields(obj, [
          'numberField',
          'booleanField',
          'objectField',
        ]);
        const decrypted = encryption.decryptFields(encrypted, [
          'numberField',
          'booleanField',
          'objectField',
        ]);

        expect(decrypted).toEqual(obj);
      });

      it('keeps encrypted data if decryption fails', () => {
        const obj = {
          field1: 'value1',
          field2: 'value2',
        };

        const encrypted = encryption.encryptFields(obj, ['field1', 'field2']);

        // Corrupt the encrypted data
        (encrypted.field1 as EncryptedData).tag = 'invalid-tag';

        const decrypted = encryption.decryptFields(encrypted, ['field1', 'field2']);

        expect(decrypted.field1).toHaveProperty('encrypted', true);
        expect(decrypted.field2).toBe('value2');
      });
    });
  });

  describe('Static methods', () => {
    describe('generateKey', () => {
      it('generates valid encryption keys', () => {
        const key = DataEncryption.generateKey();

        expect(key).toHaveProperty('hex');
        expect(key).toHaveProperty('base64');
        expect(key.hex).toMatch(/^[0-9a-f]{64}$/);
        expect(Buffer.from(key.hex, 'hex').length).toBe(32);
        expect(Buffer.from(key.base64, 'base64').length).toBe(32);
      });

      it('generates different keys each time', () => {
        const key1 = DataEncryption.generateKey();
        const key2 = DataEncryption.generateKey();

        expect(key1.hex).not.toBe(key2.hex);
        expect(key1.base64).not.toBe(key2.base64);
      });
    });

    describe('validateKey', () => {
      it('validates hex keys correctly', () => {
        const validHex = crypto.randomBytes(32).toString('hex');
        const invalidHex = 'not-a-valid-hex-key';

        expect(DataEncryption.validateKey(validHex)).toBe(true);
        expect(DataEncryption.validateKey(invalidHex)).toBe(false);
      });

      it('validates base64 keys correctly', () => {
        const validBase64 = crypto.randomBytes(32).toString('base64');
        const invalidBase64 = 'short';

        expect(DataEncryption.validateKey(validBase64)).toBe(true);
        expect(DataEncryption.validateKey(invalidBase64)).toBe(false);
      });

      it('rejects keys with wrong length', () => {
        const wrongLengthHex = crypto.randomBytes(16).toString('hex');
        const wrongLengthBase64 = crypto.randomBytes(16).toString('base64');

        expect(DataEncryption.validateKey(wrongLengthHex)).toBe(false);
        expect(DataEncryption.validateKey(wrongLengthBase64)).toBe(false);
      });
    });
  });

  describe('Convenience functions', () => {
    it('encryptData and decryptData work correctly', () => {
      const data = 'Test data';

      const encrypted = encryptData(data);
      const decrypted = decryptData(encrypted);

      expect(decrypted).toBe(data);
    });

    it('encryptObject and decryptObject work correctly', () => {
      const obj = { key: 'value', number: 123 };

      const encrypted = encryptObject(obj);
      const decrypted = decryptObject(encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('encryptFields and decryptFields work correctly', () => {
      const obj = { public: 'visible', secret: 'hidden' };

      const encrypted = encryptFields(obj, ['secret']);
      const decrypted = decryptFields(encrypted, ['secret']);

      expect(decrypted).toEqual(obj);
    });

    it('generateEncryptionKey works correctly', () => {
      const key = generateEncryptionKey();

      expect(key).toHaveProperty('hex');
      expect(key).toHaveProperty('base64');
    });

    it('validateEncryptionKey works correctly', () => {
      const validKey = crypto.randomBytes(32).toString('hex');

      expect(validateEncryptionKey(validKey)).toBe(true);
      expect(validateEncryptionKey('invalid')).toBe(false);
    });
  });

  describe('Field-level encryption helpers', () => {
    it('encryptUserData encrypts correct fields', () => {
      const userData = {
        id: '123',
        email: 'user@example.com',
        phone: '+1234567890',
        address: '123 Main St',
        fullName: 'John Doe',
        role: 'user',
      };

      const encrypted = encryptUserData(userData);

      expect(encrypted.id).toBe('123');
      expect(encrypted.role).toBe('user');
      expect(encrypted.email).toHaveProperty('encrypted', true);
      expect(encrypted.phone).toHaveProperty('encrypted', true);
      expect(encrypted.address).toHaveProperty('encrypted', true);
      expect(encrypted.fullName).toHaveProperty('encrypted', true);
    });

    it('decryptUserData decrypts correct fields', () => {
      const userData = {
        id: '123',
        email: 'user@example.com',
        phone: '+1234567890',
        address: '123 Main St',
        fullName: 'John Doe',
        role: 'user',
      };

      const encrypted = encryptUserData(userData);
      const decrypted = decryptUserData(encrypted);

      expect(decrypted).toEqual(userData);
    });

    it('encryptAuthData encrypts correct fields', () => {
      const authData = {
        userId: '123',
        password: 'hashedPassword',
        resetToken: 'token123',
        mfaSecret: 'secret456',
        lastLogin: new Date().toISOString(),
      };

      const encrypted = encryptAuthData(authData);

      expect(encrypted.userId).toBe('123');
      expect(encrypted.lastLogin).toBe(authData.lastLogin);
      expect(encrypted.password).toHaveProperty('encrypted', true);
      expect(encrypted.resetToken).toHaveProperty('encrypted', true);
      expect(encrypted.mfaSecret).toHaveProperty('encrypted', true);
    });

    it('decryptAuthData decrypts correct fields', () => {
      const authData = {
        userId: '123',
        password: 'hashedPassword',
        resetToken: 'token123',
        mfaSecret: 'secret456',
        lastLogin: new Date().toISOString(),
      };

      const encrypted = encryptAuthData(authData);
      const decrypted = decryptAuthData(encrypted);

      expect(decrypted).toEqual(authData);
    });
  });

  describe('SENSITIVE_FIELDS constant', () => {
    it('contains expected field categories', () => {
      expect(SENSITIVE_FIELDS).toHaveProperty('USER');
      expect(SENSITIVE_FIELDS).toHaveProperty('AUTH');
      expect(SENSITIVE_FIELDS).toHaveProperty('PAYMENT');
      expect(SENSITIVE_FIELDS).toHaveProperty('PERSONAL');
      expect(SENSITIVE_FIELDS).toHaveProperty('MEDICAL');

      expect(SENSITIVE_FIELDS.USER).toContain('email');
      expect(SENSITIVE_FIELDS.AUTH).toContain('password');
      expect(SENSITIVE_FIELDS.PAYMENT).toContain('cardNumber');
      expect(SENSITIVE_FIELDS.PERSONAL).toContain('ssn');
      expect(SENSITIVE_FIELDS.MEDICAL).toContain('medicalConditions');
    });
  });
});
