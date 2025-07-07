# Test Environment Setup and Validation

This guide covers setting up and validating your test environment for optimal reliability and performance.

## Quick Start

Run the test environment validation:

```bash
npm run validate-test-env
```

## Environment Variables

### Required Variables

- `NODE_ENV`: Should be set to `test` or `development` for testing

### Recommended Variables

```bash
# Database Configuration
DATABASE_URL="postgresql://localhost:5432/running_app_test"
TEST_DATABASE_URL="postgresql://localhost:5432/running_app_test"

# Rate Limiting (disable for tests)
RATE_LIMITING_ENABLED=false

# Authentication
JWT_SECRET="your-test-jwt-secret"
BCRYPT_ROUNDS=10

# API Configuration
API_BASE_URL="http://localhost:3001"
```

### CI/CD Variables

```bash
CI=true  # Automatically set by most CI providers
NODE_ENV=test
```

## Database Setup

### For Development/Testing

1. **PostgreSQL** (Recommended):
   ```bash
   # Create test database
   createdb running_app_test
   
   # Set environment variable
   export TEST_DATABASE_URL="postgresql://localhost:5432/running_app_test"
   ```

2. **SQLite** (Alternative):
   ```bash
   export TEST_DATABASE_URL="file:./test.db"
   ```

### Database Best Practices

- **Always use a separate test database** - Never run tests against production data
- **Include "test" in database name** - Makes it obvious this is for testing
- **Clean database between tests** - Ensures test isolation
- **Use transactions** - Roll back changes after each test when possible

## File Structure Validation

The validator checks for these essential files and directories:

```
project-root/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── tests/
│   ├── unit/
│   ├── e2e/
│   ├── fixtures/
│   │   └── mockData.ts
│   ├── setup/
│   │   ├── testSetup.ts
│   │   └── validateTestEnvironment.ts
│   └── utils/
│       └── mockApiUtils.ts
└── src/
```

## Test Dependencies

### Core Testing Libraries

```json
{
  "devDependencies": {
    "vitest": "^3.2.4",
    "@playwright/test": "^1.53.1",
    "@testing-library/react": "^16.3.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/user-event": "^14.6.1"
  }
}
```

### Installation

```bash
npm install
npm run test:setup  # Installs Playwright browsers
```

## Rate Limiting Configuration

**Important**: Disable rate limiting in test environments to prevent flaky tests:

```bash
export RATE_LIMITING_ENABLED=false
```

### Why This Matters

- Tests make rapid API calls that can trigger rate limits
- Rate limits cause non-deterministic test failures
- Different test timing can cause inconsistent results

## Mock Service Configuration

### API Mocking

Use the standardized mock utilities:

```typescript
import { createApiResponse, MockApiError } from '../tests/utils/mockApiUtils';

// Create mock response
const mockResponse = createApiResponse(data);

// Create mock error
const mockError = new MockApiError('Error message', 404);
```

### Database Mocking

```typescript
import { testDb } from '../tests/fixtures/testDatabase';

beforeEach(async () => {
  await testDb.cleanupDatabase();
});
```

## Common Issues and Solutions

### Issue: "Database connection failed"

**Solution:**
1. Verify database is running
2. Check `DATABASE_URL` format
3. Ensure test database exists
4. Verify connection permissions

```bash
# Test connection
npx prisma db pull --schema ./prisma/schema.prisma
```

### Issue: "Rate limit exceeded in tests"

**Solution:**
```bash
export RATE_LIMITING_ENABLED=false
```

### Issue: "Module not found" errors

**Solution:**
1. Run `npm install`
2. Check import paths
3. Verify file extensions in imports

### Issue: "Tests timeout frequently"

**Solution:**
1. Increase test timeouts
2. Improve wait conditions
3. Use proper async/await patterns
4. Check network connectivity

## Validation Script Details

The validation script checks:

### Environment Variables
- ✅ Required variables are set
- ⚠️ Optional variables for better reliability
- 💡 Recommendations for optimization

### File Structure
- ✅ Essential config files exist
- ✅ Test directories are present
- 💡 Suggested organizational improvements

### Database Configuration
- ✅ Valid database URL format
- ⚠️ Using test database (not production)
- 💡 Database provider recommendations

### Dependencies
- ✅ Critical test dependencies installed
- ✅ Node.js version compatibility
- 💡 Additional useful packages

### Performance Settings
- ⚠️ Rate limiting configuration
- 💡 Optimization suggestions
- 💡 Mock service setup

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    env:
      NODE_ENV: test
      RATE_LIMITING_ENABLED: false
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run validate-test-env
      - run: npm run test:all
```

## Manual Validation Checklist

Before running tests, verify:

- [ ] Database is running and accessible
- [ ] Test database is separate from production
- [ ] `RATE_LIMITING_ENABLED=false` is set
- [ ] All dependencies are installed (`npm install`)
- [ ] Environment variables are configured
- [ ] Playwright browsers are installed (`npm run test:setup`)

## Troubleshooting

### Enable Detailed Validation

```bash
VALIDATE_TEST_ENV=true npm test
```

### Debug Database Issues

```bash
# Check Prisma connection
npx prisma studio

# Reset test database
npx prisma migrate reset --force
```

### Check Port Availability

```bash
# Check if port 3001 is available for test server
lsof -i :3001
```

## Best Practices

1. **Run validation regularly** - Especially after environment changes
2. **Use separate test database** - Never test against production data
3. **Clean between tests** - Ensure test isolation
4. **Disable rate limiting** - Prevent flaky test behavior
5. **Use proper wait conditions** - Avoid race conditions
6. **Mock external services** - Reduce test dependencies
7. **Set appropriate timeouts** - Balance speed vs reliability

## Support

If validation fails:

1. Review the validation report carefully
2. Address errors before warnings
3. Consider recommendations for better reliability
4. Check this documentation for common issues
5. Verify your environment matches the examples above