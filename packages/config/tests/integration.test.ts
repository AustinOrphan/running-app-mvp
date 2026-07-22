import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigSync, z } from '../src/index.js';
import {
  databaseConfigSchema,
  serverConfigSchema,
  authConfigSchema,
  loggingConfigSchema,
} from '../src/schemas.js';

describe('Integration Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Real-world configuration scenarios', () => {
    it('should load complete application configuration', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        auth: authConfigSchema,
        logging: loggingConfigSchema,
      });

      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: 'postgresql://localhost:5432/myapp',
          },
          server: {
            port: '3001',
            env: 'development',
            host: '0.0.0.0',
          },
          auth: {
            jwtSecret: 'my-super-secret-key-that-is-at-least-32-characters-long',
            jwtExpiresIn: '7d',
          },
          logging: {
            level: 'info',
          },
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/myapp');
      expect(config.server.port).toBe(3001);
      expect(config.server.env).toBe('development');
      expect(config.auth.jwtSecret).toBe(
        'my-super-secret-key-that-is-at-least-32-characters-long'
      );
      expect(config.logging.level).toBe('info');
    });

    it('should handle production configuration', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        auth: authConfigSchema,
        logging: loggingConfigSchema,
      });

      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: 'postgresql://prod-db:5432/myapp',
          },
          server: {
            port: '8080',
            env: 'production',
            host: '0.0.0.0',
          },
          auth: {
            jwtSecret: 'production-secret-key-that-is-at-least-32-characters',
            jwtExpiresIn: '24h',
          },
          logging: {
            level: 'warn',
            salt: 'production-salt-for-pii-hashing',
          },
        },
      });

      expect(config.server.env).toBe('production');
      expect(config.server.port).toBe(8080);
      expect(config.logging.level).toBe('warn');
      expect(config.logging.salt).toBe('production-salt-for-pii-hashing');
    });

    it('should handle minimal configuration with defaults', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        auth: authConfigSchema,
        logging: loggingConfigSchema,
      });

      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: 'postgresql://localhost:5432/myapp',
          },
          server: {},
          auth: {
            jwtSecret: 'my-super-secret-key-that-is-at-least-32-characters-long',
          },
          logging: {},
        },
      });

      expect(config.server.port).toBe(3001);
      expect(config.server.env).toBe('development');
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.auth.jwtExpiresIn).toBe('7d');
      expect(config.logging.level).toBe('info');
    });
  });

  describe('Custom service configuration', () => {
    it('should extend standard schemas with custom fields', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        custom: z.object({
          apiKey: z.string(),
          timeout: z.coerce.number().default(5000),
        }),
      });

      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: 'postgresql://localhost:5432/myapp',
          },
          server: {},
          custom: {
            apiKey: 'my-api-key',
          },
        },
      });

      expect(config.database.url).toBe('postgresql://localhost:5432/myapp');
      expect(config.server.port).toBe(3001);
      expect(config.custom.apiKey).toBe('my-api-key');
      expect(config.custom.timeout).toBe(5000);
    });

    it('should validate custom business rules', () => {
      const schema = z
        .object({
          server: serverConfigSchema,
          rateLimit: z.object({
            enabled: z.coerce.boolean().default(true),
            maxRequests: z.coerce.number().default(100),
          }),
        })
        .refine(
          (data) => {
            if (data.server.env === 'production') {
              return data.rateLimit.enabled;
            }
            return true;
          },
          {
            message: 'Rate limiting must be enabled in production',
          }
        );

      const validConfig = loadConfigSync(schema, {
        source: {
          server: {
            env: 'production',
          },
          rateLimit: {
            enabled: 'true',
            maxRequests: '1000',
          },
        },
      });

      expect(validConfig.server.env).toBe('production');
      expect(validConfig.rateLimit.enabled).toBe(true);
    });
  });

  describe('Type safety', () => {
    it('should provide type-safe access to configuration', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
      });

      const config = loadConfigSync(schema, {
        source: {
          database: {
            url: 'postgresql://localhost:5432/myapp',
          },
          server: {
            port: '3001',
          },
        },
      });

      // These should be type-safe
      const url: string = config.database.url;
      const port: number = config.server.port;
      const env: 'development' | 'production' | 'test' = config.server.env;

      expect(typeof url).toBe('string');
      expect(typeof port).toBe('number');
      expect(['development', 'production', 'test']).toContain(env);
    });
  });

  describe('Error handling', () => {
    it('should provide clear error for multiple validation failures', () => {
      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        auth: authConfigSchema,
      });

      try {
        loadConfigSync(schema, {
          source: {
            database: {
              url: 'invalid-url',
            },
            server: {
              port: '70000',
            },
            auth: {
              jwtSecret: 'short',
            },
          },
        });
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Config validation failed');
        expect(error.message).toContain('database.url');
        expect(error.message).toContain('server.port');
        expect(error.message).toContain('auth.jwtSecret');
      }
    });
  });

  describe('Environment variable mapping', () => {
    it('should map flat environment variables to nested structure', () => {
      // In real usage, you would map env vars to nested structure
      process.env.DATABASE_URL = 'postgresql://localhost:5432/myapp';
      process.env.PORT = '3001';
      process.env.JWT_SECRET = 'my-super-secret-key-that-is-at-least-32-characters-long';

      const schema = z.object({
        database: databaseConfigSchema,
        server: serverConfigSchema,
        auth: authConfigSchema,
      });

      // Map flat env vars to nested structure
      const mappedSource = {
        database: {
          url: process.env.DATABASE_URL,
        },
        server: {
          port: process.env.PORT,
          env: process.env.NODE_ENV,
          host: process.env.HOST,
        },
        auth: {
          jwtSecret: process.env.JWT_SECRET,
          jwtExpiresIn: process.env.JWT_EXPIRES_IN,
        },
      };

      const config = loadConfigSync(schema, { source: mappedSource });

      expect(config.database.url).toBe('postgresql://localhost:5432/myapp');
      expect(config.server.port).toBe(3001);
      expect(config.auth.jwtSecret).toBe(
        'my-super-secret-key-that-is-at-least-32-characters-long'
      );
    });
  });
});
