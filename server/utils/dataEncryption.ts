import crypto from 'crypto';
import { logError, logInfo } from './logger.js';

/**
 * Data Encryption Utilities for Sensitive Data at Rest
 *
 * Implements AES-256-GCM encryption for sensitive data with proper key management
 * Provides field-level encryption for database storage and audit logs
 */

export interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  encrypted: true;
}

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
}

const DEFAULT_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  keyLength: 32, // 256 bits
  ivLength: 16, // 128 bits
  tagLength: 16, // 128 bits
};

class DataEncryption {
  private readonly config: EncryptionConfig;
  private encryptionKey?: Buffer;

  constructor(config: EncryptionConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.initializeEncryptionKey();
  }

  private initializeEncryptionKey(): void {
    const keyString = process.env.DATA_ENCRYPTION_KEY;

    if (!keyString) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'CRITICAL: DATA_ENCRYPTION_KEY environment variable must be set in production'
        );
      }

      logInfo('encryption', 'key-init', 'Using development encryption key');
      // Generate a consistent key for development
      this.encryptionKey = crypto.scryptSync('dev-encryption-key', 'salt', this.config.keyLength);
      return;
    }

    try {
      // Support both hex and base64 encoded keys
      if (keyString.length === this.config.keyLength * 2) {
        // Hex encoded
        this.encryptionKey = Buffer.from(keyString, 'hex');
      } else {
        // Base64 encoded
        this.encryptionKey = Buffer.from(keyString, 'base64');
      }

      if (this.encryptionKey.length !== this.config.keyLength) {
        throw new Error(`Encryption key must be ${this.config.keyLength} bytes`);
      }
    } catch (error) {
      logError('encryption', 'key-init', error);
      throw new Error('Invalid DATA_ENCRYPTION_KEY format');
    }
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   */
  encrypt(data: string): EncryptedData {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    try {
      const iv = crypto.randomBytes(this.config.ivLength);
      const cipher = crypto.createCipheriv(
        this.config.algorithm,
        this.encryptionKey,
        iv
      ) as crypto.CipherGCM;
      cipher.setAAD(Buffer.from('audit-data')); // Additional authenticated data

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return {
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        encrypted: true,
      };
    } catch (error) {
      logError('encryption', 'encrypt', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt data encrypted with encrypt()
   */
  decrypt(encryptedData: EncryptedData): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    if (!encryptedData.encrypted) {
      throw new Error('Data is not encrypted');
    }

    try {
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const tag = Buffer.from(encryptedData.tag, 'hex');

      const decipher = crypto.createDecipheriv(
        this.config.algorithm,
        this.encryptionKey,
        iv
      ) as crypto.DecipherGCM;
      decipher.setAAD(Buffer.from('audit-data')); // Must match AAD from encryption
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logError('encryption', 'decrypt', error);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Encrypt an object by encrypting its JSON representation
   */
  encryptObject(obj: Record<string, unknown>): EncryptedData {
    const json = JSON.stringify(obj);
    return this.encrypt(json);
  }

  /**
   * Decrypt an encrypted object
   */
  decryptObject(encryptedData: EncryptedData): Record<string, unknown> {
    const json = this.decrypt(encryptedData);
    return JSON.parse(json);
  }

  /**
   * Encrypt specific fields in an object
   */
  encryptFields(obj: Record<string, unknown>, fieldsToEncrypt: string[]): Record<string, unknown> {
    const result = { ...obj };

    for (const field of fieldsToEncrypt) {
      if (result[field] !== undefined && result[field] !== null) {
        const value =
          typeof result[field] === 'string'
            ? (result[field] as string)
            : JSON.stringify(result[field]);

        result[field] = this.encrypt(value);
      }
    }

    return result;
  }

  /**
   * Decrypt specific fields in an object
   */
  decryptFields(obj: Record<string, unknown>, fieldsToDecrypt: string[]): Record<string, unknown> {
    const result = { ...obj };

    for (const field of fieldsToDecrypt) {
      const value = result[field];
      if (value && typeof value === 'object' && (value as EncryptedData).encrypted) {
        try {
          const decrypted = this.decrypt(value as EncryptedData);
          // Try to parse as JSON, fallback to string
          try {
            result[field] = JSON.parse(decrypted);
          } catch {
            result[field] = decrypted;
          }
        } catch (error) {
          logError('encryption', 'field-decrypt', error, undefined, { field });
          // Keep encrypted data if decryption fails
        }
      }
    }

    return result;
  }

  /**
   * Generate a new encryption key for key rotation
   */
  static generateKey(): { hex: string; base64: string } {
    const key = crypto.randomBytes(DEFAULT_CONFIG.keyLength);
    return {
      hex: key.toString('hex'),
      base64: key.toString('base64'),
    };
  }

  /**
   * Validate encryption key format
   */
  static validateKey(key: string): boolean {
    try {
      let keyBuffer: Buffer;

      if (key.length === DEFAULT_CONFIG.keyLength * 2) {
        keyBuffer = Buffer.from(key, 'hex');
      } else {
        keyBuffer = Buffer.from(key, 'base64');
      }

      return keyBuffer.length === DEFAULT_CONFIG.keyLength;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const dataEncryption = new DataEncryption();

// Export convenience functions
export const encryptData = (data: string): EncryptedData => dataEncryption.encrypt(data);
export const decryptData = (encryptedData: EncryptedData): string =>
  dataEncryption.decrypt(encryptedData);
export const encryptObject = (obj: Record<string, unknown>): EncryptedData =>
  dataEncryption.encryptObject(obj);
export const decryptObject = (encryptedData: EncryptedData): Record<string, unknown> =>
  dataEncryption.decryptObject(encryptedData);
export const encryptFields = (
  obj: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> => dataEncryption.encryptFields(obj, fields);
export const decryptFields = (
  obj: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> => dataEncryption.decryptFields(obj, fields);

// Export utilities
export const generateEncryptionKey = DataEncryption.generateKey;
export const validateEncryptionKey = DataEncryption.validateKey;

// Field-level encryption helpers for common sensitive data
export const SENSITIVE_FIELDS = {
  USER: ['email', 'phone', 'address', 'fullName'],
  AUTH: ['password', 'resetToken', 'mfaSecret'],
  PAYMENT: ['cardNumber', 'accountNumber', 'routingNumber'],
  PERSONAL: ['ssn', 'taxId', 'driversLicense'],
  MEDICAL: ['medicalConditions', 'medications', 'allergies'],
} as const;

/**
 * Encrypt user sensitive data for database storage
 */
export const encryptUserData = (userData: Record<string, unknown>): Record<string, unknown> => {
  return dataEncryption.encryptFields(userData, [...SENSITIVE_FIELDS.USER]);
};

/**
 * Decrypt user sensitive data from database
 */
export const decryptUserData = (
  encryptedUserData: Record<string, unknown>
): Record<string, unknown> => {
  return dataEncryption.decryptFields(encryptedUserData, [...SENSITIVE_FIELDS.USER]);
};

/**
 * Encrypt authentication data
 */
export const encryptAuthData = (authData: Record<string, unknown>): Record<string, unknown> => {
  return dataEncryption.encryptFields(authData, [...SENSITIVE_FIELDS.AUTH]);
};

/**
 * Decrypt authentication data
 */
export const decryptAuthData = (
  encryptedAuthData: Record<string, unknown>
): Record<string, unknown> => {
  return dataEncryption.decryptFields(encryptedAuthData, [...SENSITIVE_FIELDS.AUTH]);
};
