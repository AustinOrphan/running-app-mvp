# Error Handling Guidelines

## Overview

This document provides comprehensive guidelines for implementing consistent, secure, and user-friendly error handling across the Running App MVP API.

## Table of Contents

1. [General Principles](#general-principles)
2. [Error Types and Status Codes](#error-types-and-status-codes)
3. [Error Response Format](#error-response-format)
4. [Implementation Patterns](#implementation-patterns)
5. [Database Error Handling](#database-error-handling)
6. [Security Considerations](#security-considerations)
7. [Testing Error Scenarios](#testing-error-scenarios)
8. [Examples](#examples)

## General Principles

### 1. **Consistency**
- Use standardized error response formats across all endpoints
- Apply consistent HTTP status codes for similar error scenarios
- Use the same error handling patterns throughout the codebase

### 2. **Security**
- Never expose sensitive information in error messages
- Log detailed error information securely for debugging
- Provide user-friendly messages without revealing system internals

### 3. **User Experience**
- Provide clear, actionable error messages
- Include relevant context when possible (e.g., field names for validation errors)
- Use appropriate HTTP status codes for client handling

### 4. **Maintainability**
- Use centralized error handling utilities
- Follow established patterns for easy debugging
- Document error scenarios and their handling

## Error Types and Status Codes

### **4xx Client Errors**

| Status Code | Error Type | When to Use | Example |
|-------------|------------|-------------|---------|
| 400 | Bad Request | Invalid request format, validation failures | Invalid date format, missing required fields |
| 401 | Unauthorized | Authentication failures | Invalid credentials, expired tokens |
| 403 | Forbidden | Authorization failures | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist | User not found, run not found |
| 409 | Conflict | Resource conflicts | Email already exists, duplicate data |
| 422 | Unprocessable Entity | Valid request format but logical errors | End date before start date |
| 429 | Too Many Requests | Rate limiting triggered | API rate limit exceeded |

### **5xx Server Errors**

| Status Code | Error Type | When to Use | Example |
|-------------|------------|-------------|---------|
| 500 | Internal Server Error | Unexpected server errors | Database connection failures, unhandled exceptions |
| 502 | Bad Gateway | External service failures | Payment gateway errors |
| 503 | Service Unavailable | Temporary service issues | Database maintenance, overload |
| 504 | Gateway Timeout | External service timeouts | Slow external API responses |

## Error Response Format

### **Standard Error Response Structure**

```typescript
{
  "error": true,
  "message": "User-friendly error description",
  "statusCode": 404,
  "category": "client_error",
  "timestamp": "2025-06-29T18:26:37.000Z",
  "path": "/api/runs/invalid-id",
  "method": "GET",
  "errorCode": "NOT_FOUND",       // Optional: specific error identifier
  "field": "userId",              // Optional: for validation errors
  "details": {                    // Optional: additional context (dev only)
    "validationErrors": [...]
  }
}
```

### **Success Response Structure (for contrast)**

```typescript
{
  "data": [...],                  // Actual response data
  "message": "Operation successful", // Optional success message
  "metadata": {                   // Optional metadata
    "totalCount": 42,
    "page": 1
  }
}
```

## Implementation Patterns

### **1. Route Handler Pattern**

```typescript
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { createNotFoundError, createValidationError } from '../middleware/errorHandler.js';

router.get('/:id', requireAuth, asyncAuthHandler(async (req: AuthRequest, res, next) => {
  // Validate input
  if (!req.params.id) {
    return next(createValidationError('ID parameter is required', 'id'));
  }

  // Database operation with error handling
  const resource = await prisma.resource.findFirst({
    where: { id: req.params.id, userId: req.user!.id }
  });

  if (!resource) {
    return next(createNotFoundError('Resource'));
  }

  res.json(resource);
}));
```

### **2. Always Use Async Handlers**

```typescript
// ✅ Correct - Catches async errors automatically
router.post('/', asyncAuthHandler(async (req, res, next) => {
  // Async operation
}));

// ❌ Incorrect - Async errors not caught
router.post('/', async (req, res, next) => {
  // Async operation - errors will crash server
});
```

### **3. Consistent Error Propagation**

```typescript
// ✅ Correct - Stops execution
if (validationFails) {
  return next(createValidationError('Invalid data', 'field'));
}

// ❌ Incorrect - Continues execution
if (validationFails) {
  next(createValidationError('Invalid data', 'field'));
  // Code continues to run!
}
```

### **4. Input Sanitization**

```typescript
// Apply to all routes in a router
router.use(sanitizeInput);

// Individual route validation
router.post('/', validateCreateData, asyncAuthHandler(async (req, res, next) => {
  // Data is already validated and sanitized
}));
```

## Database Error Handling

### **Using Database Error Handler**

```typescript
import { withDatabaseErrorHandling } from '../utils/databaseErrorHandler.js';

// Automatic Prisma error handling
const user = await withDatabaseErrorHandling(
  () => prisma.user.create({ data: userData }),
  'Creating user'
);

// Manual error handling for complex operations
try {
  const result = await prisma.complexOperation();
} catch (error) {
  const dbError = handleDatabaseError(error, 'Complex operation');
  return next(dbError);
}
```

### **Common Database Error Scenarios**

| Prisma Error Code | Meaning | Our Error Type |
|-------------------|---------|----------------|
| P2002 | Unique constraint violation | ConflictError (409) |
| P2025 | Record not found | NotFoundError (404) |
| P2003 | Foreign key constraint | ValidationError (400) |
| P1008 | Connection timeout | DatabaseError (500) |
| P1001 | Connection failed | DatabaseError (500) |

## Security Considerations

### **1. Information Disclosure Prevention**

```typescript
// ✅ Safe - No sensitive information
return next(createUnauthorizedError('Invalid credentials'));

// ❌ Dangerous - Reveals user existence
return next(createError('User john@example.com not found', 404));
```

### **2. Error Logging vs. Response**

```typescript
// Log detailed error information
secureLogger.error('Authentication failed', req, error, {
  email: req.body.email,
  ipAddress: req.ip,
  userAgent: req.get('User-Agent')
});

// Return generic error to client
return next(createUnauthorizedError('Invalid credentials'));
```

### **3. Development vs. Production**

```typescript
// Stack traces only in development
const errorResponse = {
  error: true,
  message: err.message,
  statusCode,
  ...(process.env.NODE_ENV === 'development' && { 
    stack: err.stack,
    details: err.details 
  })
};
```

## Testing Error Scenarios

### **1. Unit Tests for Error Conditions**

```typescript
describe('GET /api/runs/:id', () => {
  it('should return 404 for non-existent run', async () => {
    const response = await request(app)
      .get('/api/runs/invalid-id')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body.error).toBe(true);
    expect(response.body.errorCode).toBe('NOT_FOUND');
    expect(response.body.message).toBe('Run not found');
  });

  it('should return 401 for unauthenticated request', async () => {
    const response = await request(app)
      .get('/api/runs/123')
      .expect(401);

    expect(response.body.errorCode).toBe('UNAUTHORIZED');
  });
});
```

### **2. Integration Tests for Error Flows**

```typescript
describe('Error handling integration', () => {
  it('should handle database connection errors gracefully', async () => {
    // Simulate database failure
    await prisma.$disconnect();
    
    const response = await request(app)
      .get('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);

    expect(response.body.category).toBe('server_error');
    expect(response.body.errorCode).toBe('DATABASE_ERROR');
  });
});
```

## Examples

### **1. Validation Error**

```typescript
// Request: POST /api/goals with invalid data
{
  "error": true,
  "message": "Target value must be positive",
  "statusCode": 400,
  "category": "client_error",
  "timestamp": "2025-06-29T18:26:37.000Z",
  "path": "/api/goals",
  "method": "POST",
  "errorCode": "VALIDATION_ERROR",
  "field": "targetValue"
}
```

### **2. Not Found Error**

```typescript
// Request: GET /api/runs/invalid-id
{
  "error": true,
  "message": "Run not found",
  "statusCode": 404,
  "category": "client_error",
  "timestamp": "2025-06-29T18:26:37.000Z",
  "path": "/api/runs/invalid-id",
  "method": "GET",
  "errorCode": "NOT_FOUND"
}
```

### **3. Authentication Error**

```typescript
// Request: POST /api/auth/login with wrong password
{
  "error": true,
  "message": "Invalid credentials",
  "statusCode": 401,
  "category": "client_error",
  "timestamp": "2025-06-29T18:26:37.000Z",
  "path": "/api/auth/login",
  "method": "POST",
  "errorCode": "UNAUTHORIZED"
}
```

### **4. Database Error**

```typescript
// Database connection failure
{
  "error": true,
  "message": "Database connection failed",
  "statusCode": 500,
  "category": "server_error",
  "timestamp": "2025-06-29T18:26:37.000Z",
  "path": "/api/runs",
  "method": "GET",
  "errorCode": "DATABASE_ERROR"
}
```

## Available Error Creation Functions

### **createError(message, statusCode)**
Generic error creation for any status code.

### **createValidationError(message, field?, details?)**
Validation errors (400) with optional field information.

### **createNotFoundError(resource?)**
Resource not found errors (404).

### **createUnauthorizedError(message?)**
Authentication failures (401).

### **createForbiddenError(message?)**
Authorization failures (403).

### **createConflictError(message, details?)**
Resource conflicts (409).

### **createDatabaseError(message?, details?)**
Database operation failures (500).

## Best Practices Checklist

- [ ] All async routes use `asyncHandler` or `asyncAuthHandler`
- [ ] All error propagation uses `return next(error)`
- [ ] Input sanitization middleware applied
- [ ] Appropriate error types used (validation, not found, etc.)
- [ ] No sensitive information in error messages
- [ ] Consistent HTTP status codes
- [ ] Error scenarios covered in tests
- [ ] Database errors handled appropriately
- [ ] Rate limiting implemented where needed
- [ ] Secure logging of error details

## Migration from Old Patterns

### **Before (Issues #25, #34)**
```typescript
// ❌ Problematic patterns
throw createError('Error', 500);        // Could crash server
next(createError('Error', 500));        // Continued execution
```

### **After (Current Standard)**
```typescript
// ✅ Correct patterns
return next(createValidationError('Invalid data', 'field'));
return next(createNotFoundError('Resource'));
return next(createDatabaseError('Operation failed'));
```

---

**Last Updated**: June 29, 2025  
**Version**: 1.0  
**Related Issues**: #17, #25, #34