# Integration Test Fix Strategy

## Overview

The integration tests are currently failing at a 58% pass rate (231/397 passing) due to systematic configuration issues. This document outlines the strategy to fix these tests.

## Root Causes Identified

### 1. **Incomplete Test App Configuration**

- Tests were creating minimal Express apps without required middleware
- Missing error handler, validation, rate limiting, and security middleware
- Response structures didn't match what tests expected

### 2. **Database Setup Conflicts**

- Multiple Prisma client instances causing connection issues
- Inconsistent database cleanup between tests
- Missing environment variables for test database

### 3. **Missing Test Infrastructure**

- No centralized test app factory
- No unified database setup utilities
- Inconsistent token generation and user creation

## Solution Components

### 1. **Test App Factory** (`tests/integration/utils/testApp.ts`)

- `createTestApp()`: Full app with all middleware (mirrors production)
- `createMinimalTestApp()`: For testing specific routes in isolation
- Proper middleware chain: CORS → JSON → Security → Logging → Routes → Error Handler

### 2. **Unified Database Setup** (`tests/integration/utils/testDbSetup.ts`)

- Singleton Prisma instance to avoid connection conflicts
- Centralized test database initialization
- Consistent cleanup methods
- Helper functions for common operations:
  - `createTestUser()`: Creates users with hashed passwords
  - `generateTestToken()`: Creates valid JWT tokens
  - `cleanTestDatabase()`: Cleans all tables in correct order

### 3. **Updated Jest Setup** (`tests/setup/jestSetup.new.ts`)

- Sets all required environment variables
- Initializes database once before all tests
- Cleans database before each test
- Properly disconnects after all tests

## Migration Steps

### Phase 1: Infrastructure Setup

1. Replace `tests/setup/jestSetup.ts` with `jestSetup.new.ts`
2. Update `jest.config.js` to use new setup files
3. Remove conflicting database setup from individual tests

### Phase 2: Update Test Files

For each test file:

1. Import `createTestApp` instead of creating minimal Express app
2. Use `testDb` from unified setup instead of local database utilities
3. Update assertions to match actual error response structure

### Phase 3: Environment Configuration

Create `.env.test` file:

```env
NODE_ENV=test
DATABASE_URL=file:./prisma/test.db
TEST_DATABASE_URL=file:./prisma/test.db
JWT_SECRET=test-secret-key
JWT_REFRESH_SECRET=test-refresh-secret
LOG_SALT=test-log-salt
AUDIT_ENCRYPTION_KEY=test-audit-key
ENCRYPTION_KEY=test-encryption-key
BCRYPT_ROUNDS=10
DISABLE_RATE_LIMIT_IN_TESTS=true
```

## Expected Outcomes

### Immediate Fixes

- HTTP status code assertions will pass (proper error handling)
- Response structure assertions will pass (consistent error format)
- Database operations won't conflict between tests

### Long-term Benefits

- Consistent test environment across all integration tests
- Easier to add new integration tests
- Better test isolation and reliability
- Faster test execution (optimized bcrypt rounds)

## Example Migration

### Before:

```typescript
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);

// Missing error handler, validation, etc.
```

### After:

```typescript
import { createTestApp } from '../utils/testApp.js';
import { testDb } from '../utils/testDbSetup.js';

const app = createTestApp(); // Full middleware stack
```

## Next Steps

1. Apply these changes systematically to all integration test files
2. Run tests incrementally to verify fixes
3. Update CI/CD pipeline to use test environment variables
4. Document any additional patterns discovered during migration

## Success Metrics

- Target: >95% integration test pass rate
- All tests should run without database conflicts
- No "worker process failed to exit" warnings
- Consistent response structures across all API tests
