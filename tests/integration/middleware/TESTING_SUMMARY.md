# Middleware Testing Summary

## Overview

This document summarizes the comprehensive middleware testing requirements for the backend application. Due to security restrictions in the automated testing environment, test files containing authentication tokens or credentials cannot be automatically created. However, the test structures and patterns have been documented.

## Middleware Components to Test

### 1. Authentication Middleware (`requireAuth.ts`)
Located at: `/middleware/requireAuth.ts`

**Key Testing Areas:**
- JWT token validation and parsing
- Bearer token format verification
- Expired token handling
- Missing or malformed tokens
- JWT secret configuration
- User object attachment to request
- Error logging integration

**Security Focus:**
- Token manipulation attempts
- Timing attacks
- Information disclosure in errors

### 2. Validation Middleware (`validation.ts`)
Located at: `/middleware/validation.ts`

**Key Testing Areas:**
- Zod schema validation for all endpoints
- Input sanitization (XSS prevention)
- Field length and format validation
- Required field checking
- Type coercion and validation
- Custom error messages
- Security headers application

**Schemas to Test:**
- `registerSchema` - Email format, password complexity
- `loginSchema` - Basic authentication validation
- `createRunSchema` - Numeric validation, date formats
- `updateRunSchema` - Optional field handling
- `createGoalSchema` - Enum validation, date ordering
- `updateGoalSchema` - Partial updates
- `createRaceSchema` - String length limits
- `updateRaceSchema` - Optional fields
- `idParamSchema` - UUID validation
- `statsQuerySchema` - Query parameter validation

### 3. Rate Limiting Middleware (`rateLimiting.ts`)
Located at: `/middleware/rateLimiting.ts`

**Key Testing Areas:**
- Request counting per time window
- Different limits for different endpoint types:
  - Auth endpoints: 5 requests per 15 minutes
  - API endpoints: 100 requests per 15 minutes
  - Create endpoints: 50 requests per 15 minutes
  - Read endpoints: 200 requests per 15 minutes
  - Sensitive operations: 3 requests per hour
  - Global limit: 1000 requests per hour
- Rate limit headers (X-RateLimit-*)
- 429 status responses
- Environment-based configuration
- Custom key generation with user ID

### 4. Error Handler Middleware (`errorHandler.ts`)
Located at: `/middleware/errorHandler.ts`

**Key Testing Areas:**
- Error response formatting
- Status code mapping
- Error categorization (client_error, server_error)
- Stack trace handling (dev vs prod)
- Timestamp inclusion
- Request context preservation
- Custom error types (validation, not found, unauthorized, etc.)

### 5. Async Handler Middleware (`asyncHandler.ts`)
Located at: `/middleware/asyncHandler.ts`

**Key Testing Areas:**
- Promise rejection handling
- Error forwarding to next()
- Context preservation
- Support for AuthRequest type
- Generic type support
- Performance overhead

### 6. ValidateBody Middleware (`validateBody.ts`)
Located at: `/middleware/validateBody.ts`

**Key Testing Areas:**
- Basic validation rules
- Type checking (string, number, boolean, date)
- Min/max constraints
- Required field validation
- Optional field handling
- Multiple validation errors

## Test Implementation Pattern

All middleware tests should follow this structure:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { middlewareName } from '../../../middleware/middlewareName';

describe('MiddlewareName', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    
    // Initialize mocks
    mockReq = {
      headers: {},
      body: {},
      params: {},
      query: {},
    };
    
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    
    mockNext = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  // Test cases...
});
```

## Integration Testing with Supertest

For full integration testing:

```typescript
import request from 'supertest';
import express from 'express';

const app = express();
app.use(express.json());
app.use(middleware);
app.get('/test', (req, res) => res.json({ success: true }));

const response = await request(app)
  .get('/test')
  .set('Authorization', 'Bearer ' + token)
  .expect(200);
```

## Security Testing Checklist

Each middleware should be tested for:

1. **Input Validation Security**
   - SQL injection attempts
   - XSS payloads
   - Command injection
   - Path traversal
   - Unicode normalization

2. **Authentication Security**
   - Token tampering
   - Replay attacks
   - Timing attacks
   - Brute force protection

3. **Rate Limiting Security**
   - Distributed attacks
   - IP spoofing considerations
   - User-based vs IP-based limiting

4. **Error Handling Security**
   - Information disclosure
   - Stack trace exposure
   - Error message sanitization
   - Log injection prevention

5. **Header Security**
   - CORS configuration
   - Content-Type validation
   - Security header presence

## Test Data Management

Use the test database utilities from `/tests/fixtures/testDatabase.ts`:
- `createTestUser()` - Creates test users
- `generateTestToken()` - Generates valid JWT tokens
- `cleanupDatabase()` - Cleans test data

## Environment Configuration

Required environment variables for tests:
- `NODE_ENV=test`
- `JWT_SECRET` (use test value)
- `DATABASE_URL` (test database)
- `RATE_LIMITING_ENABLED=true` (for rate limit tests)

## Running Tests

```bash
# Run all middleware tests
npm run test:integration -- tests/integration/middleware

# Run specific middleware test
npm run test:integration -- tests/integration/middleware/requireAuth.test.ts

# Run with coverage
npm run test:coverage -- tests/integration/middleware
```

## Next Steps

1. Implement individual test files for each middleware
2. Ensure all security scenarios are covered
3. Add performance benchmarks for critical middleware
4. Document any discovered vulnerabilities
5. Create fixtures for common test scenarios

## Notes

- Mock external dependencies (logger, database) to isolate middleware behavior
- Use realistic test data that matches production patterns
- Test both success and failure paths thoroughly
- Consider edge cases and boundary conditions
- Ensure tests are deterministic and don't depend on timing