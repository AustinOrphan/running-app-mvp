# API Error Code Conventions

This document outlines the standardized HTTP status codes and error handling conventions used throughout the running app API.

## Overview

All API endpoints follow consistent error handling patterns using standardized error response utilities and HTTP status codes. The error handler middleware ensures all errors have a consistent response format.

## HTTP Status Code Usage

### 2xx Success

- **200 OK** - Successful GET, PUT requests
- **201 Created** - Successful POST requests that create resources
- **204 No Content** - Successful DELETE requests

### 4xx Client Errors

#### 400 Bad Request - Validation Errors

Use `createValidationError()` for:

- Invalid request data format
- Missing required fields
- Invalid field values (negative numbers, invalid enums)
- Date validation failures

**Examples:**

```typescript
// Missing required fields
throw createValidationError('Missing required fields: title, type, period', 'all');

// Invalid field value
throw createValidationError('Target value must be positive', 'targetValue');
```

#### 401 Unauthorized - Authentication Required

Use `createUnauthorizedError()` for:

- Missing or invalid JWT tokens
- Expired authentication tokens
- Invalid credentials during login

**Examples:**

```typescript
// Missing token
throw createUnauthorizedError('Authentication token required');

// Invalid credentials
throw createUnauthorizedError('Invalid email or password');
```

#### 403 Forbidden - Authorization Failed

Use `createForbiddenError()` for:

- User authenticated but lacks permission to access existing resource
- User trying to access another user's data
- Insufficient role/permissions for admin endpoints

**Examples:**

```typescript
// Resource exists but user doesn't own it
throw createForbiddenError('You do not have permission to access this goal');

// Admin access required
throw createForbiddenError('Admin access required');
```

#### 404 Not Found - Resource Does Not Exist

Use `createNotFoundError()` for:

- Requested resource ID doesn't exist in database
- Endpoint not available in current environment

**Examples:**

```typescript
// Resource not found
throw createNotFoundError('Goal');

// Environment-specific endpoint
throw createNotFoundError('Endpoint not available in production');
```

#### 409 Conflict - Resource Conflict

Use `createConflictError()` for:

- Duplicate resource creation (email already exists)
- Resource state conflicts
- Business logic violations

**Examples:**

```typescript
// Duplicate user registration
throw createConflictError('User with this email already exists');
```

#### 429 Too Many Requests - Rate Limiting

Handled automatically by rate limiting middleware using `createError()` with 429 status code.

### 5xx Server Errors

#### 500 Internal Server Error

Use `createError()` or `createDatabaseError()` for:

- Unexpected server errors
- Database operation failures
- External service failures

**Examples:**

```typescript
// General server error
throw createError('Failed to process request', 500);

// Database error
throw createDatabaseError('Failed to save goal');
```

## Authorization Pattern

All protected endpoints follow this consistent pattern:

### 1. Check Resource Existence First (404)

```typescript
const resource = await prisma.resource.findUnique({ where: { id } });
if (!resource) {
  throw createNotFoundError('Resource');
}
```

### 2. Check Authorization Second (403)

```typescript
if (resource.userId !== req.user!.id) {
  throw createForbiddenError('You do not have permission to access this resource');
}
```

This ensures:

- **404** for non-existent resources (even if user lacks permission)
- **403** only for existing resources the user cannot access

## Error Response Format

All errors return a standardized JSON format via the error handler middleware:

```json
{
  "error": true,
  "message": "Error description",
  "statusCode": 404,
  "category": "client_error",
  "timestamp": "2025-07-26T11:24:00.000Z",
  "path": "/api/goals/invalid-id",
  "method": "GET",
  "errorCode": "NOT_FOUND"
}
```

### Development vs Production

- **Development**: Includes `stack` trace and `details` object
- **Production**: Excludes sensitive debugging information

## Route-Specific Examples

### Goals API (`/api/goals`)

#### GET /api/goals/:id

- **404**: Goal ID doesn't exist
- **403**: Goal exists but belongs to different user
- **401**: No authentication token

#### PUT /api/goals/:id

- **400**: Invalid field values, validation errors
- **404**: Goal ID doesn't exist
- **403**: Goal exists but belongs to different user
- **401**: No authentication token

#### POST /api/goals

- **400**: Missing required fields, validation errors
- **401**: No authentication token

### Runs API (`/api/runs`)

#### GET /api/runs/:id

- **404**: Run ID doesn't exist
- **403**: Run exists but belongs to different user
- **401**: No authentication token

#### DELETE /api/runs/:id

- **404**: Run ID doesn't exist
- **403**: Run exists but belongs to different user
- **401**: No authentication token

### Authentication API (`/api/auth`)

#### POST /api/auth/register

- **400**: Invalid email format, weak password
- **409**: Email already registered

#### POST /api/auth/login

- **401**: Invalid credentials
- **400**: Missing email/password

### Admin API (`/api/audit`)

#### GET /api/audit/events

- **401**: No authentication token
- **403**: User authenticated but not admin
- **400**: Invalid query parameters

## Best Practices

### 1. Use Appropriate Error Utilities

Always use the standardized error creation functions:

- `createValidationError()` for 400 errors
- `createUnauthorizedError()` for 401 errors
- `createForbiddenError()` for 403 errors
- `createNotFoundError()` for 404 errors
- `createConflictError()` for 409 errors
- `createError()` for general errors

### 2. Follow the Authorization Pattern

Always check existence before authorization to ensure proper status codes.

### 3. Provide Meaningful Error Messages

```typescript
// Good - specific and actionable
throw createValidationError('End date must be after start date', 'endDate');

// Bad - vague and unhelpful
throw createValidationError('Invalid date');
```

### 4. Include Field Information for Validation Errors

When possible, specify which field caused the validation error for better client handling.

### 5. Never Expose Sensitive Information

Error messages should be safe to display to end users and not reveal internal system details.

## Testing Error Scenarios

### Test Structure

Each endpoint should have tests for:

- Success cases (2xx)
- Validation errors (400)
- Authentication errors (401)
- Authorization errors (403)
- Not found errors (404)
- Server errors (500)

### Example Test Cases

```typescript
describe('GET /api/goals/:id', () => {
  it('returns 404 for non-existent goal', async () => {
    await request(app)
      .get('/api/goals/non-existent-id')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(404);
  });

  it('returns 403 for goal owned by different user', async () => {
    const otherUserGoal = await createGoalForUser(otherUserId);
    await request(app)
      .get(`/api/goals/${otherUserGoal.id}`)
      .set('Authorization', `Bearer ${validToken}`)
      .expect(403);
  });

  it('returns 401 for missing authentication', async () => {
    await request(app).get(`/api/goals/${goalId}`).expect(401);
  });
});
```

## Error Handler Implementation

The error handling is centralized in `/server/middleware/errorHandler.ts`:

- **errorHandler**: Main middleware that formats all errors consistently
- **Error creation utilities**: Functions that create properly formatted error objects
- **Logging**: All errors are logged with appropriate detail levels
- **Environment awareness**: Different information exposed in dev vs production

This ensures consistent error responses across all API endpoints while maintaining security and providing useful debugging information during development.
