import { z } from 'zod';

/**
 * Standard database configuration schema
 *
 * Environment variables:
 * - DATABASE_URL (required): PostgreSQL connection string
 *
 * @example
 * ```typescript
 * const config = loadConfig(z.object({
 *   database: databaseConfigSchema
 * }));
 * ```
 */
export const databaseConfigSchema = z.object({
  url: z
    .string({
      required_error: 'DATABASE_URL is required but not set',
    })
    .url('DATABASE_URL must be a valid URL'),
});

/**
 * Standard server configuration schema
 *
 * Environment variables:
 * - PORT (optional): HTTP server port (default: 3001)
 * - NODE_ENV (optional): Environment (development/production/test, default: development)
 * - HOST (optional): Server bind address (default: 0.0.0.0)
 *
 * @example
 * ```typescript
 * const config = loadConfig(z.object({
 *   server: serverConfigSchema
 * }));
 * ```
 */
export const serverConfigSchema = z.object({
  port: z.coerce
    .number({
      invalid_type_error: 'PORT must be a number',
    })
    .int('PORT must be an integer')
    .min(1, 'PORT must be at least 1')
    .max(65535, 'PORT must be at most 65535')
    .default(3001),
  env: z
    .enum(['development', 'production', 'test'], {
      errorMap: () => ({ message: 'NODE_ENV must be one of: development, production, test' }),
    })
    .default('development'),
  host: z.string().default('0.0.0.0'),
});

/**
 * Standard authentication configuration schema
 *
 * Environment variables:
 * - JWT_SECRET (required): JWT signing secret (min 32 chars)
 * - JWT_EXPIRES_IN (optional): JWT expiration time (default: 7d)
 *
 * @example
 * ```typescript
 * const config = loadConfig(z.object({
 *   auth: authConfigSchema
 * }));
 * ```
 */
export const authConfigSchema = z.object({
  jwtSecret: z
    .string({
      required_error: 'JWT_SECRET is required but not set',
    })
    .min(32, 'JWT_SECRET must be at least 32 characters'),
  jwtExpiresIn: z.string().default('7d'),
});

/**
 * Standard logging configuration schema
 *
 * Environment variables:
 * - LOG_LEVEL (optional): Log level (error/warn/info/debug, default: info)
 * - LOG_SALT (optional): Salt for PII hashing (required if redaction enabled)
 *
 * @example
 * ```typescript
 * const config = loadConfig(z.object({
 *   logging: loggingConfigSchema
 * }));
 * ```
 */
export const loggingConfigSchema = z.object({
  level: z
    .enum(['error', 'warn', 'info', 'debug'], {
      errorMap: () => ({ message: 'LOG_LEVEL must be one of: error, warn, info, debug' }),
    })
    .default('info'),
  salt: z.string().optional(),
});

/**
 * Standard CORS configuration schema
 *
 * Environment variables:
 * - CORS_ORIGIN (optional): Allowed CORS origin (default: http://localhost:3000)
 *
 * @example
 * ```typescript
 * const config = loadConfig(z.object({
 *   cors: corsConfigSchema
 * }));
 * ```
 */
export const corsConfigSchema = z.object({
  origin: z.string().default('http://localhost:3000'),
});

/**
 * Complete application configuration schema combining all standard schemas
 *
 * This is a convenience schema that combines all standard configuration schemas.
 * You can use individual schemas or compose your own custom configuration.
 *
 * @example
 * ```typescript
 * // Use the complete schema
 * const config = loadConfig(appConfigSchema);
 *
 * // Or compose your own
 * const customSchema = z.object({
 *   database: databaseConfigSchema,
 *   server: serverConfigSchema,
 *   myCustomConfig: z.object({
 *     apiKey: z.string(),
 *   })
 * });
 * const config = loadConfig(customSchema);
 * ```
 */
export const appConfigSchema = z.object({
  database: databaseConfigSchema,
  server: serverConfigSchema.default({
    port: 3001,
    env: 'development',
    host: '0.0.0.0',
  }),
  auth: authConfigSchema,
  logging: loggingConfigSchema.default({
    level: 'info',
  }),
  cors: corsConfigSchema.default({
    origin: 'http://localhost:3000',
  }),
});

/**
 * Custom boolean coercion that properly handles string 'true'/'false'
 *
 * Unlike z.coerce.boolean(), this properly parses string values:
 * - 'true', '1', 'yes' -> true
 * - 'false', '0', 'no', '' -> false
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   ENABLED: booleanSchema,
 * });
 * ```
 */
export const booleanSchema = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const lower = val.toLowerCase().trim();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
    }
    return Boolean(val);
  });

/**
 * Helper to create a schema from environment variable mapping
 *
 * This utility helps map environment variables to nested config structure.
 *
 * @example
 * ```typescript
 * const schema = createEnvSchema({
 *   database: {
 *     url: 'DATABASE_URL',
 *   },
 *   server: {
 *     port: 'PORT',
 *   }
 * }, {
 *   database: databaseConfigSchema,
 *   server: serverConfigSchema,
 * });
 * ```
 */
export function createEnvSchema<T extends z.ZodRawShape>(
  shape: T
): z.ZodObject<T> {
  return z.object(shape);
}
