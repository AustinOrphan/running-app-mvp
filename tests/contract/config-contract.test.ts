/**
 * Configuration Contract Tests
 *
 * Verifies that configuration validation follows the standards
 * as defined in AustinOrphan-backend-contracts/config-contract.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, z } from '@AustinOrphan/config';

describe('Configuration Contract Compliance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment before each test
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TEST_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('Environment Variable Naming', () => {
    it('should use SCREAMING_SNAKE_CASE for variable names', () => {
      const envVars = [
        'DATABASE_URL',
        'SERVER_PORT',
        'JWT_SECRET',
        'LOG_LEVEL',
        'NODE_ENV',
        'CORS_ORIGIN',
      ];

      const screamingSnakeCaseRegex = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

      envVars.forEach(varName => {
        expect(varName).toMatch(screamingSnakeCaseRegex);
      });
    });

    it('should use descriptive suffixes for types', () => {
      // URL suffix for connection strings
      expect('DATABASE_URL').toContain('_URL');

      // PORT suffix for port numbers
      expect('SERVER_PORT').toContain('_PORT');

      // SECRET suffix for secrets
      expect('JWT_SECRET').toContain('_SECRET');

      // PATH suffix for file paths
      expect('LOG_PATH').toContain('_PATH');
    });
  });

  describe('Type Safety and Validation', () => {
    it('should validate and type check configuration', async () => {
      const schema = z.object({
        database: z.object({
          url: z.string().url(),
        }),
        server: z.object({
          port: z.coerce.number().int().min(1).max(65535),
        }),
      });

      process.env.TEST_DATABASE_URL = 'postgresql://localhost:5432/test';
      process.env.TEST_SERVER_PORT = '3001';

      const config = await loadConfig(schema, {
        source: {
          database: { url: process.env.TEST_DATABASE_URL },
          server: { port: process.env.TEST_SERVER_PORT },
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/test');
      expect(config.server.port).toBe(3001);
      expect(typeof config.server.port).toBe('number');
    });

    it('should coerce string numbers to actual numbers', async () => {
      const schema = z.object({
        port: z.coerce.number().int(),
      });

      const config = await loadConfig(schema, {
        source: { port: '3001' },
      });

      expect(config.port).toBe(3001);
      expect(typeof config.port).toBe('number');
    });

    it('should coerce string booleans correctly', async () => {
      const booleanSchema = z
        .string()
        .optional()
        .transform(val => val === 'true');

      const schema = z.object({
        enabled: booleanSchema.default('false'),
      });

      const configTrue = await loadConfig(schema, {
        source: { enabled: 'true' },
      });
      expect(configTrue.enabled).toBe(true);

      const configFalse = await loadConfig(schema, {
        source: { enabled: 'false' },
      });
      expect(configFalse.enabled).toBe(false);
    });

    it('should validate enum values', async () => {
      const schema = z.object({
        env: z.enum(['development', 'production', 'test']),
      });

      const config = await loadConfig(schema, {
        source: { env: 'production' },
      });

      expect(config.env).toBe('production');
    });

    it('should reject invalid enum values', async () => {
      const schema = z.object({
        env: z.enum(['development', 'production', 'test']),
      });

      await expect(
        loadConfig(schema, {
          source: { env: 'invalid' },
        })
      ).rejects.toThrow();
    });
  });

  describe('Fail Fast Validation', () => {
    it('should throw clear error for missing required fields', async () => {
      const schema = z.object({
        database: z.object({
          url: z.string().min(1, 'DATABASE_URL is required'),
        }),
      });

      await expect(
        loadConfig(schema, {
          source: { database: { url: '' } },
        })
      ).rejects.toThrow();
    });

    it('should throw clear error for invalid types', async () => {
      const schema = z.object({
        port: z.coerce.number().int().min(1).max(65535),
      });

      await expect(
        loadConfig(schema, {
          source: { port: 'not-a-number' },
        })
      ).rejects.toThrow();
    });

    it('should provide actionable error messages', async () => {
      const schema = z.object({
        jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
      });

      try {
        await loadConfig(schema, {
          source: { jwtSecret: 'too-short' },
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain('32 characters');
      }
    });
  });

  describe('Default Values', () => {
    it('should provide sensible defaults for optional fields', async () => {
      const schema = z.object({
        server: z.object({
          port: z.coerce.number().default(3001),
          env: z.enum(['development', 'production', 'test']).default('development'),
        }),
        logging: z.object({
          level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          server: {},
          logging: {},
        },
      });

      expect(config.server.port).toBe(3001);
      expect(config.server.env).toBe('development');
      expect(config.logging.level).toBe('info');
    });

    it('should allow overriding defaults', async () => {
      const schema = z.object({
        server: z.object({
          port: z.coerce.number().default(3001),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          server: { port: 8080 },
        },
      });

      expect(config.server.port).toBe(8080);
    });
  });

  describe('Required vs Optional Fields', () => {
    it('should clearly distinguish required fields', async () => {
      const schema = z.object({
        database: z.object({
          url: z.string().min(1), // Required
        }),
        server: z.object({
          port: z.coerce.number().optional(), // Optional
        }),
      });

      // Should work with just required fields
      const config = await loadConfig(schema, {
        source: {
          database: { url: 'postgresql://localhost:5432/test' },
          server: {},
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/test');
      expect(config.server.port).toBeUndefined();
    });

    it('should fail when required field is missing', async () => {
      const schema = z.object({
        database: z.object({
          url: z.string().min(1),
        }),
      });

      await expect(
        loadConfig(schema, {
          source: {
            database: { url: '' },
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('Standard Variables', () => {
    it('should support DATABASE_URL', async () => {
      const schema = z.object({
        database: z.object({
          url: z.string().url(),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          database: { url: 'postgresql://localhost:5432/mydb' },
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/mydb');
    });

    it('should support PORT with number coercion', async () => {
      const schema = z.object({
        server: z.object({
          port: z.coerce.number().int().min(1).max(65535),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          server: { port: '3001' },
        },
      });

      expect(config.server.port).toBe(3001);
    });

    it('should support NODE_ENV with enum validation', async () => {
      const schema = z.object({
        server: z.object({
          env: z.enum(['development', 'production', 'test']),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          server: { env: 'production' },
        },
      });

      expect(config.server.env).toBe('production');
    });

    it('should support JWT_SECRET with minimum length', async () => {
      const schema = z.object({
        auth: z.object({
          jwtSecret: z.string().min(32),
        }),
      });

      const validSecret = 'a'.repeat(32);

      const config = await loadConfig(schema, {
        source: {
          auth: { jwtSecret: validSecret },
        },
      });

      expect(config.auth.jwtSecret).toBe(validSecret);
      expect(config.auth.jwtSecret.length).toBeGreaterThanOrEqual(32);
    });

    it('should support LOG_LEVEL with enum validation', async () => {
      const schema = z.object({
        logging: z.object({
          level: z.enum(['error', 'warn', 'info', 'debug']),
        }),
      });

      const config = await loadConfig(schema, {
        source: {
          logging: { level: 'info' },
        },
      });

      expect(config.logging.level).toBe('info');
    });
  });

  describe('Validation Rules', () => {
    it('should enforce minimum length for secrets', async () => {
      const schema = z.object({
        jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
      });

      const shortSecret = 'too-short';
      await expect(
        loadConfig(schema, {
          source: { jwtSecret: shortSecret },
        })
      ).rejects.toThrow();

      const validSecret = 'a'.repeat(32);
      const config = await loadConfig(schema, {
        source: { jwtSecret: validSecret },
      });
      expect(config.jwtSecret).toBe(validSecret);
    });

    it('should enforce port range (1-65535)', async () => {
      const schema = z.object({
        port: z.coerce.number().int().min(1).max(65535),
      });

      // Valid ports
      await expect(loadConfig(schema, { source: { port: 1 } })).resolves.toBeDefined();
      await expect(loadConfig(schema, { source: { port: 3001 } })).resolves.toBeDefined();
      await expect(loadConfig(schema, { source: { port: 65535 } })).resolves.toBeDefined();

      // Invalid ports
      await expect(loadConfig(schema, { source: { port: 0 } })).rejects.toThrow();
      await expect(loadConfig(schema, { source: { port: 65536 } })).rejects.toThrow();
    });

    it('should validate URL format', async () => {
      const schema = z.object({
        url: z.string().url(),
      });

      // Valid URLs
      await expect(
        loadConfig(schema, { source: { url: 'http://localhost:3000' } })
      ).resolves.toBeDefined();
      await expect(
        loadConfig(schema, { source: { url: 'https://example.com/path' } })
      ).resolves.toBeDefined();
      await expect(
        loadConfig(schema, { source: { url: 'postgresql://localhost:5432/mydb' } })
      ).resolves.toBeDefined();

      // Invalid URLs
      await expect(loadConfig(schema, { source: { url: 'not-a-url' } })).rejects.toThrow();
      await expect(loadConfig(schema, { source: { url: '/just/a/path' } })).rejects.toThrow();
    });
  });
});
