# Security Configuration Guide

## Overview

This guide provides detailed instructions for implementing and configuring security measures in the Running App MVP. Follow these steps to ensure your deployment meets security best practices.

## Environment Configuration

### Required Security Environment Variables

Create a `.env` file (production) or update your environment with the following variables:

```bash
# JWT Configuration
JWT_SECRET=your-256-bit-secret-here          # Generate with: openssl rand -base64 32
JWT_ACCESS_EXPIRY=1h                         # Access token expiration
JWT_REFRESH_EXPIRY=7d                        # Refresh token expiration
JWT_ALGORITHM=HS256                          # JWT signing algorithm

# Password Security
BCRYPT_ROUNDS=12                             # Password hashing rounds (10-15)
PASSWORD_MIN_LENGTH=12                       # Minimum password length

# Rate Limiting
RATE_LIMITING_ENABLED=true                   # Enable rate limiting
AUTH_RATE_LIMIT_WINDOW=15                    # Auth rate limit window (minutes)
AUTH_RATE_LIMIT_MAX=5                        # Max auth attempts per window
API_RATE_LIMIT_WINDOW=15                     # API rate limit window (minutes)
API_RATE_LIMIT_MAX=100                       # Max API requests per window

# CORS Configuration
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
CORS_CREDENTIALS=true                        # Allow credentials in CORS

# Security Headers
CSP_ENABLED=true                             # Enable Content Security Policy
HSTS_ENABLED=true                            # Enable HTTP Strict Transport Security
HSTS_MAX_AGE=31536000                        # HSTS max age (1 year)

# Database Security
DATABASE_SSL=true                            # Require SSL for database connections
DATABASE_SSL_REJECT_UNAUTHORIZED=true       # Reject unauthorized SSL certificates

# Session Security
SESSION_SECRET=your-session-secret-here      # Generate with: openssl rand -base64 32
SESSION_SECURE=true                          # Require HTTPS for sessions (production)
SESSION_SAME_SITE=strict                     # SameSite cookie attribute

# Monitoring & Logging
SECURITY_LOGGING_ENABLED=true               # Enable security event logging
LOG_LEVEL=info                               # Logging level (error, warn, info, debug)
PII_HASHING_ENABLED=true                     # Hash PII in logs

# Production Security
NODE_ENV=production                          # Set to production
HTTPS_REDIRECT=true                          # Redirect HTTP to HTTPS
```

### Generating Secure Secrets

```bash
# Generate JWT secret (256-bit)
openssl rand -base64 32

# Generate session secret
openssl rand -base64 32

# Alternative using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## JWT Security Implementation

### Enhanced JWT Configuration

Update your JWT implementation to include these security improvements:

```javascript
// middleware/auth.js
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Token generation with enhanced security
export const generateTokens = user => {
  const payload = {
    id: user.id,
    email: user.email,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(), // Unique token ID
    type: 'access',
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  const refreshPayload = {
    id: user.id,
    jti: crypto.randomUUID(),
    type: 'refresh',
  };

  const refreshToken = jwt.sign(refreshPayload, process.env.JWT_SECRET, {
    algorithm: process.env.JWT_ALGORITHM || 'HS256',
    expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  return { accessToken, refreshToken };
};

// Enhanced token validation
export const validateToken = (token, type = 'access') => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: [process.env.JWT_ALGORITHM || 'HS256'],
      issuer: 'running-app',
      audience: 'running-app-users',
    });

    // Verify token type
    if (decoded.type !== type) {
      throw new Error('Invalid token type');
    }

    // Check if token is blacklisted (implement based on your needs)
    if (isTokenBlacklisted(decoded.jti)) {
      throw new Error('Token has been revoked');
    }

    return decoded;
  } catch (error) {
    throw new Error(`Token validation failed: ${error.message}`);
  }
};
```

### Token Blacklist Implementation

```javascript
// utils/tokenBlacklist.js
const blacklistedTokens = new Set(); // Use Redis in production

export const blacklistToken = (jti, expiresAt) => {
  blacklistedTokens.add(jti);

  // Schedule automatic removal after expiration
  const ttl = expiresAt - Math.floor(Date.now() / 1000);
  if (ttl > 0) {
    setTimeout(() => {
      blacklistedTokens.delete(jti);
    }, ttl * 1000);
  }
};

export const isTokenBlacklisted = jti => {
  return blacklistedTokens.has(jti);
};

// Logout endpoint implementation
export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const decoded = jwt.decode(token);

    if (decoded && decoded.jti) {
      blacklistToken(decoded.jti, decoded.exp);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
};
```

## Security Headers Configuration

### Install and Configure Helmet.js

```bash
npm install helmet
```

```javascript
// middleware/security.js
import helmet from 'helmet';

export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.running-app.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    reportOnly: false, // Set to true for testing
  },

  // HTTP Strict Transport Security
  hsts: {
    maxAge: parseInt(process.env.HSTS_MAX_AGE) || 31536000,
    includeSubDomains: true,
    preload: true,
  },

  // X-Frame-Options
  frameguard: {
    action: 'deny',
  },

  // X-Content-Type-Options
  noSniff: true,

  // Referrer Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },

  // X-DNS-Prefetch-Control
  dnsPrefetchControl: {
    allow: false,
  },

  // X-Download-Options
  ieNoOpen: true,

  // X-Permitted-Cross-Domain-Policies
  permittedCrossDomainPolicies: false,

  // Hide X-Powered-By header
  hidePoweredBy: true,

  // Cross-Origin-Embedder-Policy
  crossOriginEmbedderPolicy: false, // Set to true if needed

  // Cross-Origin-Opener-Policy
  crossOriginOpenerPolicy: {
    policy: 'same-origin',
  },

  // Cross-Origin-Resource-Policy
  crossOriginResourcePolicy: {
    policy: 'same-origin',
  },
});
```

### Apply Security Headers

```javascript
// server.js
import { securityHeaders } from './middleware/security.js';

// Apply security headers early in middleware stack
app.use(securityHeaders);
```

## CORS Configuration

### Production CORS Setup

```javascript
// middleware/cors.js
import cors from 'cors';

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000', // Development
  'http://localhost:5173', // Vite dev server
];

export const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },

  credentials: process.env.CORS_CREDENTIALS === 'true',

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],

  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],

  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining', 'X-Rate-Limit-Reset'],

  optionsSuccessStatus: 200, // IE11 support

  preflightContinue: false,

  maxAge: 86400, // 24 hours
};

// Apply CORS
app.use(cors(corsOptions));
```

## Enhanced Password Security

### Password Validation Schema

```javascript
// validation/passwordSchema.js
import zod from 'zod';

const commonPasswords = [
  'password',
  '123456',
  'password123',
  'admin',
  'qwerty',
  'letmein',
  'welcome',
  'monkey',
  '1234567890',
];

export const passwordSchema = zod
  .string()
  .min(
    parseInt(process.env.PASSWORD_MIN_LENGTH) || 12,
    `Password must be at least ${process.env.PASSWORD_MIN_LENGTH || 12} characters`
  )
  .max(128, 'Password must be less than 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character')
  .refine(password => {
    const lower = password.toLowerCase();
    return !commonPasswords.some(common => lower.includes(common));
  }, 'Password contains common words and is not secure')
  .refine(password => {
    // Check for repeated characters (more than 3 in a row)
    return !/(.)\1{3,}/.test(password);
  }, 'Password cannot contain more than 3 repeated characters')
  .refine(password => {
    // Check for sequential characters
    const sequences = ['0123456789', 'abcdefghijklmnopqrstuvwxyz'];
    return !sequences.some(
      seq =>
        seq.includes(password.toLowerCase().slice(0, 4)) ||
        seq.split('').reverse().join('').includes(password.toLowerCase().slice(0, 4))
    );
  }, 'Password cannot contain sequential characters');
```

### Password Strength Meter

```javascript
// utils/passwordStrength.js
export const calculatePasswordStrength = password => {
  let score = 0;
  const feedback = [];

  // Length scoring
  if (password.length >= 12) score += 2;
  else if (password.length >= 8) score += 1;
  else feedback.push('Use at least 12 characters');

  // Character variety
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push('Add lowercase letters');

  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push('Add uppercase letters');

  if (/[0-9]/.test(password)) score += 1;
  else feedback.push('Add numbers');

  if (/[^A-Za-z0-9]/.test(password)) score += 2;
  else feedback.push('Add special characters');

  // Entropy check
  const entropy = calculateEntropy(password);
  if (entropy > 60) score += 2;
  else if (entropy > 40) score += 1;

  const strength =
    score >= 8 ? 'Strong' : score >= 6 ? 'Medium' : score >= 4 ? 'Weak' : 'Very Weak';

  return { score, strength, feedback, entropy };
};

const calculateEntropy = password => {
  const charSets = [/[a-z]/g, /[A-Z]/g, /[0-9]/g, /[^A-Za-z0-9]/g];

  let charSetSize = 0;
  charSets.forEach(set => {
    if (set.test(password)) {
      if (set === /[a-z]/g) charSetSize += 26;
      else if (set === /[A-Z]/g) charSetSize += 26;
      else if (set === /[0-9]/g) charSetSize += 10;
      else charSetSize += 32; // Approximate special chars
    }
  });

  return password.length * Math.log2(charSetSize);
};
```

## Database Security

### Secure Database Configuration

```javascript
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Connection with SSL
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?sslmode=require'
    }
  },
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'info', 'warn', 'error']
    : ['error']
});
```

### Query Security

```javascript
// Secure query examples
export const getRunsByUser = async userId => {
  // Good: Parameterized query via Prisma
  return await prisma.run.findMany({
    where: {
      userId: userId, // Type-safe parameter
      deletedAt: null,
    },
    select: {
      id: true,
      date: true,
      distance: true,
      duration: true,
      // Exclude sensitive fields
    },
    orderBy: { date: 'desc' },
  });
};

// Input sanitization for raw queries (avoid if possible)
export const sanitizeInput = input => {
  if (typeof input !== 'string') return input;

  return input
    .replace(/[<>]/g, '') // Remove potential HTML
    .trim()
    .slice(0, 1000); // Limit length
};
```

## Rate Limiting Configuration

### Enhanced Rate Limiting

```javascript
// middleware/rateLimiting.js
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Authentication endpoints (very strict)
export const authLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  }),
  windowMs: (parseInt(process.env.AUTH_RATE_LIMIT_WINDOW) || 15) * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  message: {
    error: 'Too many authentication attempts',
    retryAfter: Math.ceil(
      ((parseInt(process.env.AUTH_RATE_LIMIT_WINDOW) || 15) * 60 * 1000) / 1000
    ),
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    // Combine IP and user agent for better accuracy
    return `${req.ip}:${req.get('User-Agent')}`;
  },
  skip: req => {
    // Skip rate limiting for testing in development
    return process.env.NODE_ENV === 'test';
  },
});

// API endpoints
export const apiLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  }),
  windowMs: (parseInt(process.env.API_RATE_LIMIT_WINDOW) || 15) * 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX) || 100,
  message: {
    error: 'Too many requests',
    retryAfter: Math.ceil(((parseInt(process.env.API_RATE_LIMIT_WINDOW) || 15) * 60 * 1000) / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    // Use user ID for authenticated requests, IP for others
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  },
});
```

## Security Monitoring

### Security Event Logging

```javascript
// utils/securityLogger.js
import { createLogger, format, transports } from 'winston';

const securityLogger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  defaultMeta: { service: 'running-app-security' },
  transports: [
    new transports.File({
      filename: 'logs/security.log',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
});

export const logSecurityEvent = (event, details, req = null) => {
  const logData = {
    event,
    details,
    timestamp: new Date().toISOString(),
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    userId: req?.user?.id,
  };

  // Hash PII in production
  if (process.env.NODE_ENV === 'production') {
    if (logData.ip) logData.ip = hashPII(logData.ip);
    if (logData.userId) logData.userId = hashPII(logData.userId);
  }

  securityLogger.warn(logData);
};

// Usage examples
logSecurityEvent('FAILED_LOGIN_ATTEMPT', { email: 'user@example.com' }, req);
logSecurityEvent('RATE_LIMIT_EXCEEDED', { endpoint: '/api/auth/login' }, req);
logSecurityEvent('SUSPICIOUS_ACTIVITY', { pattern: 'rapid_requests' }, req);
```

## Deployment Security Checklist

### Pre-Deployment

```bash
# 1. Environment Variables Check
echo "Checking environment variables..."
[ -z "$JWT_SECRET" ] && echo "❌ JWT_SECRET not set" || echo "✅ JWT_SECRET set"
[ -z "$DATABASE_URL" ] && echo "❌ DATABASE_URL not set" || echo "✅ DATABASE_URL set"
[ "$NODE_ENV" = "production" ] && echo "✅ NODE_ENV is production" || echo "⚠️ NODE_ENV not production"

# 2. Dependencies Audit
npm audit --audit-level=moderate

# 3. Security Linting
npm run lint:security

# 4. Test Security Features
npm run test:security
```

### Production Configuration

```javascript
// config/production.js
export const productionConfig = {
  // Force HTTPS
  httpsRedirect: true,

  // Secure cookies
  session: {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  },

  // Disable detailed errors
  showStackTrace: false,

  // Enable security logging
  securityLogging: true,

  // Database SSL
  database: {
    ssl: {
      rejectUnauthorized: true,
    },
  },
};
```

## Testing Security

### Security Test Suite

```javascript
// tests/security/security.test.js
describe('Security Tests', () => {
  describe('Authentication', () => {
    test('should reject weak passwords', async () => {
      const weakPasswords = ['123456', 'password', 'qwerty'];

      for (const password of weakPasswords) {
        const response = await request(app).post('/api/auth/register').send({
          email: 'test@example.com',
          password: password,
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/password/i);
      }
    });

    test('should enforce rate limiting on login', async () => {
      const attempts = Array(6)
        .fill()
        .map(() =>
          request(app).post('/api/auth/login').send({
            email: 'test@example.com',
            password: 'wrongpassword',
          })
        );

      const responses = await Promise.all(attempts);
      const lastResponse = responses[responses.length - 1];

      expect(lastResponse.status).toBe(429);
    });
  });

  describe('Input Validation', () => {
    test('should sanitize XSS attempts', async () => {
      const xssPayload = '<script>alert("xss")</script>';

      const response = await request(app)
        .post('/api/runs')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          route: xssPayload,
          distance: 5,
          duration: 1800,
        });

      expect(response.body.route).not.toContain('<script>');
    });

    test('should prevent SQL injection', async () => {
      const sqlPayload = "'; DROP TABLE users; --";

      const response = await request(app)
        .get(`/api/runs?search=${encodeURIComponent(sqlPayload)}`)
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).not.toBe(500);
    });
  });

  describe('Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app).get('/');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
    });
  });
});
```

### Automated Security Scanning

```bash
#!/bin/bash
# scripts/security-scan.sh

echo "Running security scans..."

# Dependency vulnerability scan
echo "Checking dependencies..."
npm audit --audit-level=moderate

# SAST scanning
echo "Running static analysis..."
npx eslint . --ext .js,.ts --config .eslintrc.security.js

# Secrets scanning
echo "Scanning for secrets..."
npx git-secrets --scan

# Docker security scan (if using Docker)
if [ -f "Dockerfile" ]; then
  echo "Scanning Docker image..."
  docker run --rm -v $(pwd):/app clair-scanner:latest
fi

echo "Security scan complete!"
```

## Incident Response

### Security Incident Playbook

```markdown
# Security Incident Response

## Immediate Actions (0-15 minutes)

1. [ ] Identify the security incident type
2. [ ] Assess immediate impact and scope
3. [ ] Implement containment measures
4. [ ] Preserve evidence
5. [ ] Notify security team

## Investigation (15 minutes - 1 hour)

1. [ ] Collect logs and evidence
2. [ ] Determine attack vector
3. [ ] Assess data compromise
4. [ ] Document timeline
5. [ ] Identify affected systems

## Recovery (1-24 hours)

1. [ ] Implement security patches
2. [ ] Reset compromised credentials
3. [ ] Restore from clean backups
4. [ ] Update security measures
5. [ ] Verify system integrity

## Post-Incident (24-72 hours)

1. [ ] Conduct lessons learned session
2. [ ] Update security policies
3. [ ] Improve monitoring
4. [ ] Train team on findings
5. [ ] Document incident report
```

---

This configuration guide provides comprehensive security implementation instructions. Regularly review and update these configurations as security best practices evolve.
