# Phase 3 Test Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 29 failing integration tests across auth, runs, goals, and trainingPlans test suites to achieve 100% test pass rate.

**Architecture:** Systematic test-driven fixes starting with auth (3 failures), then runs (10 failures), then goals/trainingPlans (16 failures). Each fix verified immediately to prevent regressions.

**Tech Stack:** Jest, Supertest, Prisma, Express, JWT, express-rate-limit

**Current Status:** 238/269 tests passing (88.5%)
**Target Status:** 269/269 tests passing (100%)

---

## Prerequisites

**Baseline Data Available:**

- `/tmp/auth-phase3-baseline.txt` - Auth test failures
- `/tmp/runs-phase3-baseline.txt` - Runs test failures
- `/tmp/goals-plans-phase3-baseline.txt` - Goals/TrainingPlans failures
- `docs/phase3-baseline-complete.md` - Detailed analysis

**Test Execution:**

```bash
# Run specific suite
npm run test:integration -- auth.test.ts

# Run specific test
npm run test:integration -- auth.test.ts -t "test name"

# Run all integration tests
npm run test:integration
```

---

## Task 1: Fix Auth Rate Limiting - Isolated Test Apps

**Problem:** Rate limiting state persists across tests, causing early 429 responses.

**Files:**

- Modify: `tests/integration/api/auth.test.ts:333-461`

**Step 1: Read the current Rate Limiting describe block**

Read: `tests/integration/api/auth.test.ts` lines 333-461

Expected: See how rate limiting tests are structured

**Step 2: Refactor to use isolated app instances per test**

Modify the Rate Limiting describe block to create fresh Express app instances for each test:

```typescript
describe('Rate Limiting', () => {
  let originalRateLimitingEnabled: string | undefined;

  beforeAll(() => {
    originalRateLimitingEnabled = process.env.RATE_LIMITING_ENABLED;
    process.env.RATE_LIMITING_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalRateLimitingEnabled === undefined) {
      delete process.env.RATE_LIMITING_ENABLED;
    } else {
      process.env.RATE_LIMITING_ENABLED = originalRateLimitingEnabled;
    }
  });

  // Helper to create isolated app for rate limiting tests
  const createIsolatedApp = () => {
    const isolatedApp = express();
    isolatedApp.use(cors());
    isolatedApp.use(express.json());
    isolatedApp.use('/api/auth', authRoutes);
    isolatedApp.use(errorHandler);
    return isolatedApp;
  };

  it('handles multiple registration attempts and triggers rate limit', async () => {
    // Create fresh app instance to avoid rate limit state from other tests
    const isolatedApp = createIsolatedApp();

    expect(process.env.RATE_LIMITING_ENABLED).toBe('true');

    const responses: request.Response[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await request(isolatedApp)
        .post('/api/auth/register')
        .send({
          email: `ratelimit${i}@test.com`,
          password: 'Test@password123',
        });
      responses.push(response);
    }

    for (let i = 0; i < 5; i++) {
      expect(responses[i].status).not.toBe(429);
    }

    const rateLimitedResponse = await request(isolatedApp).post('/api/auth/register').send({
      email: 'ratelimited@test.com',
      password: 'Test@password123',
    });

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body).toHaveProperty('message');
    expect(rateLimitedResponse.body.message).toMatch(/too many.*attempts/i);
    expect(rateLimitedResponse.headers).toHaveProperty('retry-after');
    expect(rateLimitedResponse.body).toHaveProperty('status', 429);
    expect(rateLimitedResponse.body).toHaveProperty('retryAfter');
  });

  it('handles multiple login attempts with invalid credentials and triggers rate limit', async () => {
    // Create fresh app instance
    const isolatedApp = createIsolatedApp();

    const testUser = await testDb.createTestUser({
      email: 'bruteforce@test.com',
      password: 'correctpassword',
    });

    const responses: request.Response[] = [];

    for (let i = 0; i < 5; i++) {
      const response = await request(isolatedApp)
        .post('/api/auth/login')
        .send({
          email: assertTestUser(testUser).email,
          password: 'wrongpassword',
        });
      responses.push(response);
    }

    // First 5 attempts should fail with 401, not 429
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid credentials');
    }

    // 6th attempt should trigger rate limit
    const rateLimitedResponse = await request(isolatedApp)
      .post('/api/auth/login')
      .send({
        email: assertTestUser(testUser).email,
        password: 'wrongpassword',
      });

    expect(rateLimitedResponse.status).toBe(429);
    expect(rateLimitedResponse.body).toHaveProperty('message');
    expect(rateLimitedResponse.body.message).toMatch(/too many.*attempts/i);
    expect(rateLimitedResponse.headers).toHaveProperty('retry-after');
    expect(rateLimitedResponse.body).toHaveProperty('status', 429);
    expect(rateLimitedResponse.body).toHaveProperty('retryAfter');

    // Correct password should also be rate limited
    const correctPasswordResponse = await request(isolatedApp)
      .post('/api/auth/login')
      .send({
        email: assertTestUser(testUser).email,
        password: 'correctpassword',
      });

    expect(correctPasswordResponse.status).toBe(429);
    expect(correctPasswordResponse.body).toHaveProperty('message');
    expect(correctPasswordResponse.body.message).toMatch(/too many.*attempts/i);
    expect(correctPasswordResponse.headers).toHaveProperty('retry-after');
    expect(correctPasswordResponse.body).toHaveProperty('status', 429);
    expect(correctPasswordResponse.body).toHaveProperty('retryAfter');
  });

  it('verifies rate limiting environment is properly configured', async () => {
    // Create fresh app instance
    const isolatedApp = createIsolatedApp();

    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.RATE_LIMITING_ENABLED).toBe('true');

    const singleResponse = await request(isolatedApp).post('/api/auth/register').send({
      email: 'single@test.com',
      password: 'Test@password123',
    });

    // Should succeed (201) or fail for business reasons (400), but not be rate limited (429)
    expect(singleResponse.status).not.toBe(429);
  });
});
```

**Step 3: Run rate limiting tests to verify they pass**

Run: `npm run test:integration -- auth.test.ts -t "Rate Limiting"`

Expected: All 3 rate limiting tests should now PASS

**Step 4: Run full auth test suite to check for regressions**

Run: `npm run test:integration -- auth.test.ts`

Expected: Should see 36/38 passing (2 remaining failures: 1 skipped + 1 token rotation)

**Step 5: Commit rate limiting fix**

```bash
git add tests/integration/api/auth.test.ts
git commit -m "fix(tests): isolate rate limiting tests with fresh app instances

- Create isolated Express app per rate limiting test
- Prevents rate limit state contamination between tests
- Fixes 2 rate limiting test failures

Tests: auth.test.ts now 36/38 passing (89.5% -> 94.7%)"
```

---

## Task 2: Fix Auth Token Rotation Security Issue

**Problem:** Old refresh tokens remain valid after rotation (security vulnerability).

**Files:**

- Modify: `prisma/schema.prisma` - Add tokenVersion field
- Modify: `routes/auth.ts:40-90, 166-226` - Update register/refresh endpoints
- Create: Migration file (auto-generated)

**Step 1: Add tokenVersion field to User model**

Modify `prisma/schema.prisma`:

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  password      String
  tokenVersion  Int      @default(0)  // Add this line
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  runs          Run[]
  goals         Goal[]
  races         Race[]
  trainingPlans TrainingPlan[]
}
```

**Step 2: Create and apply migration**

Run: `npx prisma migrate dev --name add_token_version`

Expected: Migration created and applied successfully

**Step 3: Generate Prisma client**

Run: `npx prisma generate`

Expected: Prisma client regenerated with tokenVersion field

**Step 4: Update auth routes to use token versioning**

Modify `routes/auth.ts` - Update register endpoint (around line 73-79):

```typescript
// In /register endpoint, after creating user
const accessToken = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
  expiresIn: '15m',
});

const refreshToken = jwt.sign(
  { id: user.id, type: 'refresh', version: user.tokenVersion }, // Add version
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);
```

Modify `/refresh` endpoint (lines 166-226):

```typescript
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw createUnauthorizedError('Refresh token required');
    }

    if (!process.env.JWT_SECRET) {
      throw createError('JWT secret not configured', 500);
    }

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET) as {
        id: string;
        type: string;
        version?: number; // Add version field
      };

      // Check if this is actually a refresh token
      if (decoded.type !== 'refresh') {
        throw createUnauthorizedError('Invalid refresh token');
      }

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, tokenVersion: true }, // Include tokenVersion
      });

      if (!user) {
        throw createUnauthorizedError('User not found');
      }

      // Verify token version matches user's current version
      if (decoded.version !== user.tokenVersion) {
        throw createUnauthorizedError('Invalid refresh token');
      }

      // Increment token version to invalidate all existing refresh tokens
      await prisma.user.update({
        where: { id: user.id },
        data: { tokenVersion: user.tokenVersion + 1 },
      });

      // Generate new access token
      const newAccessToken = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      // Generate new refresh token with incremented version
      const newRefreshToken = jwt.sign(
        { id: user.id, type: 'refresh', version: user.tokenVersion + 1 },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      logUserAction('Token refresh', req, { userId: user.id });

      res.json({
        message: 'Tokens refreshed successfully',
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw createUnauthorizedError('Invalid refresh token');
      }
      throw error;
    }
  })
);
```

**Step 5: Run token rotation test to verify it passes**

Run: `npm run test:integration -- auth.test.ts -t "invalidates old refresh token"`

Expected: Test should now PASS (old token gets 401)

**Step 6: Run full auth test suite to check for regressions**

Run: `npm run test:integration -- auth.test.ts`

Expected: Should see 37/38 passing (97.4% - only 1 skipped test remains)

**Step 7: Commit token rotation security fix**

```bash
git add prisma/schema.prisma routes/auth.ts prisma/migrations/
git commit -m "feat(auth): implement token rotation with version tracking

- Add tokenVersion field to User model
- Increment version on each token refresh
- Invalidate old refresh tokens by checking version
- Fixes critical security vulnerability

Security: Old refresh tokens now properly invalidated
Tests: auth.test.ts now 37/38 passing (94.7% -> 97.4%)"
```

**Step 8: Verify auth test suite final status**

Run: `npm run test:integration -- auth.test.ts`

Expected: `Tests: 1 skipped, 37 passed, 38 total` (97.4% pass rate)

---

## Task 3: Investigate and Fix Runs Test Failures

**Problem:** 10 failing tests in runs.test.ts (68.8% pass rate).

**Files:**

- Read: `/tmp/runs-phase3-baseline.txt` - Full failure details
- Modify: `tests/integration/api/runs.test.ts` - Tests
- Modify: `routes/runs.ts` - Backend logic
- Modify: `server/middleware/validation.ts` - Validation logic

**Step 1: Read baseline output to identify specific failures**

Read: `/tmp/runs-phase3-baseline.txt`

Expected: List of 10 specific failing test names and error messages

**Step 2: Run runs tests individually to understand failures**

Run: `npm run test:integration -- runs.test.ts 2>&1 | grep -A 10 "●"`

Expected: Detailed failure output for each of the 10 tests

**Step 3: Categorize failures by type**

Create categorization:

- Validation failures (e.g., max length, special characters)
- Edge case failures (e.g., negative values, zero values)
- Error handling failures (e.g., wrong status codes)
- Data integrity failures (e.g., missing fields)

**Step 4: Fix validation failures first (highest priority)**

For each validation failure, follow pattern:

1. Identify the validation rule that's missing/incorrect
2. Add/fix validation in routes/runs.ts or middleware/validation.ts
3. Run the specific test to verify fix
4. Commit the fix

**Step 5: Fix edge case failures**

For each edge case failure:

1. Identify the edge case not being handled
2. Add handling logic in routes/runs.ts
3. Run the specific test to verify fix
4. Commit the fix

**Step 6: Fix error handling failures**

For each error handling failure:

1. Identify incorrect error response
2. Fix status code/message in routes/runs.ts
3. Run the specific test to verify fix
4. Commit the fix

**Step 7: Run full runs test suite**

Run: `npm run test:integration -- runs.test.ts`

Expected: `Tests: 32 passed, 32 total` (100% pass rate)

**Step 8: Run full integration suite to check for regressions**

Run: `npm run test:integration`

Expected: No regressions in other suites

---

## Task 4: Investigate and Fix Goals/TrainingPlans Test Failures

**Problem:** 16 failing tests across goals.test.ts and trainingPlans.test.ts (85.5% pass rate).

**Files:**

- Read: `/tmp/goals-plans-phase3-baseline.txt` - Full failure details
- Modify: `tests/integration/api/goals.test.ts` - Tests
- Modify: `tests/integration/api/trainingPlans.test.ts` - Tests
- Modify: `routes/goals.ts` - Backend logic
- Modify: `routes/trainingPlans.ts` - Backend logic

**Step 1: Read baseline output to identify specific failures**

Read: `/tmp/goals-plans-phase3-baseline.txt`

Expected: List of 16 specific failing test names and error messages

**Step 2: Run combined test to understand failures**

Run: `npm run test:integration -- goals.test.ts trainingPlans.test.ts 2>&1 | grep -A 10 "●"`

Expected: Detailed failure output for each of the 16 tests

**Step 3: Identify common pattern - missing targetValue property**

From baseline analysis, many failures involve missing `targetValue` in API responses.

**Step 4: Fix missing targetValue in goals responses**

Modify `routes/goals.ts` to include targetValue in response objects:

```typescript
// Example pattern - apply to all goal response builders
res.json({
  id: goal.id,
  title: goal.title,
  targetValue: goal.targetValue, // Ensure this is included
  currentValue: goal.currentValue,
  // ... other fields
});
```

**Step 5: Run goals tests to verify targetValue fix**

Run: `npm run test:integration -- goals.test.ts`

Expected: Several tests should now pass with targetValue included

**Step 6: Fix remaining goals failures (progress calculations, error codes)**

For each remaining failure:

1. Identify the specific issue
2. Fix in routes/goals.ts
3. Run test to verify
4. Commit fix

**Step 7: Fix trainingPlans failures**

For each trainingPlans failure:

1. Identify the specific issue
2. Fix in routes/trainingPlans.ts
3. Run test to verify
4. Commit fix

**Step 8: Run combined goals/trainingPlans test suite**

Run: `npm run test:integration -- goals.test.ts trainingPlans.test.ts`

Expected: `Tests: 110 passed, 110 total` (100% pass rate)

**Step 9: Run full integration suite to check for regressions**

Run: `npm run test:integration`

Expected: No regressions

---

## Task 5: Final Verification and Documentation

**Goal:** Verify 100% test pass rate and document Phase 3 completion.

**Files:**

- Create: `docs/phase3-completion-summary.md`
- Modify: `docs/phase3-readiness.md` - Update with completion status

**Step 1: Run full integration test suite**

Run: `npm run test:integration`

Expected: `Tests: 269 passed, 269 total` (100% pass rate)

**Step 2: Run 5 consecutive test runs to verify stability**

Run:

```bash
for i in {1..5}; do
  echo "=== Run $i ==="
  npm run test:integration | grep "Tests:"
done
```

Expected: All 5 runs show 269/269 passing with < 2% variance

**Step 3: Create Phase 3 completion summary**

Create `docs/phase3-completion-summary.md`:

```markdown
# Phase 3 Completion Summary

**Date:** 2026-02-26
**Status:** ✅ COMPLETE

## Results

- **Starting:** 238/269 tests passing (88.5%)
- **Ending:** 269/269 tests passing (100%)
- **Fixed:** 29 tests across 4 suites
- **Stability:** < 2% variance across 5 consecutive runs

## Fixes Implemented

### Auth Tests (3 fixes)

1. Rate limiting isolation - Isolated Express app instances
2. Token rotation security - Added tokenVersion tracking

### Runs Tests (10 fixes)

[List specific fixes]

### Goals/TrainingPlans Tests (16 fixes)

[List specific fixes]

## Commits

[List all commit SHAs with messages]

## Verification

- ✅ All 269 tests passing
- ✅ Stable across multiple runs
- ✅ No worker process warnings
- ✅ No open handles

**Phase 3 Complete!** 🎉
```

**Step 4: Update phase3-readiness.md with completion status**

Modify `docs/phase3-readiness.md`:

- Change status to "COMPLETE"
- Add completion date
- Add link to completion summary

**Step 5: Commit documentation**

```bash
git add docs/phase3-completion-summary.md docs/phase3-readiness.md
git commit -m "docs: Phase 3 test fixes complete - 100% pass rate achieved

- Fixed all 29 failing tests
- Auth: 37/38 passing (97.4%)
- Runs: 32/32 passing (100%)
- Goals+TrainingPlans: 110/110 passing (100%)
- Overall: 269/269 passing (100%)

Phase 3 complete!"
```

**Step 6: Push all changes**

Run: `git push origin main`

Expected: All Phase 3 commits pushed successfully

---

## Success Criteria

- [ ] Auth tests: 37/38 passing (97.4%)
- [ ] Runs tests: 32/32 passing (100%)
- [ ] Goals tests: Passing (part of 110/110)
- [ ] TrainingPlans tests: Passing (part of 110/110)
- [ ] Overall: 269/269 passing (100%)
- [ ] Stability: < 2% variance across 5 runs
- [ ] No worker warnings
- [ ] All changes committed with clear messages
- [ ] Documentation updated

---

## Notes

**Task Granularity:**
Tasks 1-2 are fully detailed (auth fixes). Tasks 3-4 require investigation first since exact failures aren't fully analyzed yet. This follows TDD: understand the failure, write/fix the code, verify the fix.

**Commit Strategy:**

- Commit after each logical fix (not after each task)
- Keep commits atomic and focused
- Include test results in commit messages

**Testing Strategy:**

- Run specific test after each fix
- Run full suite after each task
- Verify no regressions before moving forward

**Reference Skills:**

- @superpowers:systematic-debugging for investigating test failures
- @superpowers:verification-before-completion before final push
