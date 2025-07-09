# Error Handling Documentation

> **Consolidated**: This document consolidates all error handling documentation  
> **Updated**: 2025-01-09  
> **Status**: Active

## Table of Contents

1. [Critical Patterns](#critical-patterns)
2. [Guidelines & Best Practices](#guidelines--best-practices)
3. [Implementation Summary](#implementation-summary)
4. [Audit Results](#audit-results)
5. [Examples & Testing](#examples--testing)

## Critical Patterns

### 🚨 MUST Follow - Always Use `return next(error)`

This is the most critical pattern to prevent server crashes and "Cannot set headers after they are sent" errors.

#### ❌ DANGEROUS - Never do this:
```typescript
catch (error) {
  next(createError('Operation failed', 500));
  // Code execution continues here - DANGEROUS!
}
```

#### ✅ SAFE - Always do this:
```typescript
catch (error) {
  return next(createError('Operation failed', 500));
  // Code execution stops immediately - SAFE!
}
```

### 🛡️ Why This Matters

1. **Prevents Double Headers**: Without `return`, code execution continues after error handling
2. **Server Stability**: Improper error handling can crash the entire Express server
3. **Consistent Behavior**: Ensures predictable error response patterns

## Guidelines & Best Practices

### General Principles

#### 1. **Consistency**
- Use standardized error response formats across all endpoints
- Apply consistent HTTP status codes for similar error scenarios
- Use the same error handling patterns throughout the codebase

#### 2. **Security**
- Never expose sensitive information in error messages
- Log detailed error information securely for debugging
- Provide user-friendly messages without revealing system internals

#### 3. **User Experience**
- Provide clear, actionable error messages
- Include helpful context where appropriate
- Maintain consistent error response structure

### Error Types and Status Codes

| Error Type | Status Code | Use Case |
|------------|-------------|----------|
| ValidationError | 400 | Invalid request data |
| UnauthorizedError | 401 | Missing or invalid authentication |
| ForbiddenError | 403 | Insufficient permissions |
| NotFoundError | 404 | Resource not found |
| ConflictError | 409 | Resource already exists |
| InternalServerError | 500 | Unexpected server errors |

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
    timestamp: string;
    path: string;
    details?: any;
  };
}
```

### Implementation Patterns

#### Basic Route Handler Pattern:
```typescript
router.get('/example', async (req, res, next) => {
  try {
    const data = await someAsyncOperation();
    res.json(data);
  } catch (error) {
    return next(createError('Operation failed', 500));
  }
});
```

#### Database Error Handling:
```typescript
router.post('/users', async (req, res, next) => {
  try {
    const user = await prisma.user.create({
      data: req.body
    });
    res.status(201).json(user);
  } catch (error) {
    if (error.code === 'P2002') {
      return next(createError('User already exists', 409));
    }
    return next(createError('Failed to create user', 500));
  }
});
```

#### Validation Error Handling:
```typescript
router.post('/validate', async (req, res, next) => {
  try {
    const validatedData = schema.parse(req.body);
    // Process validated data
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Validation failed', 400, error.errors));
    }
    return next(createError('Validation error', 500));
  }
});
```

## Implementation Summary

### Current Status
- **Error Handler Middleware**: ✅ Implemented in `middleware/errorHandler.ts`
- **Route Handlers**: ✅ Most routes follow proper patterns
- **Database Errors**: ✅ Handled with appropriate status codes
- **Validation**: ✅ Zod integration for request validation
- **Logging**: ✅ Structured error logging implemented

### Key Components

1. **Error Handler Middleware** (`middleware/errorHandler.ts`)
   - Centralized error processing
   - Consistent response formatting
   - Security-conscious error messages

2. **Database Error Handler** (`utils/databaseErrorHandler.ts`)
   - Prisma error code mapping
   - User-friendly error messages
   - Proper status code assignment

3. **Validation Middleware** (`middleware/validateBody.ts`)
   - Zod schema validation
   - Detailed validation error reporting
   - Request body sanitization

## Audit Results

### ✅ Compliant Routes
- `/api/auth/*` - All authentication routes
- `/api/goals/*` - Goal management endpoints
- `/api/races/*` - Race management endpoints
- `/api/runs/*` - Run tracking endpoints
- `/api/stats/*` - Statistics endpoints

### 🔧 Improvements Made
- Added `return` statements to all error handlers
- Implemented consistent error response format
- Added proper status code mapping for database errors
- Enhanced security by sanitizing error messages

### 📊 Metrics
- **Total Routes Audited**: 23
- **Compliant Routes**: 23 (100%)
- **Security Issues Fixed**: 0 (already secure)
- **Consistency Issues Fixed**: 3

## Examples & Testing

### Testing Error Scenarios

#### 1. Validation Errors
```typescript
describe('Validation Error Handling', () => {
  it('should return 400 for invalid data', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ email: 'invalid-email' });
    
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('Validation failed');
  });
});
```

#### 2. Database Errors
```typescript
describe('Database Error Handling', () => {
  it('should handle duplicate key errors', async () => {
    // Create user first
    await request(app)
      .post('/api/users')
      .send({ email: 'test@example.com' });
    
    // Try to create duplicate
    const response = await request(app)
      .post('/api/users')
      .send({ email: 'test@example.com' });
    
    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe('User already exists');
  });
});
```

#### 3. Authentication Errors
```typescript
describe('Authentication Error Handling', () => {
  it('should return 401 for missing token', async () => {
    const response = await request(app)
      .get('/api/protected-route');
    
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Authentication required');
  });
});
```

### Common Error Scenarios

#### 1. File Not Found
```typescript
router.get('/files/:id', async (req, res, next) => {
  try {
    const file = await findFileById(req.params.id);
    if (!file) {
      return next(createError('File not found', 404));
    }
    res.json(file);
  } catch (error) {
    return next(createError('Failed to retrieve file', 500));
  }
});
```

#### 2. Permission Denied
```typescript
router.delete('/admin/:id', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return next(createError('Insufficient permissions', 403));
    }
    await deleteResource(req.params.id);
    res.status(204).send();
  } catch (error) {
    return next(createError('Failed to delete resource', 500));
  }
});
```

#### 3. Rate Limiting
```typescript
router.post('/api/send-email', rateLimit, async (req, res, next) => {
  try {
    await sendEmail(req.body);
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      return next(createError('Too many requests', 429));
    }
    return next(createError('Failed to send email', 500));
  }
});
```

## Best Practices Checklist

### For All Route Handlers:
- [ ] Use `return next(error)` in ALL catch blocks
- [ ] Use `return next(createError(...))` for custom errors
- [ ] Ensure no code executes after error handling
- [ ] Verify async functions are properly wrapped or use try/catch
- [ ] Log errors appropriately for debugging
- [ ] Provide user-friendly error messages
- [ ] Use appropriate HTTP status codes

### For Database Operations:
- [ ] Handle specific Prisma error codes
- [ ] Map database errors to appropriate HTTP status codes
- [ ] Sanitize error messages for security
- [ ] Log detailed error information for debugging

### For API Endpoints:
- [ ] Validate request data with Zod or similar
- [ ] Handle authentication and authorization errors
- [ ] Implement rate limiting where appropriate
- [ ] Provide consistent error response format
- [ ] Include helpful context in error messages

## Related Files

- `middleware/errorHandler.ts` - Main error handling middleware
- `utils/databaseErrorHandler.ts` - Database error processing
- `middleware/validateBody.ts` - Request validation
- `tests/integration/errorHandling.test.ts` - Error handling tests

## Migration from Previous Docs

This document consolidates the following previous documentation:
- `ERROR_HANDLING_STANDARDS.md` - Critical patterns and standards
- `docs/ERROR_HANDLING_GUIDELINES.md` - Implementation guidelines
- `docs/ERROR_HANDLING_IMPLEMENTATION_SUMMARY.md` - Current implementation status
- `docs/ERROR_HANDLING_AUDIT.md` - Audit results and metrics

---

**Last Updated**: 2025-01-09  
**Maintained By**: Development Team  
**Next Review**: 2025-02-09