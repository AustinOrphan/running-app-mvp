# Backend Audit: running-app-mvp

**Audit Date:** 2026-01-31
**Repository:** /Users/austinorphan/src/running-app-mvp
**Purpose:** Backend standardization analysis

---

## Tech Stack Summary

| Component       | Technology      | Version                          |
| --------------- | --------------- | -------------------------------- |
| Framework       | Express.js      | 5.1.0                            |
| ORM             | Prisma          | 6.11.1                           |
| Database        | SQLite          | (file-based)                     |
| Auth            | JWT + bcrypt    | jsonwebtoken 9.0.2, bcrypt 6.0.0 |
| Logging         | Winston         | 3.17.0                           |
| Config          | dotenv          | 17.2.0                           |
| Validation      | Zod             | 3.22.4                           |
| Package Manager | npm             | 10.0.0+                          |
| Node Version    | 20+             | (requires 20.0.0+)               |
| Runtime Model   | Standard server | Port 3001                        |

---

## Architecture Overview

### Structure

- **Type:** Monolithic full-stack application
- **Frontend:** React 18 + Vite (port 3000)
- **Backend:** Express.js (port 3001)
- **Deployment:** Traditional server (non-serverless)

### Directory Structure

```
running-app-mvp/_main/
├── server/              # Backend code
│   ├── middleware/      # Express middleware
│   ├── routes/          # API route handlers
│   ├── utils/           # Backend utilities
│   └── types/           # Backend TypeScript types
├── src/                 # Frontend code
├── prisma/              # Database schema and migrations
├── tests/               # Test files
└── server.ts            # Main entry point
```

---

## Error Handling

### Current Implementation

**Location:** `server/middleware/errorHandler.ts`

**Error Interface:**

```typescript
interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
  field?: string;
}
```

**Error Response Format:**

```typescript
interface ErrorResponse {
  error: boolean;
  message: string;
  statusCode: number;
  category: string;
  timestamp: string;
  path: string;
  method: string;
  errorCode?: string;
  field?: string;
  details?: Record<string, unknown>; // dev only
  stack?: string; // dev only
}
```

**Factory Functions:**

- `createError(message, statusCode)` - Generic error
- `createValidationError(message, field, details)` - 400
- `createNotFoundError(resource)` - 404
- `createUnauthorizedError(message)` - 401
- `createForbiddenError(message)` - 403
- `createConflictError(message, details)` - 409
- `createDatabaseError(message, details)` - 500

**Error Categories:**

- `client_error` (4xx)
- `server_error` (5xx)
- `unknown`

**Error Handler:**

- Centralized Express middleware
- Maps errors to HTTP status codes
- Logs errors with categorization
- Redacts stack traces in production

---

## Logging

### Current Implementation

**Location:** `server/utils/logger.ts`, `server/utils/secureLogger.ts`

**Logging Stack:**

- Winston 3.17.0 for log output
- Custom `EnhancedLogger` class for structured logging
- `secureLogger` for PII redaction

**Log Entry Structure:**

```typescript
interface StructuredLogData {
  timestamp: string; // ISO 8601
  level: 'error' | 'warn' | 'info' | 'debug';
  correlationId: string; // UUID v4
  component: string; // e.g., "auth", "database", "middleware"
  operation: string; // e.g., "login", "create-run", "fetch-goals"
  context?: Record<string, unknown>;
  error?: {
    message: string;
    type: string; // Error type/class name
    code?: string;
    stack?: string; // dev only
  };
}
```

**Error Categorization:**

- `AuthenticationError` - JWT errors, invalid credentials
- `AuthorizationError` - Permission denied
- `DatabaseError` - Prisma errors
- `ValidationError` - Zod validation errors
- `NotFoundError` - Resource not found
- `ConflictError` - Duplicate resources
- `NetworkError` - Network/timeout errors
- `ExternalServiceError` - External API failures
- `ConfigurationError` - Missing env vars
- `UnknownError` - Uncategorized

**PII Redaction:**

- Email addresses hashed/masked
- Passwords always redacted
- JWT tokens always redacted
- User IDs allowed (not PII)
- Uses `LOG_SALT` env var for hashing

**Correlation IDs:**

- UUID v4 generation
- Added to Express Request via middleware
- Included in all log entries
- Extractable from request headers

**Logging Functions:**

- `logError(component, operation, error, req, context)`
- `logWarn(component, operation, message, req, context)`
- `logInfo(component, operation, message, req, context)`
- `logDatabase(operation, req, error, context)`
- `logAuth(operation, req, error, context)`
- `correlationMiddleware()` - Express middleware

---

## Configuration

### Current Implementation

**Method:** dotenv + manual `process.env` access

**Required Environment Variables:**

| Variable       | Type   | Purpose                    | Default       |
| -------------- | ------ | -------------------------- | ------------- |
| DATABASE_URL   | string | Prisma database connection | -             |
| JWT_SECRET     | string | JWT signing secret         | -             |
| JWT_EXPIRES_IN | string | JWT expiration time        | "7d"          |
| LOG_SALT       | string | Salt for PII hashing       | -             |
| PORT           | number | Server port                | 3001          |
| NODE_ENV       | enum   | Environment                | "development" |
| FRONTEND_URL   | string | CORS origin (production)   | -             |

**Validation:** ❌ None (errors only at runtime)

**Type Safety:** ❌ None (all `string | undefined`)

**Location:** Loaded in `server.ts` via `dotenv.config()`

---

## Authentication

### Current Implementation

**Location:** `server/middleware/requireAuth.ts`, `server/utils/jwtUtils.ts`

**Method:** JWT (stateless)

**Token Types:**

- Access tokens (7 day expiry by default)
- Refresh tokens (token rotation)

**JWT Payload:**

```typescript
{
  id: string;        // User ID
  email: string;     // User email
  jti?: string;      // JWT ID (for blacklisting)
  type: 'access' | 'refresh';
  iat: number;       // Issued at
  exp: number;       // Expires at
}
```

**Middleware Behavior:**

- Extracts token from `Authorization: Bearer <token>` header
- Validates token signature and expiration
- Checks token blacklist
- Attaches `user` object to request
- Returns 401 if invalid/missing token

**AuthRequest Interface:**

```typescript
interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
  correlationId?: string;
}
```

**Password Hashing:** bcrypt 6.0.0

**Token Blacklisting:** In-memory (via jwtUtils)

---

## Request ID / Tracing

### Current Implementation

**Correlation ID Generation:**

- UUID v4 via `uuid` package
- Middleware: `correlationMiddleware()` from logger
- Added to `req.correlationId`

**Header Support:**

- No incoming header support yet (always generates new ID)

**Propagation:**

- Included in all log entries
- Should be included in error responses (needs verification)

**Distributed Tracing:** ❌ Not implemented

---

## Database

### ORM/Schema

- **ORM:** Prisma 6.11.1
- **Database:** SQLite (file-based)
- **Location:** `prisma/schema.prisma`

### Models

- User (auth + profile)
- Run (running activities)
- Goal (user goals with progress)
- Race (scheduled events)

### Access Pattern

- Direct Prisma client usage in route handlers
- No repository pattern
- No service layer
- Simple CRUD operations

### Migrations

- Prisma migrations supported
- Currently using `prisma migrate dev`

---

## Testing

### Test Frameworks

- **Unit:** Vitest 3.2.4
- **Integration:** Jest 30.0.4
- **E2E:** Playwright 1.54.1
- **Accessibility:** axe-core 4.10.3

### Test Scripts

60+ test-related scripts in package.json:

```json
{
  "test": "vitest",
  "test:integration": "jest --config jest.config.js",
  "test:e2e": "playwright test",
  "test:coverage": "vitest run --coverage",
  "test:a11y": "vitest run tests/unit/accessibility",
  "test:visual": "playwright test tests/e2e/visual-regression.test.ts",
  "test:all:complete": "npm run test:infrastructure && npm run test:coverage && npm run test:integration && npm run test:e2e && npm run test:a11y:all && npm run test:visual"
}
```

### Test Location

- `tests/unit/` - Vitest unit tests
- `tests/integration/` - Jest integration tests
- `tests/e2e/` - Playwright E2E tests
- `tests/infrastructure/` - Infrastructure tests
- `tests/accessibility/` - Accessibility tests

### Coverage

- Coverage tracking enabled
- Quality checks via `coverage-quality.cjs`
- Badge generation

---

## Duplicates & Extraction Candidates

### High Priority (Clear Wins)

1. **Error handling patterns**
   - Factory functions (`createNotFoundError`, `createValidationError`, etc.)
   - Error categorization logic
   - HTTP status code mapping
   - Error response format

2. **Logging utilities**
   - Structured logging with correlation IDs
   - PII redaction patterns
   - Error categorization
   - Component/operation logging pattern

3. **Config validation**
   - Environment variable loading
   - Type validation (currently missing)
   - Required vs optional fields

### Medium Priority (Needs Alignment)

4. **Auth middleware**
   - JWT validation pattern
   - Token extraction from headers
   - User extraction from payload
   - 401 error handling

5. **Request correlation**
   - UUID generation
   - Middleware pattern
   - Header propagation

### Low Priority (Too Divergent)

6. **Database access patterns**
   - Too simple (direct Prisma calls)
   - No clear abstraction
   - Different from neoClone's repository pattern

7. **Route patterns**
   - Express-specific
   - Business logic embedded

---

## Risks & Constraints

### Integration Risks

1. **Monolithic structure**
   - Frontend + backend in same repo
   - Shared `package.json` with frontend dependencies
   - Need careful dependency management

2. **No config validation**
   - Runtime errors possible with missing env vars
   - Type safety would be breaking change (but good)

3. **SQLite database**
   - File-based, no connection pooling
   - Different from neoClone's PostgreSQL
   - Migration patterns may differ

4. **Stateless JWT**
   - No session storage
   - Token blacklist is in-memory (lost on restart)
   - Different from neoClone's session-based auth

### Migration Constraints

1. **Minimal disruption required**
   - Active development project
   - Cannot break existing API
   - Need backward compatibility

2. **Test coverage**
   - Extensive test suite must continue passing
   - Add contract tests for new standards

3. **Logging coupling**
   - Tightly coupled to Winston
   - Need adapter pattern for flexibility

---

## Recommendations

### Immediate Actions (Phase 2 Integration)

1. ✅ Extract error handling to `@AustinOrphan/errors`
   - Minimal changes (wrapper pattern)
   - Clear win (standardization)

2. ✅ Extract logging to `@AustinOrphan/logger`
   - Keep Winston backend initially
   - Add correlation ID to responses

3. ✅ Add config validation via `@AustinOrphan/config`
   - Fail-fast on startup
   - Type-safe config access

4. ✅ Add contract tests
   - Verify error format
   - Verify logging structure
   - Verify config validation

### Future Enhancements

1. ⏳ Extract auth middleware (after alignment with neoClone)
2. ⏳ Add distributed tracing (OpenTelemetry)
3. ⏳ Migrate to PostgreSQL (optional, for consistency)
4. ⏳ Add repository pattern (optional, for consistency)

### Do NOT Change

1. ❌ Express framework (keep as-is)
2. ❌ Frontend code (out of scope)
3. ❌ Business logic (too risky)
4. ❌ Database schema (out of scope)
5. ❌ External API behavior (must remain identical)

---

## Next Steps

1. ✅ Review this audit
2. ⬜ Approve shared library integration plan
3. ⬜ Create integration branch
4. ⬜ Install shared libraries
5. ⬜ Update bootstrapping (config, logger, errors)
6. ⬜ Add contract tests
7. ⬜ Verify all tests pass
8. ⬜ Merge to main

---

## Contact & Notes

- **Owner:** Solo developer (Austin Orphan)
- **Active Development:** Yes
- **CI/CD:** GitHub Actions (exists, needs contract test addition)
- **Deployment:** Manual (no automated deployment yet)

---

**End of Audit**
