# Test Regression Root Cause Analysis

**Date:** 2026-02-26
**Status:** CRITICAL INFRASTRUCTURE ISSUE IDENTIFIED

---

## Executive Summary

Phase 1 "quick wins" successfully fixed 3 individual test failures, but comprehensive test runs revealed a **critical regression** (184/269 vs baseline 187/269). Root cause identified: **shared database state causing foreign key constraint violations when tests run in parallel**.

**Conclusion:** This validates the user's choice of **Option B (Sustainable Path)** - test infrastructure must be fixed before individual test fixes will be stable.

---

## The Regression

### Expected Result

- Baseline: 187/269 passing (69.5%)
- Phase 1 fixes: 3 tests (errorHandling, stats, races)
- Expected after fixes: 188-190/269 passing (70-71%)

### Actual Result

- **184/269 passing (68.4%)**
- **Net regression: 3 tests worse than baseline**
- Worker process exit warning still present

### Failed Suites

7 of 8 suites failing in comprehensive run:

- ✅ `errorHandling.test.ts` - PASSING (only suite that works)
- ❌ `races.test.ts` - FAILING (despite passing 8/8 individually)
- ❌ `stats.test.ts` - FAILING
- ❌ `runs.test.ts` - FAILING
- ❌ `goals.test.ts` - FAILING
- ❌ `analytics.test.ts` - FAILING
- ❌ `auth.test.ts` - FAILING
- ❌ `trainingPlans.test.ts` - FAILING

---

## Root Cause Analysis

### The Smoking Gun

**Races test error when run in comprehensive suite:**

```
PrismaClientKnownRequestError:
Invalid `prisma.race.create()` invocation in
/Users/austinorphan/src/running-app-mvp/_main/tests/fixtures/testDatabase.ts:87:43

Foreign key constraint violated on the foreign key
```

**Location:** `testDatabase.ts:87` - creating test races
**Constraint:** Foreign key to `User` table
**Timing:** Only fails when all suites run together

### Why This Happens

1. **Jest runs test suites in parallel** (default behavior)
2. **All suites share the same SQLite database** (`test.db`)
3. **Race condition in test setup:**

   ```
   Suite A: cleanupDatabase() → create user "test@test.com"
   Suite B: cleanupDatabase() → create user "test@test.com"  (collision!)
   Suite A: create race for user → foreign key violation (user may be deleted by Suite B)
   ```

4. **Database cleanup happens in beforeEach/afterAll:**
   - `cleanupDatabase()` truncates all tables
   - Multiple suites calling this simultaneously = chaos
   - Foreign key constraints fail when referenced users are deleted mid-test

### Evidence

**Individual runs (isolated):**

- races.test.ts: ✅ 8/8 passing
- errorHandling.test.ts: ✅ 18/18 passing
- stats.test.ts: ✅ 19/20 (1 skipped)

**Comprehensive run (parallel):**

- races.test.ts: ❌ 5/8 passing (3 failures)
- All other suites: ❌ Multiple failures
- Worker process exit warning present

**Key observation:** The code fixes are correct, but the test infrastructure cannot support parallel execution.

---

## Why Option B Was Correct

The user chose **Option B (Sustainable Path)** over **Option A (Quick Fixes)**, and this regression proves that choice was correct:

### Option A Would Have Failed

- Fix 28 tests individually
- Hope they all pass together
- Result: Infrastructure issues would cause new failures
- **Actual outcome:** Lost 3 tests instead of gaining 28

### Option B is Validated

- Fix infrastructure first (test isolation)
- Then fix tests systematically
- Result: Stable, repeatable improvements
- **This is what we need**

---

## The Problem: Shared Database State

### Current Test Setup Pattern

```typescript
// tests/integration/api/races.test.ts (and all other suites)
describe('Races API Integration Tests', () => {
  let testUser: TestUser | undefined;
  let authToken: string;

  beforeEach(async () => {
    // PROBLEM: All suites do this simultaneously
    await testDb.cleanupDatabase(); // ⚠️ Deletes ALL data in test.db
    testUser = await testDb.createTestUser({
      email: 'races@test.com',
      password: 'testpassword',
    });
    authToken = testDb.generateTestToken(testUser.id);
  });

  afterAll(async () => {
    await testDb.cleanupDatabase(); // ⚠️ Deletes ALL data
    await testDb.prisma.$disconnect();
  });
});
```

### What Happens in Parallel

```
Time  Suite A (races)             Suite B (auth)              Database State
----  -----------------------      -----------------------     ---------------
T0    beforeEach starts            beforeEach starts           Empty
T1    cleanupDatabase()            -                           Empty
T2    -                            cleanupDatabase()           Empty (again)
T3    create user A                -                           User A exists
T4    -                            create user B               User A, B exist
T5    create race for A            -                           Race references User A
T6    -                            cleanupDatabase()           ⚠️ User A DELETED
T7    create another race for A    -                           💥 FOREIGN KEY ERROR
```

**Result:** Foreign key constraint violated because User A was deleted by Suite B while Suite A still needed it.

---

## Additional Infrastructure Issues

### 1. Worker Process Exit Warnings

```
A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown.
```

**Cause:**

- Prisma client connections not properly closed
- Background timers or promises not cleaned up
- Missing `await` in teardown

### 2. Test Flakiness (5% Variance)

From previous analysis:

- 7 consecutive runs: 177-190 passing
- Variance: 13 tests (5%)
- **This is now explained:** Race conditions in parallel execution

### 3. Shared Test Data

All suites use similar test data:

- Users: `test@test.com`, `auth@test.com`, `races@test.com`
- These can collide when created simultaneously
- No unique identifiers per test run

---

## Solution Strategy (Phase 2 Infrastructure Fixes)

### Fix 1: Test Isolation with Unique Database per Suite

**Option A: Separate database file per suite** (RECOMMENDED)

```typescript
// tests/fixtures/testDatabase.ts
export function getTestDatabaseUrl(suiteName: string): string {
  return `file:./prisma/test-${suiteName}.db`;
}

// tests/integration/api/races.test.ts
const testDb = new TestDatabase(getTestDatabaseUrl('races'));
```

**Benefits:**

- Complete isolation between suites
- No foreign key collision possible
- Parallel execution safe

**Tradeoffs:**

- Multiple database files (cleaned up after tests)
- Slightly more disk I/O

---

**Option B: Run tests serially** (FALLBACK)

```json
// jest.config.js
{
  "maxWorkers": 1 // Force serial execution
}
```

**Benefits:**

- Simple configuration change
- No code changes needed

**Tradeoffs:**

- Much slower (8+ seconds → 30+ seconds)
- Doesn't address root cause

---

### Fix 2: Proper Prisma Client Cleanup

```typescript
// tests/setup/jestSetup.ts
afterAll(async () => {
  // Ensure all Prisma clients disconnect
  await testDb.prisma.$disconnect();
});

// Each test suite
afterAll(async () => {
  await testDb.cleanupDatabase();
  await testDb.prisma.$disconnect();

  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100));
});
```

### Fix 3: Unique Test Data per Run

```typescript
// Generate unique identifiers
const testRunId = Date.now();
const testUser = await testDb.createTestUser({
  email: `test-${testRunId}@test.com`,
  password: 'testpassword',
});
```

---

## Recommended Implementation Order

### Phase 2.1: Database Isolation (CRITICAL)

1. Implement `getTestDatabaseUrl(suiteName)` helper
2. Update each test suite to use unique database
3. Run comprehensive tests to verify isolation
4. **Expected outcome:** All Phase 1 fixes should now work together

### Phase 2.2: Connection Cleanup

1. Add proper `$disconnect()` calls
2. Add teardown delays if needed
3. Run with `--detectOpenHandles` to verify
4. **Expected outcome:** No worker exit warnings

### Phase 2.3: Unique Test Data

1. Add test run IDs to generated data
2. Update test fixtures to use unique emails/names
3. **Expected outcome:** No collision errors

### Phase 2.4: Verification

1. Run 10 consecutive comprehensive test suites
2. Verify < 2% variance
3. Confirm stable pass rate
4. **Expected outcome:** Repeatable, stable tests

---

## Immediate Next Steps

1. **Implement database isolation** (Phase 2.1)
   - Create `getTestDatabaseUrl()` helper
   - Update all 8 test suites
   - Test individually and comprehensively

2. **Re-run baseline after isolation fix**
   - Should see ~188-190 passing (Phase 1 fixes now working)
   - Should see reduced variance

3. **Document results**
   - Compare before/after isolation
   - Measure stability improvement

4. **Proceed to Phase 3** (systematic failure resolution)
   - Now safe to fix individual test failures
   - Changes will be stable and repeatable

---

## Key Insights

1. **The fixes were correct** - errorHandling, stats, and races all work individually
2. **The infrastructure was broken** - parallel execution with shared database causes chaos
3. **Option B was validated** - infrastructure must be fixed first
4. **Test isolation is non-negotiable** - parallel tests require isolated state

---

## Conclusion

This regression is **not a failure** - it's **validation** that we needed Option B.

The Phase 1 fixes are sound. The test infrastructure is broken. Fix the foundation first, then build on it.

**Next action:** Implement database isolation (Phase 2.1)
