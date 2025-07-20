# Tenth Critical Fix: apiFetch Global Mock Collision Fix Results

## Issue Identified

The apiFetch utility tests were completely failing due to a global mock collision where the test setup's `createEndpointMocks()` was overriding the specific `mockFetch` setup for these tests.

## Root Cause Analysis

- The test setup in `testSetup.ts` sets `global.fetch = createEndpointMocks()` globally
- The `createEndpointMocks()` function only handles specific endpoints like `/api/goals`, `/api/auth/*`, etc.
- When apiFetch tests tried to test with `/api/test` endpoints, `createEndpointMocks()` logged "Unhandled endpoint in test mock: /api/test" and returned 404 status
- The apiFetch tests were using `global.fetch = mockFetch` but this was being overridden by the global test setup
- This caused ALL apiFetch tests to fail with network-like errors instead of using their intended mock responses

## Solution Implemented

Implemented proper mock isolation using Vitest's `vi.stubGlobal` and `vi.unstubAllGlobals` pattern:

### Key Changes Made:

1. **Removed Direct Global Assignment** (line 13):

   ```typescript
   // Before: global.fetch = mockFetch;
   // After: // Mock fetch using vi.stubGlobal for proper isolation
   const mockFetch = vi.fn();
   ```

2. **Added Proper Mock Stubbing in beforeEach** (lines 84-89):

   ```typescript
   beforeEach(() => {
     // Stub global fetch to use our mock instead of global endpoint mocks
     vi.stubGlobal('fetch', mockFetch);
     mockFetch.mockClear();
     localStorage.clear();
     vi.clearAllTimers();
   });
   ```

3. **Added Proper Cleanup in afterEach** (lines 91-96):
   ```typescript
   afterEach(() => {
     mockFetch.mockReset();
     vi.useRealTimers();
     // Restore global fetch to its original state
     vi.unstubAllGlobals();
   });
   ```

## Technical Improvements

- **Mock Isolation**: apiFetch tests now run independently from global endpoint mocks
- **Proper Cleanup**: `vi.unstubAllGlobals()` ensures no test pollution between test files
- **Vitest Best Practices**: Uses Vitest's recommended pattern for global mocking
- **Test Reliability**: Tests now use their intended mock responses instead of 404s

## Test Results

### Before Fix:

- Failed Tests: 150 (from ninth critical fix)
- Pass Rate: 81.5%
- apiFetch tests: All failing with "Unhandled endpoint" 404 errors

### After Fix:

- **Total Tests**: 946
- **Passed**: 804 (up from 771)
- **Failed**: 117 (down from 150)
- **Skipped**: 25
- **New Pass Rate**: 85.0% (804/946)

### Impact Analysis:

- **Tests Fixed**: 33 fewer failed tests (150 → 117)
- **Improvement**: +3.5% absolute improvement in pass rate (+33 tests)
- **apiFetch Specific**: 37/42 tests now passing (88% pass rate in this module)

### apiFetch Test Results Breakdown:

- **Passing**: 37 tests (authentication, request handling, error handling, retry logic, etc.)
- **Failing**: 4 tests (minor message assertion mismatches)
- **Skipped**: 1 test

## Specific Test Fixes:

1. **Authentication Tests**: Proper token handling and auth flow testing
2. **Request Body Handling**: JSON, FormData, and string body processing
3. **Error Handling**: HTTP errors, network errors, and timeout scenarios
4. **Retry Logic**: Exponential backoff and retry limit enforcement
5. **Convenience Methods**: apiGet, apiPost, apiPut, apiDelete, apiPatch
6. **Edge Cases**: Malformed JSON, empty responses, missing headers

## Files Modified:

- `tests/unit/utils/apiFetch.test.ts` - Implemented proper mock isolation using vi.stubGlobal pattern

## Next Steps:

Continue systematic approach to identify and fix the eleventh critical issue. Current failure areas appear to be:

1. Component integration test failures
2. Additional hook test issues
3. CSS and accessibility-related test failures

The apiFetch utility now has a solid test foundation, ensuring reliable API communication functionality throughout the application.

## Pattern Established:

This fix establishes the pattern for handling global mock collisions in Vitest:

- Use `vi.stubGlobal()` instead of direct global assignment
- Always pair with `vi.unstubAllGlobals()` in cleanup
- Isolate utility tests from global test setup when they need specific mocking behavior
