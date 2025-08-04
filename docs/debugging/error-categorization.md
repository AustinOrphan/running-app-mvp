# Error Categorization System

This document describes the error categorization and reporting system implemented in the Running App MVP, designed to help developers debug issues effectively while maintaining user privacy.

## Overview

The error reporting system categorizes errors into distinct types, aggregates similar errors to prevent spam, and sanitizes sensitive data before logging. This provides actionable insights for debugging while protecting user information.

## Error Categories

### 1. API Errors

- **Category**: `ErrorCategory.API`
- **Description**: Server-side errors from API calls
- **Examples**:
  - 500 Internal Server Error
  - 503 Service Unavailable
  - API response parsing failures
- **Key Information Captured**:
  - URL
  - HTTP method
  - Status code
  - Response data (sanitized)

### 2. UI Errors

- **Category**: `ErrorCategory.UI`
- **Description**: Client-side React component errors
- **Examples**:
  - Component render errors
  - Event handler exceptions
  - State update errors
- **Key Information Captured**:
  - Component name
  - Error boundary context
  - Component stack trace
  - User action that triggered error

### 3. Network Errors

- **Category**: `ErrorCategory.NETWORK`
- **Description**: Network connectivity issues
- **Examples**:
  - Request timeouts
  - DNS resolution failures
  - Connection refused
- **Key Information Captured**:
  - URL
  - Retry attempt number
  - Network timing information

### 4. Authentication Errors

- **Category**: `ErrorCategory.AUTH`
- **Description**: Authentication and authorization failures
- **Examples**:
  - 401 Unauthorized
  - Token expiration
  - Invalid credentials
- **Key Information Captured**:
  - Authentication method
  - Token type (access/refresh)
  - Expiration status

### 5. Validation Errors

- **Category**: `ErrorCategory.VALIDATION`
- **Description**: Input validation failures
- **Examples**:
  - Form field validation
  - Data type mismatches
  - Required field missing
- **Key Information Captured**:
  - Field name
  - Validation rule violated
  - Submitted value (redacted if sensitive)

### 6. Unknown Errors

- **Category**: `ErrorCategory.UNKNOWN`
- **Description**: Uncategorized errors
- **Default category for unexpected errors**

## Error Reporting Functions

### reportApiError

```typescript
reportApiError(
  error: Error,
  endpoint: string,
  method: string,
  statusCode?: number
): void
```

### reportUIError

```typescript
reportUIError(
  error: Error,
  componentName: string,
  action?: string
): void
```

### reportNetworkError

```typescript
reportNetworkError(
  error: Error,
  url: string,
  attempt?: number
): void
```

### reportAuthError

```typescript
reportAuthError(
  error: Error,
  action: string
): void
```

### reportValidationError

```typescript
reportValidationError(
  error: Error,
  field: string,
  value?: unknown
): void
```

## Error Aggregation

The system prevents error spam through intelligent aggregation:

### Aggregation Rules

- Errors with same key are grouped
- Window: 5 minutes (configurable)
- Threshold: 10 occurrences (configurable)
- After threshold: Single aggregated report

### Error Key Generation

```typescript
const key = `${category}-${message}-${stack?.split('\n')[0]}`;
```

### Aggregated Error Format

```typescript
{
  category: ErrorCategory,
  message: string,
  count: number,
  firstSeen: Date,
  lastSeen: Date,
  sample: Error // First occurrence
}
```

## PII Protection

### Automatic Redaction

The system automatically redacts sensitive patterns:

- Email addresses → `[REDACTED_EMAIL]`
- Phone numbers → `[REDACTED_PHONE]`
- Credit cards → `[REDACTED_CARD]`
- SSNs → `[REDACTED_SSN]`
- API keys → `[REDACTED_API_KEY]`
- Passwords → `[REDACTED_PASSWORD]`
- Authentication tokens → `[REDACTED_TOKEN]`

### Deep Object Sanitization

```typescript
function redactSensitiveData(data: unknown): unknown {
  // Recursively sanitizes objects and arrays
  // Handles circular references
  // Preserves data structure
}
```

## Client Logger Integration

The error reporting system integrates with the secure client logger:

### Log Levels

- `error`: Critical errors requiring immediate attention
- `warn`: Non-critical issues or recovered errors
- `info`: Important application events
- `debug`: Detailed debugging information

### Secure Logging

```typescript
clientLogger.error('API request failed', error, {
  url: '/api/users',
  method: 'GET',
  userId: hash(user.id), // PII hashed
});
```

## Error Boundaries

React error boundaries integrate with the error reporting system:

```typescript
export class ErrorBoundary extends Component {
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    reportUIError(error, errorInfo.componentStack || 'Unknown', 'componentDidCatch');
  }
}
```

## useErrorHandler Hook

Custom hook for component-level error handling:

```typescript
const { handleError, handleValidationError, handleAsyncError } = useErrorHandler('ComponentName');

// Usage
try {
  await someAsyncOperation();
} catch (error) {
  handleError(error as Error, 'someAsyncOperation');
}
```

## Debugging Workflow

### 1. Error Occurrence

- Error thrown in application
- Caught by error boundary or try/catch
- Categorized based on error type

### 2. Error Processing

- Sensitive data redacted
- Error aggregation checked
- Context information added

### 3. Error Logging

- Logged with appropriate level
- Stored in browser console
- Can be sent to monitoring service

### 4. Developer Analysis

- Filter by category in console
- Review error patterns
- Identify root causes

## Console Filtering

Use browser console filters to focus on specific error types:

```javascript
// Show only API errors
console.log('%c[API]', 'color: red', ...);

// Show only UI errors
console.log('%c[UI]', 'color: orange', ...);

// Show only auth errors
console.log('%c[AUTH]', 'color: yellow', ...);
```

## Integration with Monitoring Services

The system is designed to integrate with external monitoring:

```typescript
// Example: Sentry integration
window.addEventListener('clientError', event => {
  Sentry.captureException(event.detail.error, {
    tags: {
      category: event.detail.category,
      component: event.detail.component,
    },
    extra: event.detail.context,
  });
});
```

## Configuration

### Environment Variables

```bash
# Error reporting configuration
ERROR_AGGREGATION_WINDOW=300000  # 5 minutes
ERROR_AGGREGATION_THRESHOLD=10   # Max errors before aggregation
ERROR_LOG_LEVEL=error            # Minimum level to log
```

### Runtime Configuration

```typescript
errorReporting.configure({
  aggregationWindow: 5 * 60 * 1000,
  maxAggregatedErrors: 10,
  enabledCategories: ['API', 'AUTH', 'UI'],
  redactPatterns: [/custom-pattern/g],
});
```

## Best Practices

### 1. Categorize Errors Appropriately

```typescript
// Good
if (response.status === 401) {
  reportAuthError(error, 'token_refresh');
}

// Avoid
reportError(error); // No category
```

### 2. Provide Context

```typescript
// Good
reportApiError(error, '/api/runs', 'POST', response.status);

// Avoid
reportApiError(error, '', '', undefined);
```

### 3. Handle Async Errors

```typescript
// Good
const result = await handleAsyncError(() => fetchUserData(), 'fetchUserData');

// Avoid
fetchUserData().catch(console.error);
```

### 4. Use Error Boundaries

```typescript
// Wrap feature components
<ErrorBoundary fallback={<ErrorFallback />}>
  <FeatureComponent />
</ErrorBoundary>
```

## Testing Error Handling

### Unit Tests

```typescript
it('should report API errors correctly', () => {
  const error = new Error('Server error');
  reportApiError(error, '/api/test', 'GET', 500);

  expect(clientLogger.error).toHaveBeenCalledWith(
    'API error',
    error,
    expect.objectContaining({
      endpoint: '/api/test',
      method: 'GET',
      statusCode: 500,
    })
  );
});
```

### Integration Tests

See `tests/integration/error-handling.test.ts` for comprehensive tests.

## Troubleshooting

### Common Issues

1. **Errors not appearing in console**
   - Check log level configuration
   - Ensure error reporting is enabled
   - Verify error category is enabled

2. **Too many duplicate errors**
   - Adjust aggregation threshold
   - Review error key generation
   - Check aggregation window

3. **Sensitive data in logs**
   - Add patterns to redaction list
   - Review sanitization logic
   - Check all error contexts

4. **Missing error context**
   - Ensure all error handlers provide context
   - Review error boundary implementation
   - Check async error handling
