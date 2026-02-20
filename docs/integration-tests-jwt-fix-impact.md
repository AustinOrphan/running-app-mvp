# Integration Tests - JWT Fix Impact Assessment

**Date:** 2026-02-20
**Status:** Assessment Complete
**Overall Pass Rate:** 88/269 tests passing (32.7%)

---

## Executive Summary

This document assesses the impact of the JWT token fix (`generateTestToken()`) across all integration test suites. While the fix successfully resolved authentication issues in the analytics tests, it revealed systemic failures across other test suites that require separate attention.

---

## JWT Fix Background

**Original Issue:**
Test JWT tokens were not matching production token format, causing authentication failures.

**Fix Applied** (in `tests/fixtures/testDatabase.ts`):

```typescript
export const generateTestToken = (userId: string, email: string = 'test@example.com') => {
  const payload = {
    id: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    type: 'access' as const,
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });
};
```

**Impact:**
JWT tokens now match production format, enabling proper authentication in integration tests.

---

## Test Suite Results

### Suite-by-Suite Breakdown

| Test Suite                | Status     | Pass Rate    | Notes                              |
| ------------------------- | ---------- | ------------ | ---------------------------------- |
| **analytics.test.ts**     | ⚠️ Partial | 39/43 (91%)  | Fixed by JWT + Prisma instance fix |
| **auth.test.ts**          | ❌ Failing | ~25/40 (63%) | Unknown failures                   |
| **runs.test.ts**          | ❌ Failing | Unknown      | Requires investigation             |
| **goals.test.ts**         | ❌ Failing | Unknown      | Foreign key constraint violations  |
| **races.test.ts**         | ❌ Failing | Unknown      | Requires investigation             |
| **stats.test.ts**         | ❌ Failing | Unknown      | Requires investigation             |
| **trainingPlans.test.ts** | ❌ Failing | Unknown      | Foreign key constraint violations  |
| **errorHandling.test.ts** | ❌ Failing | 0/18 (0%)    | **CRITICAL:** jest is not defined  |

**Totals:**

- 8 test suites total
- 8 suites with failures
- 88 tests passing out of 269 total
- **Overall: 32.7% pass rate**

---

## Critical Issues Identified

### Issue 1: errorHandling.test.ts - Jest API Not Available

**Severity:** CRITICAL
**Impact:** All 18 tests in suite fail immediately

**Error Pattern:**

```
ReferenceError: jest is not defined

  22 |     // Mock console.error to prevent test output pollution
> 23 |     mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
     |     ^
```

**Root Cause:**
The file uses Jest globals (`jest.spyOn`, `jest.fn()`) directly without importing from `@jest/globals` in an ESM environment.

**Solution:**
Update to import Jest APIs:

```typescript
import { jest } from '@jest/globals';
```

**Priority:** HIGH - blocks 18 tests

---

### Issue 2: Foreign Key Constraint Violations

**Severity:** HIGH
**Impact:** Multiple tests in goals.test.ts and trainingPlans.test.ts

**Error Pattern:**

```
Invalid `prisma.goal.create()` invocation
Foreign key constraint violated on the foreign key
```

**Observations:**

- Happens in tests creating goals with `targetRaceId`
- Happens in tests creating training plans with `targetRaceId`
- Referenced race may not exist in test database

**Root Cause:**
Test data setup doesn't create prerequisite races before creating goals/training plans that reference them.

**Solution:**
Fix test data setup order:

1. Create user
2. Create races (if referenced)
3. Create goals/training plans

**Priority:** MEDIUM - affects ~15-20 tests

---

### Issue 3: Heatmap Route Prisma Instance Isolation

**Severity:** MEDIUM
**Impact:** 3 analytics tests (already documented)

**Description:**
Routes in `server/routes/analytics.ts` directly import `prisma` from `lib/prisma.ts`, which is a different instance than `testDb.prisma`.

**Status:**
Documented in analytics-test-fix-final-2026-02-20.md as known issue.

**Solution:**
Refactor heatmap logic to use GeospatialService with `setPrismaInstance()`.

**Priority:** LOW - architectural improvement

---

### Issue 4: Unknown Auth Test Failures

**Severity:** MEDIUM
**Impact:** ~15 auth tests failing (estimated 63% pass rate)

**Status:**
Requires investigation. JWT fix was applied but some auth tests still fail.

**Possible Causes:**

- Test database isolation issues
- Race conditions in parallel test execution
- Middleware configuration in test environment

**Priority:** MEDIUM - auth is critical functionality

---

## JWT Fix Success Stories

### ✅ Analytics Tests

**Before JWT Fix:**
Authentication completely broken, most tests couldn't run

**After JWT Fix + Prisma Instance Fix:**
39/43 passing (91%)

**Impact:**
JWT fix enabled tests to authenticate, then Prisma fix allowed data access.

### ✅ Test Execution

**Before:**
Many tests would fail immediately with auth errors

**After:**
Tests execute fully, revealing underlying issues (which is progress!)

---

## Recommendations

### Immediate Actions (This Session)

1. ✅ **DONE:** Document test results and JWT fix impact
2. ⏳ **Next:** Update todo list with findings

### Short-Term Fixes (Next PR)

1. **Fix errorHandling.test.ts** (1 hour)
   - Add `import { jest } from '@jest/globals'`
   - Verify all 18 tests pass
   - **Impact:** +18 tests passing

2. **Fix foreign key violations** (1-2 hours)
   - Update goals.test.ts to create prerequisite races
   - Update trainingPlans.test.ts to create prerequisite races
   - **Impact:** +15-20 tests passing

3. **Investigate auth test failures** (2-3 hours)
   - Isolate specific failing tests
   - Debug authentication flow in test environment
   - **Impact:** +15 tests passing (estimate)

**Projected Impact:**
From 88/269 (33%) → 136/269 (51%) with these fixes

### Medium-Term Improvements

1. **Refactor heatmap route** (3-4 hours)
   - Move Prisma queries to GeospatialService
   - Add `setPrismaInstance()` support
   - **Impact:** +3 analytics tests

2. **Tune trend detection algorithm** (2-3 hours)
   - Analyze improvingPacePattern fixture
   - Adjust algorithm thresholds
   - **Impact:** +1 analytics test

3. **Test isolation audit** (4-6 hours)
   - Review all test suites for Prisma instance issues
   - Standardize test setup patterns
   - Document best practices

---

## Lessons Learned

### 1. JWT Format Matters

Production and test JWT tokens must have identical structure, or authentication will fail in subtle ways.

### 2. Prisma Instance Isolation Is Critical

Services and routes must use the same Prisma instance as tests, or tests won't see their own data.

### 3. Test Failures Cascade

A single configuration issue (like missing Jest imports) can block an entire test suite, masking other issues.

### 4. Foreign Key Integrity in Tests

Test data must respect database constraints. Create dependencies before dependents.

### 5. Systematic Debugging Pays Off

The analytics test debugging journey (documented in analytics-test-fix-final-2026-02-20.md) demonstrated the value of methodical investigation.

---

## Test Environment Best Practices

### Established Through This Work

1. **Always use `testDb.prisma` in tests**
2. **Call `Service.setPrismaInstance(testDb.prisma)` in beforeAll hooks**
3. **Use period-aware fixtures for time-based queries**
4. **Import Jest APIs explicitly in ESM environment**
5. **Create test data in dependency order**
6. **Clean database between tests for isolation**

---

## Next Steps

### Phase 3: Backend Standardization (After Test Fixes)

Once integration tests reach >80% pass rate, proceed with:

- Error handling pattern comparison
- Logging standards alignment
- Authentication middleware review
- Validation pattern standardization

**Blocked Until:** Integration tests stabilized

---

## Metrics

### Before This Work

- Analytics tests: 0/43 passing (0%) - broken auth
- Overall integration tests: Unknown baseline

### After JWT Fix

- Analytics tests: 39/43 passing (91%)
- Overall integration tests: 88/269 passing (33%)

### Target

- Analytics tests: 43/43 passing (100%)
- Overall integration tests: 215+/269 passing (80%+)

### Progress

- **Analytics:** 91% of target achieved ✅
- **Overall:** 41% of target achieved ⏳

---

## Files Modified in This Work

### Analytics Test Improvements (Committed: 5b2c0ed)

1. `server/services/geospatialService.ts` - bbox null fix
2. `tests/integration/api/analytics.test.ts` - Prisma instance fix + period-aware fixtures
3. `tests/fixtures/analyticsData.ts` - current-period date helpers
4. `docs/analytics-test-fix-final-2026-02-20.md` - debugging journey

### JWT Token Fix (Previous Commit)

1. `tests/fixtures/testDatabase.ts` - `generateTestToken()` enhancement

---

## Conclusion

The JWT fix successfully resolved authentication issues in integration tests, enabling tests to run and revealing underlying problems across the test suite. Analytics tests achieved 91% pass rate through systematic debugging. Other test suites require similar attention to configuration, test data setup, and Prisma instance isolation.

**Recommended Path Forward:**

1. Fix errorHandling.test.ts Jest imports (quick win, +18 tests)
2. Fix foreign key violations in goals/training plans (+15-20 tests)
3. Investigate auth test failures (+15 tests)
4. Target: 80% overall pass rate before Phase 3

**Current Status:** Foundation established, systematic improvements needed
