# @AustinOrphan/config

Type-safe configuration management for backend services using Zod.

## Features

- **Type-safe**: Full TypeScript support with inferred types from Zod schemas
- **Validation at startup**: Fail fast with clear error messages
- **Default values**: Sensible defaults for development
- **Type coercion**: Automatic conversion (string to number, etc.)
- **Optional dotenv**: Automatically loads .env files if dotenv is installed
- **Standard schemas**: Pre-built schemas for common configuration needs
- **Clear errors**: Actionable error messages for validation failures

## Installation

```bash
pnpm add @AustinOrphan/config
```

Optional peer dependency for .env file support:

```bash
pnpm add -D dotenv
```

## Quick Start

```typescript
import { loadConfigSync, z } from '@AustinOrphan/config';

const schema = z.object({
  database: z.object({
    url: z.string().url(),
  }),
  server: z.object({
    port: z.coerce.number().default(3001),
  }),
});

// Map environment variables to nested structure
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

console.log(config.server.port); // Type-safe: number
```

## Using Standard Schemas

The package provides pre-built schemas following the configuration contract:

```typescript
import {
  loadConfigSync,
  z,
  databaseConfigSchema,
  serverConfigSchema,
  authConfigSchema,
  loggingConfigSchema,
} from '@AustinOrphan/config';

const schema = z.object({
  database: databaseConfigSchema,
  server: serverConfigSchema,
  auth: authConfigSchema,
  logging: loggingConfigSchema,
});

const config = loadConfigSync(schema, {
  source: {
    database: { url: process.env.DATABASE_URL },
    server: {
      port: process.env.PORT,
      env: process.env.NODE_ENV,
      host: process.env.HOST,
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN,
    },
    logging: {
      level: process.env.LOG_LEVEL,
      salt: process.env.LOG_SALT,
    },
  },
});
```

## Standard Schemas

### Database Configuration

```typescript
import { databaseConfigSchema } from '@AustinOrphan/config';

// Validates:
// - url: string (required, must be valid URL)
```

### Server Configuration

```typescript
import { serverConfigSchema } from '@AustinOrphan/config';

// Validates:
// - port: number (default: 3001, range: 1-65535)
// - env: 'development' | 'production' | 'test' (default: 'development')
// - host: string (default: '0.0.0.0')
```

### Auth Configuration

```typescript
import { authConfigSchema } from '@AustinOrphan/config';

// Validates:
// - jwtSecret: string (required, min 32 chars)
// - jwtExpiresIn: string (default: '7d')
```

### Logging Configuration

```typescript
import { loggingConfigSchema } from '@AustinOrphan/config';

// Validates:
// - level: 'error' | 'warn' | 'info' | 'debug' (default: 'info')
// - salt: string (optional)
```

### CORS Configuration

```typescript
import { corsConfigSchema } from '@AustinOrphan/config';

// Validates:
// - origin: string (default: 'http://localhost:3000')
```

## Custom Configuration

Extend or create your own schemas:

```typescript
import { loadConfigSync, z, serverConfigSchema } from '@AustinOrphan/config';

const schema = z.object({
  server: serverConfigSchema,
  custom: z.object({
    apiKey: z.string(),
    timeout: z.coerce.number().default(5000),
  }),
});

const config = loadConfigSync(schema, {
  source: {
    server: {
      port: process.env.PORT,
    },
    custom: {
      apiKey: process.env.API_KEY,
      timeout: process.env.TIMEOUT,
    },
  },
});
```

## Error Handling

Configuration validation errors provide clear, actionable messages:

```typescript
import { loadConfigSync, ConfigValidationError } from '@AustinOrphan/config';

try {
  const config = loadConfigSync(schema);
} catch (error) {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
    // Output:
    // Config validation failed:
    //   - database.url: DATABASE_URL is required but not set
    //   - auth.jwtSecret: JWT_SECRET must be at least 32 characters

    // Access structured error data
    error.issues.forEach((issue) => {
      console.log(`${issue.path.join('.')}: ${issue.message}`);
    });
  }
}
```

## API

### `loadConfigSync<T>(schema: ZodSchema, options?: LoadConfigOptions): T`

Synchronously loads and validates configuration.

**Options:**

- `source?: Record<string, unknown>` - Source object to validate (default: `process.env`)

**Returns:** Validated, type-safe configuration object

**Throws:** `ConfigValidationError` if validation fails

### `loadConfig<T>(schema: ZodSchema, options?: LoadConfigOptions): Promise<T>`

Asynchronously loads and validates configuration with optional dotenv loading.

**Options:**

- `source?: Record<string, unknown>` - Source object to validate (default: `process.env`)
- `loadDotenv?: boolean` - Whether to load dotenv (default: `true`)
- `dotenvPath?: string` - Path to .env file

**Returns:** Promise resolving to validated, type-safe configuration object

**Throws:** `ConfigValidationError` if validation fails

## Best Practices

1. **Validate at startup**: Call `loadConfig` before starting your server
2. **Use descriptive error messages**: Leverage Zod's custom error messages
3. **Provide defaults for development**: Make it easy to run locally
4. **Require secrets in production**: Use `.refine()` for environment-specific validation
5. **Document environment variables**: Keep a `.env.example` file
6. **Never commit secrets**: Add `.env` to `.gitignore`

## License

MIT
