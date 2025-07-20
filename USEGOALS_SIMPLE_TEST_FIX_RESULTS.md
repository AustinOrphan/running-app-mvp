# Twentieth Critical Fix: useGoals.simple.test.ts Mock Setup and Token Check Fix Results

## Issue Identified

The useGoals.simple.test.ts tests were failing due to two main issues:

1. **Mock response format**: Mock fetch responses lacked complete HTTP Response properties
2. **Missing token validation**: The `createGoal` method didn't validate authentication token before making API calls

## Root Cause Analysis

1. **Incomplete mock responses**: Mock responses only included `ok` and `json` properties, missing `status`, `statusText`, and `headers`
2. **API call format mismatch**: Tests expected only headers but actual API calls included `method: 'GET'`
3. **Missing authentication check**: Unlike `useRuns.ts`, the `createGoal` method in `useGoals.ts` didn't check for token availability
4. **Inconsistent error handling**: Test expected "No authentication token available" but hook would throw different error

## Solution Implemented

Fixed both mock responses and added proper authentication validation:

### Key Changes Made:

1. **Updated mock fetch responses to include complete HTTP properties**:

   ```typescript
   // Before
   mockFetch.mockResolvedValueOnce({
     ok: true,
     json: async () => [],
   });

   // After
   mockFetch.mockResolvedValueOnce({
     ok: true,
     status: 200,
     statusText: 'OK',
     headers: new Headers({ 'content-type': 'application/json' }),
     json: async () => [],
   });
   ```

2. **Fixed API call expectation to include method**:

   ```typescript
   expect(mockFetch).toHaveBeenCalledWith('/api/goals', {
     headers: {
       'Content-Type': 'application/json',
       Authorization: `Bearer ${mockToken}`,
     },
     method: 'GET', // Added this line
   });
   ```

3. **Added token validation to createGoal method**:

   ```typescript
   // In useGoals.ts createGoal method
   const createGoal = useCallback(
     async (goalData: CreateGoalData): Promise<Goal> => {
       if (!token) throw new Error('No authentication token available');

       const response = await apiPost<Goal>('/api/goals', goalData);
       // ... rest of method
     },
     [refreshProgress, token] // Added token to dependencies
   );
   ```

## Technical Details

- Updated 4 different mock fetch responses to include complete Response object properties
- Fixed test expectation to match actual `apiGet` behavior (includes `method: 'GET'`)
- Added proper authentication validation consistent with `useRuns.ts` pattern
- Updated useCallback dependencies to include `token` parameter

## Test Results

### Before Fix:

- **Failed useGoals.simple Tests**: 1 failure ("Cannot read properties of undefined")
- **Pass Rate**: 7/8 tests passing (87.5%)
- Tests failing due to incomplete mock responses and missing auth check

### After Fix:

- **Failed useGoals.simple Tests**: 0 failures
- **Pass Rate**: 8/8 tests passing (100%)
- **Tests Fixed**: All useGoals.simple.test.ts tests now pass

### Impact Analysis:

- **useGoals Hook**: Basic functionality now properly tested with complete mocks
- **API Response Mocking**: Established pattern for complete Response object properties
- **Authentication Consistency**: createGoal now has same token validation as other hook methods

## Files Modified:

- `tests/unit/hooks/useGoals.simple.test.ts` - Updated 4 mock responses and API call expectation
- `src/hooks/useGoals.ts` - Added token validation to createGoal method

## Next Steps:

Continue systematic approach to identify and fix the twenty-first critical issue. Current estimated remaining test failures: ~83 tests still failing.

Main patterns to address:

1. CSS module test failures - components returning empty objects
2. Card variant integration tests - components not rendering expected text
3. Form validation tests - validation messages not appearing
4. Accessibility tests - aria attribute mismatches

## Lessons Learned:

- Mock fetch responses must include complete Response properties: `ok`, `status`, `statusText`, `headers`, `json`
- API helper functions like `apiGet` automatically add `method` to fetch options
- Authentication validation should be consistent across all hook methods
- Test error expectations must match actual implementation error messages

## Pattern Reinforced:

When fixing hook tests with API calls:

1. Ensure mock responses include all required Response object properties
2. Check that test expectations match actual API call format (including method)
3. Add proper authentication validation where missing
4. Update useCallback dependencies when adding new parameter checks
