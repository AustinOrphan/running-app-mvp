# Analytics Integration Test Fix - Progress Report

**Date:** 2026-02-20
**Status:** IN PROGRESS (31/43 passing, same as before)
**Issue:** Date generation logic needs debugging

---

## Work Completed

### 1. Created Period-Aware Date Helpers ✅

Added three new helper functions to `tests/fixtures/analyticsData.ts`:

```typescript
// Get dates within current week (Monday - Sunday)
const currentWeekDates = (count: number): string[]

// Get dates within current month
const currentMonthDates = (count: number): string[]

// Get dates within current year
const currentYearDates = (count: number): string[]
```

These helpers generate YYYY-MM-DD strings for dates that fall within the current period to match analytics API filtering logic.

### 2. Created Current-Period Fixture Generators ✅

Added 6 new fixture generator functions (as functions, not IIFEs):

1. `getCurrentWeekConsistentRuns()` - 4 runs in current week
2. `getCurrentMonthConsistentRuns()` - 12 runs in current month
3. `getCurrentMonthImprovingPace()` - 10 runs with improving pace trend
4. `getCurrentYearConsistentRuns()` - 50 runs spread across current year
5. `getCurrentMonthVolumeSpike()` - 16 runs with volume spike in last 2 weeks
6. `getCurrentMonthVariedLocations()` - 9 runs in 3 cities for heatmap

**Key Decision:** Made these functions instead of constants so dates are calculated at test runtime, not module load time.

### 3. Updated Test File to Use New Fixtures ✅

Updated `tests/integration/api/analytics.test.ts`:

- Imported the new generator functions
- Updated 7 test locations to call the generators
- Statistics tests (weekly/monthly/yearly)
- Trends beforeEach hook
- Insights tests (consistency/volume/performance)
- Heatmap beforeEach hook

---

## Current Problem

### Test Results: Still 12 Failing Tests

```
Tests:       12 failed, 31 passed, 43 total
```

**Failing Tests:**
1. `calculates correct aggregations` (weekly) - totalRuns = 0
2. `returns statistics for the current month` - totalRuns = 0
3. `returns statistics for the current year` - totalRuns = 0
4. `detects improving pace trend` - paceTrend = "stable" (expected "improving")
5. `detects consistency patterns` - no consistency insight found
6. `detects volume spikes` - no volume insight found
7. `detects pace improvements` - no performance insight found
8. `returns GeoJSON FeatureCollection` - missing bbox property
9. `calculates bounding box correctly` - bbox validation fails
10-12. Additional heatmap edge case failures

### Root Cause Analysis

**Issue 1: No Data Found (totalRuns = 0)**

The analytics service filters runs by date range:

```typescript
// From server/services/analyticsService.ts
const runs = await prisma.run.findMany({
  where: {
    userId,
    date: {
      gte: startOfMonth(now),  // date-fns function
      lte: endOfMonth(now),    // date-fns function
    },
  },
});
```

Our fixtures create dates as strings like "2026-02-20", which get converted to Date objects via:

```typescript
// From tests/fixtures/testDatabase.ts
const createdRun = await prisma.run.create({
  data: {
    date: new Date(run.date), // String → Date conversion
    // ...
  },
});
```

**Potential Problems:**

1. **Timezone Mismatch:** `new Date("2026-02-20")` creates midnight UTC, but `date-fns` functions like `startOfMonth(now)` use local timezone
2. **Boundary Conditions:** Dates at the exact boundary of periods might be excluded
3. **Date Helper Logic Errors:** The calculation in `currentMonthDates()` or `currentYearDates()` might have off-by-one errors or generate dates outside the period

**Issue 2: Insights Not Generated**

Even when data exists, the analytics algorithms don't detect the expected patterns. This could mean:

1. Not enough data points for the algorithm's thresholds
2. Data pattern not strong enough (e.g., pace improvement too gradual)
3. Algorithm looking at wrong time window

---

## Investigation Needed

### Debug Steps to Take

1. **Verify Date Helper Output**
   - Add console.log to see what dates are actually generated
   - Check if dates fall within current period as expected
   - Example: On 2026-02-20, currentMonthDates(12) should generate 12 dates in February

2. **Verify Database Storage**
   - Log the actual dates stored in the database
   - Check timezone of stored dates vs. query date ranges
   - Query database directly to see if runs exist

3. **Test Date Comparison Logic**
   - Create minimal test case: insert one run with known date, query with date range
   - Verify Prisma date comparison works as expected

4. **Fix or Simplify Approach**

   **Option A:** Fix date helpers to use Date objects
   ```typescript
   const currentWeekDates = (count: number): Date[] => {
     // Return Date objects instead of strings
   };
   ```

   **Option B:** Use date-fns in fixtures to match service
   ```typescript
   import { startOfWeek, addDays } from 'date-fns';

   const dates = Array.from({length: 4}, (_, i) =>
     addDays(startOfWeek(new Date(), {weekStartsOn: 1}), i)
   );
   ```

   **Option C:** Simplify by creating dates relative to "now" in each test
   ```typescript
   const today = new Date();
   const runs = [
     { date: today.toISOString().split('T')[0], ... },
     // ...
   ];
   ```

---

## Recommended Next Steps

### Immediate (Same Session)

1. **Quick Win:** Try Option C (manual dates in each test) for one failing test to verify the approach works
2. **If successful:** Update all failing tests with manual date generation
3. **Run tests again** to see if this resolves the issue

### Alternative (New Session)

1. **Deep Dive:** Use sequential thinking to analyze date-fns vs. our helpers
2. **Implement Option B:** Use date-fns in fixtures to guarantee alignment
3. **Add logging:** Temporarily add console.log to see exact dates being generated and queried

---

## Files Modified

1. `tests/fixtures/analyticsData.ts` - Added helpers and generators
2. `tests/integration/api/analytics.test.ts` - Updated fixture usage

---

## Next Actions

**Decision Point:** Should we:

A. **Continue debugging** date logic (could take another 30-60 min)
B. **Document current state** and move to Phase 2 (run all integration tests for JWT impact)
C. **Simplify approach** by reverting to manual date creation in each test

**Recommendation:** Try Option C (manual dates) as a quick experiment on one test to validate the approach, then decide whether to continue or document and move on.
