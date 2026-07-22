import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { loadConfig, loadConfigSync } from '../src/loader.js';
import { booleanSchema } from '../src/schemas.js';
import { ConfigValidationError } from '../src/errors.js';

describe('loadConfigSync', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('basic validation', () => {
    it('should load valid configuration from process.env', () => {
      process.env.PORT = '3001';
      process.env.HOST = 'localhost';

      const schema = z.object({
        PORT: z.coerce.number(),
        HOST: z.string(),
      });

      const config = loadConfigSync(schema);

      expect(config).toEqual({
        PORT: 3001,
        HOST: 'localhost',
      });
    });

    it('should load valid configuration from custom source', () => {
      const source = {
        PORT: '3001',
        HOST: 'localhost',
      };

      const schema = z.object({
        PORT: z.coerce.number(),
        HOST: z.string(),
      });

      const config = loadConfigSync(schema, { source });

      expect(config).toEqual({
        PORT: 3001,
        HOST: 'localhost',
      });
    });

    it('should throw ConfigValidationError on invalid config', () => {
      process.env.PORT = 'invalid';

      const schema = z.object({
        PORT: z.coerce.number(),
      });

      expect(() => loadConfigSync(schema)).toThrow(ConfigValidationError);
    });

    it('should throw ConfigValidationError with clear message', () => {
      const schema = z.object({
        REQUIRED_FIELD: z.string(),
      });

      expect(() => loadConfigSync(schema)).toThrow('Config validation failed');
      expect(() => loadConfigSync(schema)).toThrow('REQUIRED_FIELD');
    });
  });

  describe('type coercion', () => {
    it('should coerce string to number', () => {
      process.env.PORT = '3001';

      const schema = z.object({
        PORT: z.coerce.number(),
      });

      const config = loadConfigSync(schema);

      expect(config.PORT).toBe(3001);
      expect(typeof config.PORT).toBe('number');
    });

    it('should coerce string to boolean', () => {
      process.env.ENABLED = 'true';
      process.env.DISABLED = 'false';

      const schema = z.object({
        ENABLED: booleanSchema,
        DISABLED: booleanSchema,
      });

      const config = loadConfigSync(schema);

      expect(config.ENABLED).toBe(true);
      expect(config.DISABLED).toBe(false);
    });

    it('should handle enum values', () => {
      process.env.NODE_ENV = 'production';

      const schema = z.object({
        NODE_ENV: z.enum(['development', 'production', 'test']),
      });

      const config = loadConfigSync(schema);

      expect(config.NODE_ENV).toBe('production');
    });
  });

  describe('default values', () => {
    it('should use default value when field is missing', () => {
      const schema = z.object({
        PORT: z.coerce.number().default(3001),
        HOST: z.string().default('localhost'),
      });

      const config = loadConfigSync(schema);

      expect(config.PORT).toBe(3001);
      expect(config.HOST).toBe('localhost');
    });

    it('should override default with provided value', () => {
      process.env.PORT = '8080';

      const schema = z.object({
        PORT: z.coerce.number().default(3001),
      });

      const config = loadConfigSync(schema);

      expect(config.PORT).toBe(8080);
    });
  });

  describe('optional fields', () => {
    it('should allow optional fields to be missing', () => {
      const schema = z.object({
        REQUIRED: z.string(),
        OPTIONAL: z.string().optional(),
      });

      const config = loadConfigSync(schema, {
        source: { REQUIRED: 'value' },
      });

      expect(config.REQUIRED).toBe('value');
      expect(config.OPTIONAL).toBeUndefined();
    });

    it('should include optional field when provided', () => {
      const schema = z.object({
        REQUIRED: z.string(),
        OPTIONAL: z.string().optional(),
      });

      const config = loadConfigSync(schema, {
        source: { REQUIRED: 'value', OPTIONAL: 'optional-value' },
      });

      expect(config.REQUIRED).toBe('value');
      expect(config.OPTIONAL).toBe('optional-value');
    });
  });

  describe('nested schemas', () => {
    it('should validate nested configuration', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
      process.env.PORT = '3001';

      const schema = z.object({
        database: z.object({
          url: z.string(),
        }),
        server: z.object({
          port: z.coerce.number(),
        }),
      });

      // Need to transform the flat env vars to nested structure
      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: process.env.DATABASE_URL,
          },
          server: {
            port: process.env.PORT,
          },
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/db');
      expect(config.server.port).toBe(3001);
    });
  });

  describe('validation rules', () => {
    it('should enforce minimum value', () => {
      process.env.PORT = '0';

      const schema = z.object({
        PORT: z.coerce.number().min(1),
      });

      expect(() => loadConfigSync(schema)).toThrow(ConfigValidationError);
    });

    it('should enforce maximum value', () => {
      process.env.PORT = '70000';

      const schema = z.object({
        PORT: z.coerce.number().max(65535),
      });

      expect(() => loadConfigSync(schema)).toThrow(ConfigValidationError);
    });

    it('should enforce string length', () => {
      process.env.SECRET = 'short';

      const schema = z.object({
        SECRET: z.string().min(32),
      });

      expect(() => loadConfigSync(schema)).toThrow(ConfigValidationError);
    });

    it('should enforce URL format', () => {
      process.env.DATABASE_URL = 'not-a-url';

      const schema = z.object({
        DATABASE_URL: z.string().url(),
      });

      expect(() => loadConfigSync(schema)).toThrow(ConfigValidationError);
    });
  });

  describe('error messages', () => {
    it('should provide actionable error for missing required field', () => {
      const schema = z.object({
        JWT_SECRET: z.string({
          required_error: 'JWT_SECRET is required but not set',
        }),
      });

      try {
        loadConfigSync(schema);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).message).toContain(
          'JWT_SECRET is required but not set'
        );
      }
    });

    it('should provide actionable error for invalid type', () => {
      process.env.PORT = 'not-a-number';

      const schema = z.object({
        PORT: z.number({
          invalid_type_error: 'PORT must be a number',
        }),
      });

      try {
        loadConfigSync(schema);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).message).toContain('PORT');
      }
    });

    it('should provide actionable error for validation failure', () => {
      process.env.JWT_SECRET = 'too-short';

      const schema = z.object({
        JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
      });

      try {
        loadConfigSync(schema);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).message).toContain(
          'JWT_SECRET must be at least 32 characters'
        );
      }
    });
  });
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TEST;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should work without dotenv installed', async () => {
    const schema = z.object({
      TEST: z.string().default('default'),
    });

    const config = await loadConfig(schema, { loadDotenv: false });

    expect(config.TEST).toBe('default');
  });

  it('should use provided source', async () => {
    const schema = z.object({
      TEST: z.string(),
    });

    const config = await loadConfig(schema, {
      source: { TEST: 'value' },
    });

    expect(config.TEST).toBe('value');
  });
});
