# Phase 3 Baseline Assessment Complete

**Date:** 2026-02-26
**Status:** ✅ BASELINE COMPLETE - Ready for Systematic Fixes

---

## Executive Summary

Phase 3 baseline assessment has been completed for all 4 failing test suites. **Total failures: 29 tests** across 180 tests in failing suites (83.3% passing).

**Key Finding**: Auth suite performance is **much better than estimated** - only 3 failures instead of ~15 expected.

---

## Detailed Baseline Results

### Test Suite Breakdown

| Suite                     | Passing | Failing | Skipped | Total   | Pass Rate | Priority |
| ------------------------- | ------- | ------- | ------- | ------- | --------- | -------- |
| **auth.test.ts**          | 34      | 3       | 1       | 38      | 89.5%     | HIGH     |
| **runs.test.ts**          | 22      | 10      | 0       | 32      | 68.8%     | MEDIUM   |
| **goals + trainingPlans** | 94      | 16      | 0       | 110     | 85.5%     | MEDIUM   |
| **TOTAL**                 | **150** | **29**  | **1**   | **180** | **83.3%** | -        |

### Overall Project Status

- **Total Tests**: 269
- **Currently Passing**: 238 (88.5%)
- **Failing (Phase 3 scope)**: 29 (10.8%)
- **Skipped**: 2 (0.7%)

---

## Auth Test Failures (3 tests) - PRIORITY HIGH

### 1. Rate Limiting - Multiple Login Attempts (test 'handles multiple login attempts...')

**File**: `tests/integration/api/auth.test.ts:391-446`

**Failure**:

```
Expected: 401 (Invalid credentials)
Received: 429 (Rate limited)
```

**Root Cause**: Rate limiting state persists across tests in serial execution. The auth rate limit middleware (`authRateLimit`) is applied at the router level, counting ALL requests to `/api/auth/*` from the same IP. Earlier tests in the "Rate Limiting" describe block consume the rate limit budget (default 5 requests per 15 minutes).

**Impact**: Test expects first 5 invalid login attempts to return 401 (unauthorized), but they're getting 429 (rate limited) because previous tests already made requests.

**Fix Strategy**:

- **Option A**: Reset rate limit store between tests (requires accessing express-rate-limit internal store)
- **Option B**: Create isolated test app instances per rate limiting test
- **Option C**: Adjust rate limit configuration for test environment (increase max or decrease window)
- **Recommended**: Option B - Isolated apps per test (cleanest separation)

**Files to Modify**:

- `tests/integration/api/auth.test.ts` - Update Rate Limiting describe block

---

### 2. Rate Limiting - Environment Configuration (test 'verifies rate limiting environment...')

**File**: `tests/integration/api/auth.test.ts:448-461`

**Failure**:

```
Expected: NOT 429 (single request should not be rate limited)
Received: 429 (Rate limited)
```

**Root Cause**: Same as #1 - shared rate limit state from previous tests.

**Fix Strategy**: Same as #1 - Part of the rate limiting state management solution.

**Files to Modify**:

- `tests/integration/api/auth.test.ts` - Same fix as #1

---

### 3. Token Rotation Security Issue (test 'invalidates old refresh token...')

**File**: `tests/integration/api/auth.test.ts:589-615`

**Failure**:

```
Expected: 401 (Old refresh token should be invalid)
Received: 200 (Old token still works - SECURITY ISSUE)
```

**Root Cause**: The `/api/auth/refresh` endpoint generates NEW tokens but does NOT invalidate the old refresh token. Old refresh tokens remain valid JWTs and can be reused indefinitely. There's no blacklist or database tracking.

**Impact**: **SECURITY VULNERABILITY** - Compromised refresh tokens can be used even after "rotation".

**Fix Strategy**:

- **Option A**: Store refresh tokens in database with `used` flag
- **Option B**: Maintain in-memory blacklist of invalidated tokens
- **Option C**: Add `tokenVersion` field to User model, increment on refresh
- **Recommended**: Option C - Token versioning (most elegant, no blacklist needed)

**Implementation**:

1. Add `tokenVersion` Int field to User model in Prisma schema
2. Create migration: `npx prisma migrate dev --name add_token_version`
3. Update `/api/auth/refresh` endpoint to:
   - Verify token version matches user's current version
   - Increment user's tokenVersion in database after refresh
   - Include tokenVersion in new refresh JWT
4. Update token verification to check tokenVersion

**Files to Modify**:

- `prisma/schema.prisma` - Add `tokenVersion Int @default(0)` to User model
- `routes/auth.ts` - Update `/register`, `/refresh` endpoints
- Database migration file (auto-generated)

---

## Runs Test Failures (10 tests) - PRIORITY MEDIUM

**File**: `tests/integration/api/runs.test.ts`

**Baseline Output**: `/tmp/runs-phase3-baseline.txt`

**Summary**: 22/32 passing (68.8%)

**Failure Categories** (needs investigation):

- Validation issues (maximum length strings, special characters)
- Edge case handling (negative values, zero values)
- Database error handling
- Date handling

**Next Steps**: Run individual failing tests to identify specific issues.

---

## Goals + TrainingPlans Test Failures (16 tests) - PRIORITY MEDIUM

**Files**:

- `tests/integration/api/goals.test.ts`
- `tests/integration/api/trainingPlans.test.ts`

**Baseline Output**: `/tmp/goals-plans-phase3-baseline.txt`

**Summary**: 94/110 passing (85.5%)

**Failure Categories** (needs investigation):

- Missing `targetValue` property in API responses
- Progress calculation issues
- Error status codes (getting 200 instead of expected error codes)
- Date handling

**Next Steps**: Run individual failing tests to identify specific issues.

---

## Recommended Phase 3 Execution Plan

### Step 1: Fix Auth Tests (3 tests) - PRIORITY HIGH

**Estimated Time**: 2-3 hours

**Tasks**:

1. **Rate Limiting Fixes** (2 tests):
   - Implement isolated test app pattern for rate limiting tests
   - Or: Add rate limit store reset mechanism
   - Test and verify both rate limiting tests pass

2. **Token Rotation Security Fix** (1 test):
   - Add `tokenVersion` field to User model (migration)
   - Update auth endpoints to use token versioning
   - Test and verify token rotation works correctly
   - Run all auth tests to ensure no regressions

**Success Criteria**: auth.test.ts shows 37/38 passing (97.4%)

---

### Step 2: Fix Runs Tests (10 tests) - PRIORITY MEDIUM

**Estimated Time**: 3-4 hours

**Tasks**:

1. Investigate each failing test individually
2. Categorize failures (validation, logic, error handling)
3. Fix issues systematically
4. Run full runs.test.ts after each fix
5. Verify no regressions

**Success Criteria**: runs.test.ts shows 32/32 passing (100%)

---

### Step 3: Fix Goals + TrainingPlans Tests (16 tests) - PRIORITY MEDIUM

**Estimated Time**: 4-5 hours

**Tasks**:

1. Investigate failing tests individually
2. Focus on `targetValue` missing property issue first (likely affects multiple tests)
3. Fix progress calculation issues
4. Fix error status code issues
5. Run full test suites after each fix
6. Verify no regressions

**Success Criteria**: goals.test.ts + trainingPlans.test.ts shows 110/110 passing (100%)

---

### Step 4: Comprehensive Verification

**Tasks**:

1. Run complete integration test suite: `npm run test:integration`
2. Verify final pass rate: 269/269 (100%) or very close
3. Run 5 consecutive test runs to verify stability
4. Confirm no worker process warnings

**Success Criteria**:

- ✅ All integration tests passing
- ✅ < 2% variance across multiple runs
- ✅ No flakiness or race conditions
- ✅ No open handles or worker warnings

---

## Key Files and Baseline Data

### Baseline Test Outputs

- `/tmp/auth-phase3-baseline.txt` - Auth test full output
- `/tmp/runs-phase3-baseline.txt` - Runs test full output
- `/tmp/goals-plans-phase3-baseline.txt` - Goals + TrainingPlans test full output

### Critical Files for Fixes

**Auth Fixes**:

- `tests/integration/api/auth.test.ts` (lines 333-461, 589-615)
- `routes/auth.ts` (lines 166-226)
- `server/middleware/rateLimiting.ts`
- `prisma/schema.prisma` (User model)

**Runs Fixes**:

- `tests/integration/api/runs.test.ts`
- `routes/runs.ts`

**Goals/TrainingPlans Fixes**:

- `tests/integration/api/goals.test.ts`
- `tests/integration/api/trainingPlans.test.ts`
- `routes/goals.ts`
- `routes/trainingPlans.ts`

---

## Risk Assessment

### Low Risk Fixes

- Rate limiting test isolation (isolated scope)
- Validation fixes (add missing checks)
- Response format fixes (add missing properties)

### Medium Risk Fixes

- Token rotation (security-critical, requires migration)
- Progress calculations (business logic)

### Mitigation

- Test each fix in isolation
- Run full test suite after each change
- Use git commits to isolate changes
- Keep fixes small and focused

---

## Success Metrics

### Phase 3 Target

- **Fix all 29 failing tests**
- **Achieve 100% or near-100% pass rate**
- **Maintain test stability** (< 2% variance)
- **No new regressions**

### Current vs Target

| Metric        | Current (Phase 2) | Target (Phase 3) |
| ------------- | ----------------- | ---------------- |
| Pass Rate     | 88.5% (238/269)   | 100% (269/269)   |
| Failing Tests | 29                | 0                |
| Stability     | Stable (serial)   | Stable (serial)  |

---

## Next Actions

1. **User Review**: Review this document and approve approach
2. **Begin Auth Fixes**: Start with auth.test.ts (highest priority, only 3 failures)
3. **Systematic Progression**: Move through runs → goals/trainingPlans
4. **Document & Commit**: Clear commit messages for each fix
5. **Final Verification**: Comprehensive test run and stability check

---

**Prepared By**: Claude Code
**Baseline Completed**: 2026-02-26
**Ready for Phase 3 Implementation**: ✅ YES
