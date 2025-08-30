# In-Memory Database for Testing

## Overview

In-memory SQLite databases provide significantly faster test execution by storing data in RAM instead of disk files. This implementation provides up to **39% performance improvement** for test setup and execution while maintaining full compatibility with existing test suites.

## Performance Benefits

Based on benchmark results:

| Scenario        | Setup Time Improvement | Query Time Improvement | Overall Improvement |
| --------------- | ---------------------- | ---------------------- | ------------------- |
| Basic Test Data | 39.7%                  | 33.3%                  | **39.7%**           |
| Large Dataset   | 10.1%                  | 9.1%                   | **10.0%**           |
| **Average**     | **24.9%**              | **21.2%**              | **24.8%**           |

## Quick Start

### 1. Enable In-Memory Database

Set environment variable to enable in-memory databases:

```bash
# Enable for all tests
export USE_IN_MEMORY_DB=true

# Or use npm scripts
npm run test:db:inmemory          # Unit tests with in-memory DB
npm run test:integration:inmemory # Integration tests with in-memory DB
```

### 2. Basic Test Setup (Vitest)

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { setupInMemoryDb, cleanupInMemoryDb, getTestDbClient } from '../setup/inMemoryDbSetup';
import { seedBasicTestData } from '../utils/testSeeds';

describe('My Test Suite', () => {
  beforeAll(async () => {
    await setupInMemoryDb({
      enableLogging: false,
      cleanBetweenTests: true,
      seedFunction: seedBasicTestData,
      testSuiteId: 'my-test-suite',
    });
  });

  afterAll(async () => {
    await cleanupInMemoryDb();
  });

  test('should query users', async () => {
    const client = getTestDbClient();
    const users = await client.user.findMany();
    expect(users.length).toBeGreaterThan(0);
  });
});
```

### 3. Basic Test Setup (Jest)

```typescript
import { setupInMemoryDb, cleanupInMemoryDb, getTestDbClient } from '../setup/inMemoryDbSetup';
import { seedBasicTestData } from '../utils/testSeeds';

describe('My Integration Test', () => {
  beforeAll(async () => {
    await setupInMemoryDb({
      enableLogging: false,
      cleanBetweenTests: true,
      seedFunction: seedBasicTestData,
      testSuiteId: 'integration-test-suite',
    });
  }, 30000); // 30 second timeout

  afterAll(async () => {
    await cleanupInMemoryDb();
  }, 10000); // 10 second timeout

  test('should perform CRUD operations', async () => {
    const client = getTestDbClient();
    // Your test logic here
  });
});
```

## Configuration Options

### `setupInMemoryDb(config)`

```typescript
interface DbTestConfig {
  /** Whether to enable SQL query logging */
  enableLogging?: boolean;
  /** Whether to clean database between tests */
  cleanBetweenTests?: boolean;
  /** Custom seed function for test data */
  seedFunction?: (client: PrismaClient) => Promise<void>;
  /** Test suite identifier for database isolation */
  testSuiteId?: string;
}
```

### Example Configurations

```typescript
// Minimal setup (no seed data)
await setupInMemoryDb({
  testSuiteId: 'minimal-tests',
});

// With logging enabled (for debugging)
await setupInMemoryDb({
  enableLogging: true,
  testSuiteId: 'debug-tests',
});

// Performance testing (large dataset)
await setupInMemoryDb({
  seedFunction: seedPerformanceTestData,
  cleanBetweenTests: false, // Keep data between tests
  testSuiteId: 'performance-tests',
});

// Custom seed data
await setupInMemoryDb({
  seedFunction: async client => {
    await client.user.create({
      data: { email: 'custom@test.com', name: 'Custom User', password: 'hashed' },
    });
  },
  testSuiteId: 'custom-tests',
});
```

## Seed Functions

Pre-built seed functions for common test scenarios:

### `seedBasicTestData`

- 3 test users (John, Jane, Bob)
- Sample runs, goals, and races
- Good for general testing

### `seedMinimalTestData`

- 3 test users only
- Minimal setup for user-focused tests

### `seedPerformanceTestData`

- 3 test users
- 1000 randomly generated runs
- Large dataset for performance testing

### `seedEdgeCaseTestData`

- Edge case scenarios
- Boundary value testing
- Null/empty value handling

### Custom Seed Functions

```typescript
async function customSeedFunction(client: PrismaClient) {
  // Create specific test data for your use case
  const user = await client.user.create({
    data: {
      email: 'specific@test.com',
      name: 'Specific Test User',
      password: await bcrypt.hash('password', 10),
    },
  });

  await client.run.create({
    data: {
      userId: user.id,
      date: new Date(),
      distance: 5.0,
      duration: 1800,
    },
  });
}
```

## Test Data Access

### Pre-defined Test Users

```typescript
import { TEST_USERS, getTestUser } from '../utils/testSeeds';

// Access test users
const john = getTestUser('john'); // { id, email, name, password }
const jane = getTestUser('jane');
const bob = getTestUser('bob');

// Use in tests
test('should authenticate user', async () => {
  const response = await request(app).post('/api/auth/login').send({
    email: john.email,
    password: john.password,
  });

  expect(response.status).toBe(200);
});
```

### Test Data Relationships

```typescript
import { getTestDataForUser, TEST_USERS } from '../utils/testSeeds';

test('should get user data', async () => {
  const johnData = getTestDataForUser(TEST_USERS.john.id);

  expect(johnData.runs.length).toBeGreaterThan(0);
  expect(johnData.goals.length).toBeGreaterThan(0);
  expect(johnData.races.length).toBeGreaterThan(0);
});
```

## Advanced Usage

### Database Isolation

Each test suite gets its own isolated database:

```typescript
// Test suite A
await setupInMemoryDb({ testSuiteId: 'suite-a' });

// Test suite B (completely isolated)
await setupInMemoryDb({ testSuiteId: 'suite-b' });
```

### Manual Database Management

```typescript
import { createTestDatabase, InMemoryDatabase } from '../utils/inMemoryDb';

test('manual database management', async () => {
  const db = await createTestDatabase('manual-test');

  try {
    const client = db.getClient();

    // Use database
    await client.user.create({
      /* ... */
    });

    // Clean specific data
    await db.clean();

    // Re-seed
    await db.seed(seedBasicTestData);
  } finally {
    await db.destroy();
  }
});
```

### Database Statistics

```typescript
test('should track database stats', async () => {
  const db = getTestDb();
  const stats = await db.getStats();

  console.log(`Tables: ${stats.tableCount}`);
  console.log(`Total rows: ${stats.totalRows}`);
  console.log(`Database size: ${stats.databaseSize} bytes`);

  stats.tables.forEach(table => {
    console.log(`${table.name}: ${table.rowCount} rows`);
  });
});
```

## Migration from File-Based Tests

### 1. Update Test Setup

**Before (file-based):**

```typescript
beforeAll(async () => {
  process.env.DATABASE_URL = 'file:./test.db';
  // Manual database setup
});
```

**After (in-memory):**

```typescript
beforeAll(async () => {
  await setupInMemoryDb({
    seedFunction: seedBasicTestData,
    testSuiteId: 'my-tests',
  });
});
```

### 2. Update Client Access

**Before:**

```typescript
const client = new PrismaClient();
```

**After:**

```typescript
const client = getTestDbClient();
```

### 3. Update Cleanup

**Before:**

```typescript
afterAll(async () => {
  await client.$disconnect();
  await fs.unlink('./test.db');
});
```

**After:**

```typescript
afterAll(async () => {
  await cleanupInMemoryDb();
});
```

## Troubleshooting

### Common Issues

1. **"Database not setup" error**

   ```
   Error: Database not setup. Call setupInMemoryDb() in beforeAll hook.
   ```

   **Solution:** Ensure `setupInMemoryDb()` is called before using `getTestDbClient()`.

2. **Tests interfering with each other**

   ```
   Expected 1 user, but found 3
   ```

   **Solution:** Enable `cleanBetweenTests: true` or use unique `testSuiteId` values.

3. **Slow test setup**

   ```
   Setup taking longer than expected
   ```

   **Solution:** Use `seedMinimalTestData` instead of `seedPerformanceTestData` for faster setup.

4. **Migration errors**
   ```
   Migration failed during setup
   ```
   **Solution:** Ensure Prisma schema is valid and migrations are up to date.

### Debug Mode

Enable detailed logging:

```typescript
await setupInMemoryDb({
  enableLogging: true,
  testSuiteId: 'debug-tests',
});

// Or via environment variable
process.env.TEST_DB_LOGGING = 'true';
```

### Performance Monitoring

```bash
# Run performance benchmark
npm run benchmark:db

# Compare file vs in-memory performance
npm run test:db:file     # File-based
npm run test:db:inmemory # In-memory
```

## Best Practices

### 1. Test Isolation

- Use unique `testSuiteId` for each test file
- Enable `cleanBetweenTests` for independent tests
- Avoid shared global state

### 2. Performance Optimization

- Use `seedMinimalTestData` for unit tests
- Use `seedBasicTestData` for integration tests
- Use `seedPerformanceTestData` only for performance tests

### 3. Data Management

- Create focused seed functions for specific test scenarios
- Clean up large datasets after performance tests
- Use transactions for atomic test operations

### 4. Error Handling

- Always use try/finally blocks with manual database management
- Set appropriate timeouts for Jest beforeAll/afterAll hooks
- Handle async cleanup properly

### 5. CI/CD Integration

```yaml
# GitHub Actions example
- name: Run tests with in-memory database
  env:
    USE_IN_MEMORY_DB: true
  run: npm run test
```

## Performance Comparison

| Operation       | File-based SQLite | In-memory SQLite | Improvement |
| --------------- | ----------------- | ---------------- | ----------- |
| Database Setup  | 1283ms            | 774ms            | 39.7%       |
| Simple Queries  | 3ms               | 2ms              | 33.3%       |
| Complex Joins   | 11ms              | 10ms             | 9.1%        |
| Bulk Operations | Similar           | Similar          | Minimal     |
| Cleanup         | Instant           | Instant          | Similar     |

## Security Considerations

- In-memory databases are automatically isolated
- No persistent storage reduces security attack surface
- Credentials are test-only and not persisted
- Database content is cleared on process exit

## Limitations

- Data is lost when process exits (by design)
- Not suitable for tests requiring persistent state across runs
- Memory usage increases with large datasets
- Some SQLite features may behave differently in memory

## Future Enhancements

- [ ] Automatic test data generation
- [ ] Database state snapshots
- [ ] Parallel test execution with isolated databases
- [ ] Performance metrics collection
- [ ] Integration with test coverage tools
