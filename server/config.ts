/**
 * Application Configuration
 *
 * Uses @AustinOrphan/config for type-safe configuration validation.
 * Centralizes all environment variable access with fail-fast validation.
 */

import { loadConfig, z, booleanSchema } from '@AustinOrphan/config';

// Define the complete configuration schema
const configSchema = z.object({
  // Database
  database: z.object({
    url: z.string().min(1, 'DATABASE_URL is required'),
    ssl: booleanSchema.default(false),
    sslRejectUnauthorized: booleanSchema.default(true),
  }),

  // Server
  server: z.object({
    port: z.coerce.number().int().min(1).max(65535).default(3001),
    env: z.enum(['development', 'production', 'test']).default('development'),
    httpsPort: z.coerce.number().int().min(1).max(65535).default(443),
    httpsRedirect: booleanSchema.default(false),
    trustProxy: booleanSchema.default(false),
  }),

  // JWT Authentication
  auth: z.object({
    jwtSecret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    jwtAccessExpiry: z.string().default('1h'),
    jwtRefreshExpiry: z.string().default('7d'),
    jwtAlgorithm: z.string().default('HS256'),
    bcryptRounds: z.coerce.number().int().min(10).max(15).default(12),
    passwordMinLength: z.coerce.number().int().min(8).default(12),
    sessionSecret: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    sessionSecure: booleanSchema.default(false),
    sessionSameSite: z.enum(['strict', 'lax', 'none']).default('strict'),
  }),

  // Logging
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    salt: z.string().min(16, 'LOG_SALT must be at least 16 characters'),
    piiHashingEnabled: booleanSchema.default(true),
    securityLoggingEnabled: booleanSchema.default(true),
  }),

  // CORS
  cors: z.object({
    allowedOrigins: z.string().optional(),
    credentials: booleanSchema.default(true),
  }),

  // Rate Limiting
  rateLimit: z.object({
    enabled: booleanSchema.default(true),
    authWindowMinutes: z.coerce.number().int().min(1).default(15),
    authMaxAttempts: z.coerce.number().int().min(1).default(5),
    apiWindowMinutes: z.coerce.number().int().min(1).default(15),
    apiMaxRequests: z.coerce.number().int().min(1).default(100),
  }),

  // Security Headers
  security: z.object({
    cspEnabled: booleanSchema.default(true),
    hstsEnabled: booleanSchema.default(true),
    hstsMaxAge: z.coerce.number().int().min(0).default(31536000),
    xFrameOptions: z.enum(['DENY', 'SAMEORIGIN']).default('DENY'),
    xContentTypeOptions: booleanSchema.default(true),
    xssProtection: booleanSchema.default(true),
    referrerPolicy: z.string().default('strict-origin-when-cross-origin'),
    crossOriginEmbedderPolicy: z.string().default('require-corp'),
    crossOriginOpenerPolicy: z.string().default('same-origin'),
    crossOriginResourcePolicy: z.string().default('same-origin'),
    blockedIps: z.string().optional(),
    allowedIps: z.string().optional(),
    blockSuspiciousUserAgents: booleanSchema.default(false),
  }),

  // SSL/TLS
  ssl: z.object({
    enabled: booleanSchema.default(false),
    certPath: z.string().default('./certs/cert.pem'),
    keyPath: z.string().default('./certs/key.pem'),
    caPath: z.string().optional(),
    passphrase: z.string().optional(),
    dhParamPath: z.string().optional(),
    protocols: z.string().default('TLSv1.2,TLSv1.3'),
    ciphers: z.string().optional(),
    honorCipherOrder: booleanSchema.default(true),
    rejectUnauthorized: booleanSchema.default(true),
  }),

  // Input Validation
  validation: z.object({
    maxRequestSize: z.coerce.number().int().min(1024).default(1048576),
    sanitizationEnabled: booleanSchema.default(true),
  }),

  // Audit Logging
  audit: z.object({
    storageType: z.enum(['memory', 'file']).default('memory'),
    logPath: z.string().default('./logs/audit.log'),
    maxMemoryEvents: z.coerce.number().int().min(100).default(10000),
    retentionDays: z.coerce.number().int().min(1).default(365),
    cleanupIntervalHours: z.coerce.number().int().min(1).default(24),
    encryptionKey: z.string().optional(),
  }),

  // Data Encryption
  encryption: z.object({
    key: z.string().optional(),
  }),
});

// Define the mapping from environment variables to nested config structure
function mapEnvToConfig(env: NodeJS.ProcessEnv) {
  return {
    database: {
      url: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      sslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,
    },
    server: {
      port: env.PORT,
      env: env.NODE_ENV,
      httpsPort: env.HTTPS_PORT,
      httpsRedirect: env.REDIRECT_HTTP_TO_HTTPS || env.FORCE_HTTPS || env.HTTPS_REDIRECT,
      trustProxy: env.TRUST_PROXY,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtAccessExpiry: env.JWT_ACCESS_EXPIRY,
      jwtRefreshExpiry: env.JWT_REFRESH_EXPIRY,
      jwtAlgorithm: env.JWT_ALGORITHM,
      bcryptRounds: env.BCRYPT_ROUNDS,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      sessionSecret: env.SESSION_SECRET,
      sessionSecure: env.SESSION_SECURE,
      sessionSameSite: env.SESSION_SAME_SITE,
    },
    logging: {
      level: env.LOG_LEVEL,
      salt: env.LOG_SALT,
      piiHashingEnabled: env.PII_HASHING_ENABLED,
      securityLoggingEnabled: env.SECURITY_LOGGING_ENABLED,
    },
    cors: {
      allowedOrigins: env.ALLOWED_ORIGINS,
      credentials: env.CORS_CREDENTIALS,
    },
    rateLimit: {
      enabled: env.RATE_LIMITING_ENABLED,
      authWindowMinutes: env.AUTH_RATE_LIMIT_WINDOW,
      authMaxAttempts: env.AUTH_RATE_LIMIT_MAX,
      apiWindowMinutes: env.API_RATE_LIMIT_WINDOW,
      apiMaxRequests: env.API_RATE_LIMIT_MAX,
    },
    security: {
      cspEnabled: env.CSP_ENABLED,
      hstsEnabled: env.HSTS_ENABLED,
      hstsMaxAge: env.HSTS_MAX_AGE,
      xFrameOptions: env.X_FRAME_OPTIONS,
      xContentTypeOptions: env.X_CONTENT_TYPE_OPTIONS,
      xssProtection: env.X_XSS_PROTECTION,
      referrerPolicy: env.REFERRER_POLICY,
      crossOriginEmbedderPolicy: env.CROSS_ORIGIN_EMBEDDER_POLICY,
      crossOriginOpenerPolicy: env.CROSS_ORIGIN_OPENER_POLICY,
      crossOriginResourcePolicy: env.CROSS_ORIGIN_RESOURCE_POLICY,
      blockedIps: env.BLOCKED_IPS,
      allowedIps: env.ALLOWED_IPS,
      blockSuspiciousUserAgents: env.BLOCK_SUSPICIOUS_USER_AGENTS,
    },
    ssl: {
      enabled: env.SSL_ENABLED,
      certPath: env.SSL_CERT_PATH,
      keyPath: env.SSL_KEY_PATH,
      caPath: env.SSL_CA_PATH,
      passphrase: env.SSL_PASSPHRASE,
      dhParamPath: env.SSL_DH_PARAM_PATH,
      protocols: env.SSL_PROTOCOLS,
      ciphers: env.SSL_CIPHERS,
      honorCipherOrder: env.SSL_HONOR_CIPHER_ORDER,
      rejectUnauthorized: env.SSL_REJECT_UNAUTHORIZED,
    },
    validation: {
      maxRequestSize: env.MAX_REQUEST_SIZE,
      sanitizationEnabled: env.SANITIZATION_ENABLED,
    },
    audit: {
      storageType: env.AUDIT_STORAGE_TYPE,
      logPath: env.AUDIT_LOG_PATH,
      maxMemoryEvents: env.AUDIT_MAX_MEMORY_EVENTS,
      retentionDays: env.AUDIT_RETENTION_DAYS,
      cleanupIntervalHours: env.AUDIT_CLEANUP_INTERVAL_HOURS,
      encryptionKey: env.AUDIT_ENCRYPTION_KEY,
    },
    encryption: {
      key: env.DATA_ENCRYPTION_KEY,
    },
  };
}

// Load and validate configuration
export async function initializeConfig() {
  const mappedEnv = mapEnvToConfig(process.env);
  const configResult = await loadConfig(configSchema, { source: mappedEnv });
  return configResult;
}

// Export a promise that resolves to the config for synchronous module loading
export const configPromise = initializeConfig();

// Type export for use throughout the application
export type AppConfig = z.infer<typeof configSchema>;
