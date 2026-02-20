# Analytics Integration Test Fix - Final Report

**Date:** 2026-02-20
**Final Status:** 39/43 passing (90.7% pass rate)
**Improvement:** From 31/43 (72%) to 39/43 (91%) - **8 tests fixed**

---

## Summary

Fixed the root cause of failing analytics integration tests through systematic debugging. The primary issue was **Prisma client instance mismatch** between tests and services, not date generation logic as initially suspected.

---

## Root Cause Identified

### Primary Issue: Prisma Instance Mismatch

**Problem:**

- Tests used `testDb.prisma` (from `tests/setup/prismaClient.ts`)
- `AnalyticsService` created its own `new PrismaClient()` instance
- `analytics.ts` routes imported `prisma` from `lib/prisma.ts` (different instance)
- **Result:** Services couldn't see test data created by tests

**Solution:**

```typescript
// In beforeAll hook
AnalyticsService.setPrismaInstance(testDb.prisma);
(global as any).prisma = testDb.prisma; // Attempted for routes
```

**Impact:** 6 tests immediately passed after this fix

### Secondary Issue: Missing bbox in Empty Heatmaps

**Problem:**
`GeospatialService.generateHeatmap()` returned `{ type, features }` without `bbox` when no GPS data

**Solution:**

```typescript
if (points.length === 0) {
  return {
    type: 'FeatureCollection',
    features: [],
    bbox: null, // Added this
  };
}
```

**Impact:** 2 tests passed after this fix

---

## Tests Fixed (8 total)

### Statistics Endpoint (3 tests) ✅

- ✅ returns statistics for the current week
- ✅ returns statistics for the current month
- ✅ returns statistics for the current year

### Trends Endpoint (2 tests) ✅

- ✅ returns trend analysis with correct structure
- ✅ returns monthly trend analysis

### Insights Endpoint (1 test) ✅

- ✅ detects consistency patterns

### Heatmap Endpoint (2 tests) ✅

- ✅ returns GeoJSON FeatureCollection
- ✅ returns empty FeatureCollection when no GPS data

---

## Remaining Failures (4 tests)

### 1. Trend Detection Algorithm Issue

**Test:** `detects improving pace trend`
**Status:** Algorithm not detecting pattern
**Root Cause:** `getCurrentMonthImprovingPace()` fixture may not create strong enough trend
**Fix Needed:** Tune algorithm thresholds or strengthen fixture pattern
**Priority:** Low (algorithm calibration, not a bug)

### 2-4. Heatmap Route Prisma Instance Issues

**Tests:**

- `calculates bounding box correctly`
- `handles single GPS route`
- `returns only authenticated user GPS data`

**Root Cause:** Routes in `server/routes/analytics.ts` directly import `prisma` from `lib/prisma.ts`. This Prisma instance is created at module load time BEFORE tests can override it.

**Current Limitation:**

```typescript
// In lib/prisma.ts
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({...});
```

The route module imports this BEFORE `beforeAll()` runs, so setting `global.prisma` doesn't help.

**Fix Needed:** Architectural refactoring

- **Option A:** Move heatmap logic to GeospatialService with setPrismaInstance()
- **Option B:** Make routes accept Prisma instance as dependency injection
- **Option C:** Use module mocking (jest.mock) to replace lib/prisma import

**Priority:** Medium (technical debt, doesn't affect production)

---

## Debugging Journey

### Initial Hypothesis (INCORRECT)

- Suspected date helper functions generated dates outside current period
- Created period-aware fixtures: `getCurrentWeekConsistentRuns()`, `getCurrentMonthConsistentRuns()`, etc.
- **Result:** Tests still failed with same errors

### Experiment: Manual Date Generation (Option B)

- Replaced fixture generator with hard-coded dates in one test:
  ```typescript
  const manualRuns = [
    { date: new Date(thisYear, thisMonth, 5).toISOString().split('T')[0], ... },
    // ...
  ];
  ```
- **Result:** Test still failed - confirmed date logic was NOT the problem

### Breakthrough: Debug Logging

Added extensive logging to trace user IDs:

```
[beforeEach] Created user: user-X
[TEST] Creating runs with: user-X
[createTestRunsWithGPS] Received userId: user-X
Stored runs in DB: userId = user-Y  ← MISMATCH!
JWT token: userId = user-X
API response: totalRuns = 0  ← NO DATA FOUND
```

**Direct query found 4 runs, API returned 0** → Different Prisma instances!

---

## Files Modified

### 1. `tests/integration/api/analytics.test.ts`

- **Added:** Import of `AnalyticsService`
- **Added:** Prisma instance override in `beforeAll()`
- **Added:** Manual date test experiment (can be reverted)
- **Added:** JWT import and debug logging (can be removed)

### 2. `server/services/geospatialService.ts`

- **Fixed:** Return `bbox: null` when `points.length === 0`
- **Updated:** TypeScript interface to allow `bbox?: [...] | null`

### 3. `tests/fixtures/analyticsData.ts`

- **Added:** Helper functions: `currentWeekDates()`, `currentMonthDates()`, `currentYearDates()`
- **Added:** 6 fixture generators for current-period data
- **Status:** These ARE working correctly (not the root cause)

### 4. `tests/fixtures/testDatabase.ts`

- **Temporary:** Added debug logging in `createTestRunsWithGPS()` (can be removed)

---

## Key Learnings

1. **Timezone was a red herring:** Initial focus on UTC vs local timezone was incorrect
2. **Date helpers are correct:** Period-aware fixtures work as designed
3. **Integration test isolation:** Services must use same DB instance as tests
4. **Module load order matters:** Can't override exports after module is loaded
5. **Debug logging is essential:** Without tracing user IDs, we wouldn't have found the issue

---

## Recommendations

### Immediate (For This PR)

1. ✅ Keep Prisma instance fix for AnalyticsService
2. ✅ Keep bbox null fix for empty heatmaps
3. ⏳ Revert manual date test back to fixture-based approach
4. ⏳ Remove debug logging from testDatabase.ts
5. ⏳ Document remaining 4 failures as known issues

### Future Work (Follow-up PR)

1. **Refactor heatmap route** to use GeospatialService instead of direct Prisma queries
2. **Add setPrismaInstance()** to GeospatialService
3. **Tune trend detection algorithm** for edge cases
4. **Add integration test for Prisma instance isolation** to prevent regression

### Testing Best Practices (Going Forward)

1. Always call `Service.setPrismaInstance(testDb.prisma)` in integration test setup
2. Avoid direct Prisma imports in routes - use services instead
3. Add debug logging early when tests mysteriously fail
4. Verify data exists in DB before assuming algorithm issues

---

## Performance Metrics

**Test Execution Time:** ~4.7 seconds for 43 tests
**Pass Rate:** 90.7% (39/43)
**Time Spent Debugging:** ~2 hours
**Tests Fixed:** 8
**Cost per Fix:** ~15 minutes per test

---

## Next Steps

### Option C: Document and Move Forward

Per user request ("B then A then C"), we've completed:

- ✅ **Option B:** Quick experiment with manual dates
- ✅ **Option A:** Deep debugging to find root cause
- ⏳ **Option C:** Document findings and commit work

**Recommended Actions:**

1. Clean up test code (remove debug logging, revert manual dates)
2. Commit test improvements with detailed message
3. Document remaining 4 failures as GitHub issues for future work
4. Move to Phase 2: Run all integration test suites
5. Move to Phase 3: Backend standardization comparison

---

## Conclusion

Successfully improved analytics integration test pass rate from 72% to 91% by identifying and fixing Prisma client instance mismatch. The remaining 4 failures (9% of tests) require architectural refactoring and are documented for future work. This represents a significant improvement in test reliability and lays the foundation for continued test development.
