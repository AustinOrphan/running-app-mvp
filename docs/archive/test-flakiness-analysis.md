# Integration Test Flakiness Analysis

**Date:** 2026-02-25
**Baseline:** 187/269 passing (69.5%)

## Problem Summary

Integration tests exhibit significant flakiness with pass rates varying by ~5-7% between consecutive runs (177-190 passing tests observed).

## Root Causes Identified

### 1. Test Worker Exit Issues

```
A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown.
```

**Recommendation:** Run with `--detectOpenHandles` to identify resource leaks.

### 2. Shared Database State

Tests running in parallel may interfere with each other through shared test database state.

### 3. Timing Dependencies

Some tests have race conditions or timing assumptions that fail intermittently:

- Rate limiting tests hitting actual rate limits
- Volume spike tests with date-based data generation
- Concurrent error load tests

## Test Stability Observations

**Multiple sequential runs (clean database each time):**

| Run | Passing | Failing | Percentage |
| --- | ------- | ------- | ---------- |
| 1   | 186     | 82      | 69.1%      |
| 2   | 182     | 86      | 67.7%      |
| 3   | 187     | 81      | 69.5%      |
| 4   | 190     | 78      | 70.6%      |
| 5   | 183     | 85      | 68.0%      |
| 6   | 182     | 86      | 67.7%      |
| 7   | 177     | 91      | 65.8%      |

**Variability:** 13 tests (5% swing)

## Stable Failures (Deterministic)

These failures appear consistently across all runs:

### Single-Test Failures (High Priority)

1. **ErrorHandling** (17/18): "should handle extremely large concurrent error load"
   - Expected: 200
   - Received: 429 (rate limit)
   - **Issue:** Test sends too many requests, hits rate limiter

2. **Stats** (19/20): "handles database errors gracefully"
   - Expected: 500
   - Received: 200
   - **Issue:** Database error not properly triggered or caught

3. **Races** (7/8): "returns 404 for unknown race"
   - Expected: 404
   - Received: 400
   - **Issue:** Validation error before not-found check

### Multi-Test Failures

- **Auth** (34/38): 4 failures - mix of rate limiting and token handling
- **Goals** (39/45): 6 failures - TBD
- **Runs** (22/32): 10 failures - TBD
- **TrainingPlans** (55/65): 10 failures - TBD

## Recommendations

### Immediate Actions

1. **Fix deterministic single-test failures first** (ErrorHandling, Stats, Races)
2. **Add test isolation improvements**:
   - Ensure proper database cleanup between tests
   - Use unique test data per test (no shared state)
   - Add explicit async cleanup in afterEach/afterAll hooks

### Medium-Term Improvements

1. Run tests with `--detectOpenHandles --forceExit` to identify leaks
2. Consider running suites sequentially (`--runInBand`) for debugging
3. Add explicit timeouts to tests with timing dependencies
4. Mock rate limiters in tests (don't test actual rate limiting behavior)

### Test Quality Metrics

- Target stability: < 2% variance between runs
- Current stability: ~5% variance (needs improvement)
- Flaky test threshold: Fails more than once in 10 consecutive runs

## Next Steps

1. Fix ErrorHandling rate limit test (disable rate limiting for this test)
2. Fix Stats database error test (verify mock/error injection)
3. Fix Races 404 test (reorder validation vs not-found checks)
4. Run 10 consecutive tests to measure stability improvement
5. Address multi-test failures by suite priority (Auth → Goals → Runs → TrainingPlans)

## Notes

- Analytics suite (43/43, 100%) is stable after recent fix
- Test flakiness is a BLOCKER for reaching 80% goal reliably
- Need to distinguish between "flaky" and "broken" tests
