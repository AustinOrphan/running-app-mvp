import { ZodSchema } from 'zod';
import { ConfigValidationError } from './errors.js';

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /**
   * Source object to validate. If not provided, uses process.env
   */
  source?: Record<string, unknown>;

  /**
   * Whether to automatically load dotenv. Default: true
   * Will attempt to load dotenv if available, silently skip if not installed
   */
  loadDotenv?: boolean;

  /**
   * Path to .env file. Only used if loadDotenv is true
   */
  dotenvPath?: string;
}

/**
 * Loads and validates configuration using a Zod schema.
 *
 * Features:
 * - Optionally loads dotenv if available (peer dependency)
 * - Validates against provided Zod schema
 * - Throws ConfigValidationError with clear messages on failure
 * - Type-safe configuration object
 *
 * @param schema - Zod schema to validate configuration against
 * @param options - Loading options
 * @returns Validated and typed configuration object
 * @throws {ConfigValidationError} When validation fails
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { loadConfig } from '@AustinOrphan/config';
 *
 * const schema = z.object({
 *   port: z.coerce.number().default(3001),
 *   dbUrl: z.string(),
 * });
 *
 * const config = loadConfig(schema);
 * console.log(config.port); // Type-safe: number
 * ```
 */
export async function loadConfig<T extends ZodSchema>(
  schema: T,
  options: LoadConfigOptions = {}
): Promise<ReturnType<T['parse']>> {
  const { source, loadDotenv = true, dotenvPath } = options;

  // Load dotenv if requested and available
  if (loadDotenv && !source) {
    try {
      // Dynamic import to handle optional peer dependency
      const dotenv = await (async () => {
        try {
          return await import('dotenv');
        } catch {
          return null;
        }
      })();

      if (dotenv) {
        dotenv.config(dotenvPath ? { path: dotenvPath } : undefined);
      }
    } catch {
      // Silently ignore if dotenv is not available or fails to load
      // This is expected when dotenv is not installed (optional peer dependency)
    }
  }

  // Use provided source or process.env
  const configSource = source ?? process.env;

  // Validate configuration
  const result = schema.safeParse(configSource);

  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }

  return result.data;
}

/**
 * Synchronous version of loadConfig that doesn't attempt to load dotenv.
 * Use this if you've already loaded dotenv or don't need it.
 *
 * @param schema - Zod schema to validate configuration against
 * @param options - Loading options (loadDotenv is ignored)
 * @returns Validated and typed configuration object
 * @throws {ConfigValidationError} When validation fails
 */
export function loadConfigSync<T extends ZodSchema>(
  schema: T,
  options: LoadConfigOptions = {}
): ReturnType<T['parse']> {
  const { source } = options;

  // Use provided source or process.env
  const configSource = source ?? process.env;

  // Validate configuration
  const result = schema.safeParse(configSource);

  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }

  return result.data;
}
