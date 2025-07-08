# Logging Standards and Guidelines

## Overview

This document outlines the standardized logging practices for the running app MVP to ensure consistent error handling, improved debugging capabilities, and operational observability.

## Structured Logging Format

All logs follow a structured format with the following fields:

```typescript
{
  timestamp: string;           // ISO 8601 timestamp
  level: 'error' | 'warn' | 'info' | 'debug';
  correlationId: string;       // UUID for request tracing
  component: string;           // Component identifier
  operation: string;           // Specific operation being performed
  error?: {
    message: string;
    stack?: string;            // Only in development
    code?: string;
    type: string;              // Error categorization
  };
  context?: Record<string, unknown>; // Additional context
}
```

## Components

Use these standardized component names:

- `auth` - Authentication and authorization
- `runs` - Run management operations
- `stats` - Statistics and analytics
- `goals` - Goal management
- `races` - Race management
- `server` - Server-level operations
- `middleware` - Middleware operations
- `database` - Database operations

## Error Types

Errors are automatically categorized into these types:

- `ValidationError` - Input validation failures
- `DatabaseError` - Database operation failures
- `AuthenticationError` - Authentication failures
- `AuthorizationError` - Authorization/permission failures
- `NotFoundError` - Resource not found
- `ConflictError` - Resource conflicts (e.g., duplicate entries)
- `ExternalServiceError` - External API/service failures
- `ConfigurationError` - Configuration/environment issues
- `NetworkError` - Network-related failures
- `UnknownError` - Unclassified errors

## Usage Examples

### Basic Error Logging

```typescript
import { logError } from '../utils/logger.js';

try {
  // Operation that might fail
} catch (error) {
  logError(
    'runs',                    // component
    'create-run',              // operation
    error,                     // error object
    req,                       // request (optional)
    { userId: req.user?.id }   // additional context (optional)
  );
  // Handle error response
}
```

### Authentication Logging

```typescript
import { logAuth } from '../utils/logger.js';

// Success
logAuth('login', req, undefined, { email: user.email });

// Failure
logAuth('login', req, error, { attemptedEmail: email });
```

### Database Operation Logging

```typescript
import { logDatabase } from '../utils/logger.js';

// Success
logDatabase('create-user', req, undefined, { operation: 'INSERT' });

// Failure
logDatabase('create-user', req, error, { table: 'users' });
```

### Warning and Info Logging

```typescript
import { logWarn, logInfo } from '../utils/logger.js';

logWarn('auth', 'token-expiry', 'Token expiring soon', req, { 
  expiresIn: '1 hour' 
});

logInfo('runs', 'batch-process', 'Processing runs batch', req, { 
  batchSize: 100 
});
```

## Request Correlation

All requests are automatically assigned a correlation ID for tracing through the system:

```typescript
// Correlation ID is automatically added to req.correlationId
console.log(`Processing request ${req.correlationId}`);
```

## Data Privacy and Security

The logging system automatically:

- **Redacts sensitive data**: Passwords, tokens, emails, etc.
- **Masks PII**: Phone numbers, credit cards, SSNs
- **Hashes user IDs**: In production for privacy compliance
- **Masks IP addresses**: For enhanced privacy

### Sensitive Field Detection

Fields containing these terms are automatically redacted:
- `password`, `token`, `secret`, `key`
- `email`, `phone`, `address`, `name`
- `authorization`, `ssn`, `creditcard`

## Best Practices

### DO:
- ✅ Always capture error objects in catch blocks
- ✅ Provide meaningful operation names
- ✅ Include relevant context without sensitive data
- ✅ Use appropriate log levels
- ✅ Log successful critical operations (auth, payments)

### DON'T:
- ❌ Log sensitive information directly
- ❌ Use generic error messages
- ❌ Ignore errors (empty catch blocks)
- ❌ Log overly verbose information in production
- ❌ Mix logging levels inappropriately

## Implementation Checklist

When implementing logging in new code:

- [ ] Import appropriate logging functions
- [ ] Use correct component and operation names
- [ ] Capture all error objects in catch blocks
- [ ] Include relevant context without sensitive data
- [ ] Test logging output in development
- [ ] Verify sensitive data is redacted

## Environment Configuration

### Development
- Full error stacks included
- User IDs logged directly
- IP addresses not masked
- Debug logs enabled

### Production
- Error stacks excluded
- User IDs hashed
- IP addresses hashed
- Debug logs disabled
- Sensitive data automatically redacted

## Monitoring and Alerting

The structured logging format enables:

- **Error rate monitoring**: Track errors by component/operation
- **Performance monitoring**: Log operation durations
- **Security monitoring**: Track authentication failures
- **Business metrics**: Track user actions and system usage

## Migration Guide

When updating existing code:

1. Replace existing error logging with new structured format
2. Ensure all catch blocks capture error parameters
3. Add correlation ID support where needed
4. Test logging output in development environment

## Examples in Codebase

See these files for reference implementations:

- `middleware/requireAuth.ts` - Authentication logging
- `middleware/errorHandler.ts` - Central error handling
- `server.ts` - Server-level logging
- `utils/logger.ts` - Core logging utilities

## Troubleshooting

### Common Issues

**Missing correlation IDs**: Ensure `correlationMiddleware()` is added to Express app

**Sensitive data in logs**: Check field names against sensitive field list

**Missing error context**: Verify error objects are passed to logging functions

**Log format issues**: Ensure using structured logging functions, not console methods

For additional support, refer to the secure logging utility documentation in `utils/secureLogger.ts`.