# Middleware Testing Guide

This directory contains comprehensive tests for all middleware functions used in the backend. Due to security restrictions in the testing environment, some test files may need to be created manually.

## Test Coverage Requirements

### 1. Authentication Middleware (requireAuth.test.ts)

- Valid JWT token processing
- Invalid token rejection (malformed, wrong signature)
- Missing token handling
- Expired token handling
- JWT secret configuration errors
- Edge cases (extra spaces, case sensitivity, long tokens)
- Error handling for unexpected errors

### 2. Validation Middleware (validation.test.ts)

- Input validation using Zod schemas
- Email validation and normalization
- Password complexity requirements
- Field length limits
- Required field checking
- Type validation (strings, numbers, dates, enums)
- Input sanitization (XSS prevention)
- Security headers application
- Multiple validation errors
- Edge cases (empty values, special characters)

### 3. Rate Limiting Middleware (rateLimiting.test.ts)

- Request counting and throttling
- Different limits for different endpoints
- Rate limit header inclusion
- 429 status code responses
- Time window reset functionality
- Environment-based configuration
- Custom key generation with user ID
- Concurrent request handling

### 4. Error Handling Middleware (errorHandler.test.ts)

- Error response formatting
- Status code mapping
- Error message sanitization
- Stack trace handling (dev vs prod)
- Logging integration
- Error categorization
- Default values for missing properties
- Security considerations

### 5. Async Handler Middleware (asyncHandler.test.ts)

- Promise rejection catching
- Error forwarding to error handler
- Next() function calling
- Request/response context preservation
- Support for custom request types
- Handling of non-Error objects
- Performance considerations

### 6. ValidateBody Middleware (validateBody.test.ts)

- Required field validation
- Type validation (string, number, boolean, date)
- Length/value constraints (min/max)
- Optional field handling
- Multiple validation errors
- Edge cases (null, undefined, empty strings)

## Test Patterns

All middleware tests should follow these patterns:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';

describe('Middleware Name', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = { /* setup */ };
    mockRes = { /* setup */ };
    mockNext = vi.fn();
  });

  // Test cases...
});
```

## Security Testing Focus

Each middleware test should include security-focused test cases:

1. **Input Validation**: Test malicious inputs, SQL injection attempts, XSS payloads
2. **Authentication**: Test token manipulation, expired tokens, missing secrets
3. **Rate Limiting**: Test bypass attempts, distributed attacks
4. **Error Handling**: Ensure no sensitive information leakage
5. **Headers**: Verify security headers are properly set

## Integration Testing

For comprehensive integration testing, use Supertest with Express:

```typescript
import request from 'supertest';
import express from 'express';

const app = express();
app.use(middleware);
app.get('/test', (req, res) => res.json({ success: true }));

const response = await request(app).get('/test');
```

## Running Tests

```bash
npm run test:integration -- tests/integration/middleware
```

## Environment Configuration

Tests should handle environment variables properly:

- Use test-specific JWT secrets
- Enable rate limiting explicitly in tests
- Set NODE_ENV=test
- Clean up environment after tests

## Mocking External Dependencies

Mock external dependencies to isolate middleware behavior:
- Mock loggers to prevent actual logging
- Mock database calls if middleware interacts with DB
- Mock time-based functions for rate limiting tests
