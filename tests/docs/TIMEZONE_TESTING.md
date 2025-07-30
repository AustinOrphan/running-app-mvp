# Timezone Testing Documentation

This document outlines the approach and best practices for handling timezones in tests across the running app codebase.

## Overview

Timezone handling in tests is critical for ensuring consistent behavior across different development environments, CI/CD systems, and deployment regions. Our approach focuses on:

1. **Deterministic date behavior** in tests
2. **Timezone-independent date operations** for user-facing features
3. **Consistent mocking strategies** across all test files
4. **Cross-platform compatibility** for development teams

## Core Principles

### 1. Use Local Dates for User Input
All user-facing date operations (like goal start/end dates) should work with local dates without timezone conversion:

```typescript
// ✅ Good - Local date parsing
const parseInputDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
  return new Date(year, month - 1, day); // Local timezone
};

// ❌ Avoid - UTC parsing for user dates
const parseInputDate = (dateString: string): Date => {
  return new Date(dateString + 'T00:00:00.000Z'); // Forces UTC
};
```

### 2. Mock Dates for Consistent Testing
Always mock the current date in tests to ensure reproducible results:

```typescript
import { mockCurrentDate } from '../utils/dateTestUtils';

describe('Date-dependent feature', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    cleanup = mockCurrentDate('2024-07-26T12:00:00.000Z');
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
    }
  });

  it('works with mocked date', () => {
    // Test implementation
  });
});
```

### 3. Use Standardized Date Utilities
Always use the centralized date utilities from `dateTestUtils.ts`:

```typescript
import { 
  setDateInputValue,
  setDateRange,
  TEST_DATES,
  getCurrentDateForInput,
  getDateFromToday
} from '../utils/dateTestUtils';
```

## Date Mocking Strategy

### The `mockCurrentDate` Function

Our date mocking utility provides:

- **Consistent behavior**: All `new Date()` calls return the mocked date
- **Preserved arithmetic**: Date calculations work correctly with mocked dates
- **Specific date support**: `new Date('2024-01-01')` still works for specific dates
- **Date.now() support**: Static methods return consistent timestamps

```typescript
export const mockCurrentDate = (mockDate: Date | string): (() => void) => {
  const originalDate = global.Date;
  const targetDate = typeof mockDate === 'string' ? new Date(mockDate) : mockDate;

  global.Date = class extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(targetDate);
      } else {
        super(...args);
      }
    }

    static now() {
      return targetDate.getTime();
    }
  } as any;

  // Return cleanup function
  return () => {
    global.Date = originalDate;
  };
};
```

### Usage Patterns

#### 1. Simple Date Mocking
```typescript
it('calculates dates relative to today', () => {
  const cleanup = mockCurrentDate('2024-07-26');
  
  try {
    expect(getDateFromToday(1)).toBe('2024-07-27'); // Tomorrow
    expect(getDateFromToday(-1)).toBe('2024-07-25'); // Yesterday
  } finally {
    cleanup();
  }
});
```

#### 2. Testing with Different Times
```typescript
it('works regardless of time of day', () => {
  const times = [
    '2024-07-26T00:00:00.000Z', // Midnight
    '2024-07-26T12:00:00.000Z', // Noon
    '2024-07-26T23:59:59.999Z', // End of day
  ];

  times.forEach(time => {
    const cleanup = mockCurrentDate(time);
    try {
      expect(getCurrentDateForInput()).toBe('2024-07-26');
    } finally {
      cleanup();
    }
  });
});
```

#### 3. Edge Case Testing
```typescript
it('handles month boundaries correctly', () => {
  const cleanup = mockCurrentDate('2024-07-31'); // End of month
  
  try {
    expect(getDateFromToday(1)).toBe('2024-08-01'); // Next month
  } finally {
    cleanup();
  }
});
```

## Test Data Constants

Use predefined constants for consistent test data:

```typescript
export const TEST_DATES = {
  // Standard test dates
  PAST_DATE: '2024-01-01',
  TODAY: '2024-07-26',
  FUTURE_DATE: '2024-12-31',
  
  // Goal testing dates
  GOAL_START: '2024-07-01',
  GOAL_END: '2024-07-31',
  
  // Edge case dates
  LEAP_YEAR_DATE: '2024-02-29',
  MONTH_BOUNDARY_START: '2024-07-01',
  MONTH_BOUNDARY_END: '2024-07-31',
  YEAR_BOUNDARY: '2024-12-31',
} as const;
```

## Date Input Testing

### Standard Pattern for Date Inputs
```typescript
import { setDateInputValue, setDateRange, TEST_DATES } from '../utils/dateTestUtils';

it('handles date input correctly', async () => {
  render(<MyDateComponent />);
  
  const startInput = screen.getByLabelText('Start Date') as HTMLInputElement;
  const endInput = screen.getByLabelText('End Date') as HTMLInputElement;
  
  // Use standardized date setting
  await setDateRange(startInput, endInput, TEST_DATES.GOAL_START, TEST_DATES.GOAL_END);
  
  // Assert behavior
  expect(startInput.value).toBe(TEST_DATES.GOAL_START);
  expect(endInput.value).toBe(TEST_DATES.GOAL_END);
});
```

### Why fireEvent for Date Inputs
Date inputs require special handling due to browser implementation differences:

```typescript
// ✅ Recommended for date inputs
await act(async () => {
  fireEvent.change(dateInput, { target: { value: '2024-07-26' } });
});

// ❌ Avoid userEvent for date inputs (can be flaky)
await user.type(dateInput, '2024-07-26');
```

## Cross-Platform Considerations

### Environment Variables
Set timezone in CI/CD to ensure consistency:

```yaml
# GitHub Actions example
env:
  TZ: UTC
```

### Test Environment Setup
```typescript
// In test setup files
beforeAll(() => {
  // Ensure consistent timezone behavior
  process.env.TZ = 'UTC';
});
```

## Best Practices

### 1. Always Clean Up Date Mocks
```typescript
describe('Feature with dates', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });
});
```

### 2. Use Consistent Date Formats
- **HTML inputs**: Always use `YYYY-MM-DD` format
- **Display**: Use locale-appropriate formatting
- **API**: Use ISO 8601 format for transmission

### 3. Test Edge Cases
Always test:
- Month boundaries (especially February)
- Year boundaries
- Leap years
- Timezone transitions
- Invalid dates

### 4. Avoid Timezone Conversion
For user-facing dates, avoid unnecessary timezone conversions:

```typescript
// ✅ Good - Local date operations
const goalEndDate = new Date(2024, 6, 31); // July 31, 2024 local time

// ❌ Avoid - Unnecessary UTC conversion
const goalEndDate = new Date('2024-07-31T00:00:00.000Z'); // Might be different local date
```

## Debugging Timezone Issues

### Common Problems

1. **Inconsistent test results**: Tests pass locally but fail in CI
   - **Solution**: Mock dates consistently, set TZ environment variable

2. **Date off by one day**: Dates display differently than expected
   - **Solution**: Use local date parsing instead of UTC

3. **Flaky date tests**: Tests occasionally fail around midnight
   - **Solution**: Always mock the current date in tests

### Debugging Tools

```typescript
// Debug current timezone
console.log('Timezone offset:', new Date().getTimezoneOffset());
console.log('Current timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone);

// Debug date parsing
const testDate = '2024-07-26';
console.log('Parsed date:', parseInputDate(testDate));
console.log('Formatted back:', formatDateForInput(parseInputDate(testDate)));
```

## Integration with Existing Tests

### Updating Existing Tests
When updating existing date-related tests:

1. Import date utilities: `import { mockCurrentDate, TEST_DATES } from '../utils/dateTestUtils'`
2. Add date mocking in `beforeEach`/`afterEach`
3. Replace hardcoded dates with `TEST_DATES` constants
4. Use `setDateInputValue` for date input testing

### Example Migration
```typescript
// Before
it('creates goal with dates', async () => {
  render(<CreateGoalModal />);
  
  const startInput = screen.getByLabelText('Start Date');
  fireEvent.change(startInput, { target: { value: '2024-07-01' } });
  
  // Test continues...
});

// After
it('creates goal with dates', async () => {
  const cleanup = mockCurrentDate(TEST_DATES.TODAY);
  
  try {
    render(<CreateGoalModal />);
    
    const startInput = screen.getByLabelText('Start Date') as HTMLInputElement;
    await setDateInputValue(startInput, TEST_DATES.GOAL_START);
    
    // Test continues...
  } finally {
    cleanup();
  }
});
```

## File Structure

```
tests/
├── utils/
│   ├── dateTestUtils.ts          # Core date utilities
│   └── timezoneHandling.test.ts  # Timezone-specific tests
├── docs/
│   └── TIMEZONE_TESTING.md       # This documentation
└── unit/
    └── utils/
        └── dateValidation.test.ts # Date validation tests
```

## Related Files

- `tests/utils/dateTestUtils.ts` - Core date testing utilities
- `tests/unit/utils/dateValidation.test.ts` - Date format validation tests
- `tests/unit/utils/timezoneHandling.test.ts` - Timezone handling tests
- `tests/unit/components/CreateGoalModal.test.tsx` - Example implementation

## Future Considerations

1. **Internationalization**: Consider locale-specific date formats
2. **Business Rules**: Handle business day calculations
3. **Recurring Events**: Support for timezone-aware recurring dates
4. **Performance**: Monitor performance impact of date mocking in large test suites