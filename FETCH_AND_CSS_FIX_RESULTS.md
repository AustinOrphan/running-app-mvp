# Sixteenth Critical Fix: Fetch Mocking and CSS Selector Fix Results

## Issues Identified

1. **Fetch Mocking Issue**: Tests using `global.fetch = mockFetch` were not properly overriding the global test setup
2. **CSS Selector Issue**: CreateGoalModal tests were using CSS class selectors that don't work with CSS modules

## Root Cause Analysis

### Fetch Mocking Issue

- The global test setup in `testSetup.ts` sets `global.fetch = createEndpointMocks()`
- Individual tests trying to override with `global.fetch = mockFetch` were not working
- Vitest requires `vi.stubGlobal()` to properly override globals set in test setup
- This caused tests expecting specific mock responses to fail because they were getting the global mock responses

### CSS Selector Issue

- Modal component uses CSS modules, transforming class names like `.modal-overlay`
- Tests using `document.querySelector('.modal-overlay')` returned null
- Need to use semantic selectors like role attributes instead of CSS classes

## Solutions Implemented

### 1. Fixed Fetch Mocking in useGoals.simple.test.ts

```typescript
// Before
const mockFetch = vi.fn();
global.fetch = mockFetch;

// After
const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockClear();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
```

### 2. Fixed CSS Selectors in CreateGoalModal Tests

```typescript
// Before - Using CSS class selectors
const overlay = document.querySelector('.modal-overlay');
const modal = document.querySelector('.modal');

// After - Using role attributes
const overlay = document.querySelector('[role="presentation"]');
const modal = document.querySelector('[role="dialog"]');
```

## Technical Details

- `vi.stubGlobal()` properly overrides globals in Vitest's test environment
- Role attributes are more reliable than CSS classes for testing with CSS modules
- This approach is more semantic and accessible

## Test Results

### Before Fix:

- Failed Tests: 108 (from label mismatch fix)
- Pass Rate: 88.5%
- Fetch mocks not being called in useGoals.simple.test.ts
- CSS selector failures in CreateGoalModal tests

### After Fix:

- **Total Tests**: 946
- **Passed**: 839 (up from 837)
- **Failed**: 106 (down from 108)
- **Skipped**: 1
- **New Pass Rate**: 88.8% (839/946)

### Impact Analysis:

- **Tests Fixed**: 2 fewer failed tests (108 → 106)
- **Improvement**: +0.3% absolute improvement in pass rate (+2 tests)
- **Hook Tests**: Fixed fetch mocking issues in useGoals.simple.test.ts
- **Component Tests**: Fixed CSS selector issues in CreateGoalModal modal interaction tests

## Files Modified:

- `tests/unit/hooks/useGoals.simple.test.ts` - Updated to use vi.stubGlobal for fetch mocking
- `tests/unit/components/CreateGoalModal.test.tsx` - Updated CSS selectors to use role attributes

## Next Steps:

Continue systematic approach to identify and fix the seventeenth critical issue. With 106 tests still failing, focus on:

1. Similar CSS selector issues in other component tests (e.g., TrendsChart.test.tsx)
2. Remaining fetch mocking issues in other test files
3. Continue until reaching 100% pass rate

## Patterns Established:

1. **Fetch Mocking Pattern**: Always use `vi.stubGlobal('fetch', mockFetch)` in Vitest tests
2. **CSS Module Testing Pattern**: Use semantic selectors (role, aria-label, data-testid) instead of CSS classes
3. **Global Override Pattern**: When test setup creates globals, use vi.stubGlobal to override in individual tests
