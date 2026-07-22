# @AustinOrphan/errors

Standardized error handling for Node.js/TypeScript backend services following the error contract specification.

## Installation

```bash
npm install @AustinOrphan/errors
```

## Features

- Standardized error classes with HTTP status codes
- Factory functions for common error scenarios
- Express and Fastify adapter middleware
- Type-safe error responses
- Development/production mode support (stack traces and details)
- Full TypeScript support

## Error Classes

- **StandardError** - Base error class
- **NotFoundError** (404) - Resource not found
- **ValidationError** (400) - Input validation failure
- **AuthenticationError** (401) - Authentication required
- **AuthorizationError** (403) - Permission denied
- **ConflictError** (409) - Resource conflict
- **DatabaseError** (500) - Database operation failure

## Usage

### Basic Error Creation

```typescript
import {
  NotFoundError,
  ValidationError,
  createNotFoundError,
  createValidationError,
} from "@AustinOrphan/errors";

// Direct instantiation
throw new NotFoundError("User not found");

// Using factory functions
throw createNotFoundError("User", "123");
// Results in: "User with id '123' not found"

throw createValidationError("email", "Email address is invalid");
```

### Express Integration

```typescript
import express from "express";
import { createExpressErrorHandler } from "@AustinOrphan/errors";

const app = express();

// Your routes here
app.get("/users/:id", (req, res) => {
  throw createNotFoundError("User", req.params.id);
});

// Add error handler as the last middleware
app.use(
  createExpressErrorHandler({
    includeStack: process.env.NODE_ENV !== "production",
    includeDetails: process.env.NODE_ENV !== "production",
  })
);
```

### Fastify Integration

```typescript
import Fastify from "fastify";
import { createFastifyErrorHandler } from "@AustinOrphan/errors";

const fastify = Fastify();

// Set error handler
fastify.setErrorHandler(
  createFastifyErrorHandler({
    includeStack: process.env.NODE_ENV !== "production",
    includeDetails: process.env.NODE_ENV !== "production",
  })
);

// Your routes here
fastify.get("/users/:id", async (request, reply) => {
  throw createNotFoundError("User", request.params.id);
});
```

### Factory Functions

```typescript
import {
  createNotFoundError,
  createValidationError,
  createAuthError,
  createForbiddenError,
  createConflictError,
  createDatabaseError,
} from "@AustinOrphan/errors";

// Not Found (404)
createNotFoundError("User", "123");

// Validation (400)
createValidationError("email", "Email address is invalid");

// Authentication (401)
createAuthError(); // "Authentication required"
createAuthError("Invalid token");

// Authorization (403)
createForbiddenError(); // "Forbidden"
createForbiddenError("Admin access required");

// Conflict (409)
createConflictError("User", "john@example.com");

// Database Error (500)
createDatabaseError("INSERT", { table: "users" });
```

### Error Response Format

All errors are converted to the standard format:

```typescript
{
  error: true,
  code: "NOT_FOUND",
  message: "User with id '123' not found",
  statusCode: 404,
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  timestamp: "2026-02-01T12:00:00.000Z",
  path: "/api/users/123",
  method: "GET",
  field?: "email",           // For validation errors
  details?: {...},           // Dev only
  stack?: "..."              // Dev only
}
```

### Manual Error Conversion

```typescript
import { errorToResponse, errorToHTTPStatus } from "@AustinOrphan/errors";

const error = new NotFoundError("User not found");

// Get HTTP status
const status = errorToHTTPStatus(error); // 404

// Convert to response
const response = errorToResponse(
  error,
  "req-123", // requestId
  "/api/users/123", // path
  "GET", // method
  true, // includeStack
  true // includeDetails
);
```

## Development

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Test

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck
```

### Clean

```bash
pnpm clean
```

## License

MIT
