/**
 * @AustinOrphan/config
 *
 * Type-safe configuration management for backend services.
 *
 * Features:
 * - Zod-based schema validation
 * - Clear, actionable error messages
 * - Optional dotenv integration
 * - Standard configuration schemas
 * - Type coercion (string to number, etc.)
 * - Default values support
 *
 * @example
 * ```typescript
 * import { loadConfig, z } from '@AustinOrphan/config';
 *
 * const schema = z.object({
 *   database: z.object({
 *     url: z.string().url(),
 *   }),
 *   server: z.object({
 *     port: z.coerce.number().default(3001),
 *   })
 * });
 *
 * // Automatically loads .env and validates
 * const config = await loadConfig(schema);
 *
 * // Or synchronous without dotenv loading
 * const config = loadConfigSync(schema);
 * ```
 *
 * @packageDocumentation
 */

// Re-export zod for convenience
export { z } from 'zod';
export type { ZodSchema, ZodType, ZodTypeAny } from 'zod';

// Core functionality
export { loadConfig, loadConfigSync } from './loader.js';
export type { LoadConfigOptions } from './loader.js';

// Error handling
export { ConfigValidationError } from './errors.js';

// Standard schemas
export {
  databaseConfigSchema,
  serverConfigSchema,
  authConfigSchema,
  loggingConfigSchema,
  corsConfigSchema,
  appConfigSchema,
  booleanSchema,
  createEnvSchema,
} from './schemas.js';
