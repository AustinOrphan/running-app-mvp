import { describe, it, expect } from 'vitest';
import {
  databaseConfigSchema,
  serverConfigSchema,
  authConfigSchema,
  loggingConfigSchema,
  corsConfigSchema,
  appConfigSchema,
  createEnvSchema,
} from '../src/schemas.js';
import { z } from 'zod';

describe('databaseConfigSchema', () => {
  it('should validate valid database URL', () => {
    const config = {
      url: 'postgresql://localhost:5432/mydb',
    };

    const result = databaseConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('postgresql://localhost:5432/mydb');
    }
  });

  it('should reject invalid URL', () => {
    const config = {
      url: 'not-a-url',
    };

    const result = databaseConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('DATABASE_URL must be a valid URL');
    }
  });

  it('should reject missing URL', () => {
    const config = {};

    const result = databaseConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'DATABASE_URL is required but not set'
      );
    }
  });
});

describe('serverConfigSchema', () => {
  it('should use default values', () => {
    const config = {};

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(3001);
      expect(result.data.env).toBe('development');
      expect(result.data.host).toBe('0.0.0.0');
    }
  });

  it('should validate valid configuration', () => {
    const config = {
      port: 8080,
      env: 'production',
      host: 'localhost',
    };

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(8080);
      expect(result.data.env).toBe('production');
      expect(result.data.host).toBe('localhost');
    }
  });

  it('should coerce string port to number', () => {
    const config = {
      port: '3001',
    };

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(3001);
      expect(typeof result.data.port).toBe('number');
    }
  });

  it('should reject port less than 1', () => {
    const config = {
      port: 0,
    };

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('should reject port greater than 65535', () => {
    const config = {
      port: 70000,
    };

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('should reject invalid env value', () => {
    const config = {
      env: 'invalid',
    };

    const result = serverConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'NODE_ENV must be one of: development, production, test'
      );
    }
  });

  it('should accept all valid env values', () => {
    const envs = ['development', 'production', 'test'];

    for (const env of envs) {
      const result = serverConfigSchema.safeParse({ env });
      expect(result.success).toBe(true);
    }
  });
});

describe('authConfigSchema', () => {
  it('should validate valid auth configuration', () => {
    const config = {
      jwtSecret: 'a'.repeat(32),
      jwtExpiresIn: '7d',
    };

    const result = authConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jwtSecret).toBe('a'.repeat(32));
      expect(result.data.jwtExpiresIn).toBe('7d');
    }
  });

  it('should use default expiration', () => {
    const config = {
      jwtSecret: 'a'.repeat(32),
    };

    const result = authConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jwtExpiresIn).toBe('7d');
    }
  });

  it('should reject missing JWT secret', () => {
    const config = {};

    const result = authConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'JWT_SECRET is required but not set'
      );
    }
  });

  it('should reject JWT secret shorter than 32 characters', () => {
    const config = {
      jwtSecret: 'too-short',
    };

    const result = authConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'JWT_SECRET must be at least 32 characters'
      );
    }
  });

  it('should accept custom expiration values', () => {
    const expirations = ['1h', '24h', '30d', '1y'];

    for (const exp of expirations) {
      const result = authConfigSchema.safeParse({
        jwtSecret: 'a'.repeat(32),
        jwtExpiresIn: exp,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('loggingConfigSchema', () => {
  it('should use default log level', () => {
    const config = {};

    const result = loggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.level).toBe('info');
      expect(result.data.salt).toBeUndefined();
    }
  });

  it('should validate valid log levels', () => {
    const levels = ['error', 'warn', 'info', 'debug'];

    for (const level of levels) {
      const result = loggingConfigSchema.safeParse({ level });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid log level', () => {
    const config = {
      level: 'invalid',
    };

    const result = loggingConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        'LOG_LEVEL must be one of: error, warn, info, debug'
      );
    }
  });

  it('should accept optional salt', () => {
    const config = {
      salt: 'my-salt-value',
    };

    const result = loggingConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salt).toBe('my-salt-value');
    }
  });
});

describe('corsConfigSchema', () => {
  it('should use default origin', () => {
    const config = {};

    const result = corsConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin).toBe('http://localhost:3000');
    }
  });

  it('should accept custom origin', () => {
    const config = {
      origin: 'https://example.com',
    };

    const result = corsConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin).toBe('https://example.com');
    }
  });
});

describe('appConfigSchema', () => {
  it('should validate complete configuration', () => {
    const config = {
      database: {
        url: 'postgresql://localhost:5432/mydb',
      },
      server: {
        port: 3001,
        env: 'development',
        host: '0.0.0.0',
      },
      auth: {
        jwtSecret: 'a'.repeat(32),
        jwtExpiresIn: '7d',
      },
      logging: {
        level: 'info',
      },
      cors: {
        origin: 'http://localhost:3000',
      },
    };

    const result = appConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it('should use all default values', () => {
    const config = {
      database: {
        url: 'postgresql://localhost:5432/mydb',
      },
      auth: {
        jwtSecret: 'a'.repeat(32),
      },
    };

    const result = appConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(3001);
      expect(result.data.server.env).toBe('development');
      expect(result.data.auth.jwtExpiresIn).toBe('7d');
      expect(result.data.logging.level).toBe('info');
      expect(result.data.cors.origin).toBe('http://localhost:3000');
    }
  });

  it('should reject incomplete configuration', () => {
    const config = {
      server: {
        port: 3001,
      },
    };

    const result = appConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Should fail on missing database and auth
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('createEnvSchema', () => {
  it('should create a valid schema', () => {
    const schema = createEnvSchema({
      port: z.coerce.number(),
      host: z.string(),
    });

    const result = schema.safeParse({
      port: '3001',
      host: 'localhost',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(3001);
      expect(result.data.host).toBe('localhost');
    }
  });
});
