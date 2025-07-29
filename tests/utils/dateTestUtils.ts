/**
 * Date Testing Utilities
 *
 * Centralized utilities for consistent date manipulation and testing across all test files.
 * Provides helper functions for date input testing, validation, and common date scenarios.
 */

import { fireEvent, act } from '@testing-library/react';

/**
 * Standard date format for HTML date inputs (YYYY-MM-DD)
 */
export const HTML_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Common test date values for consistent testing
 */
export const TEST_DATES = {
  // Standard test dates
  PAST_DATE: '2024-01-01',
  TODAY: '2024-07-26',
  FUTURE_DATE: '2024-12-31',

  // Goal testing dates
  GOAL_START: '2024-07-01',
  GOAL_END: '2024-07-31',
  GOAL_MID: '2024-07-15',

  // Run testing dates
  RUN_DATE_1: '2024-07-20',
  RUN_DATE_2: '2024-07-21',
  RUN_DATE_3: '2024-07-22',

  // Edge case dates
  LEAP_YEAR_DATE: '2024-02-29',
  MONTH_BOUNDARY_START: '2024-07-01',
  MONTH_BOUNDARY_END: '2024-07-31',
  YEAR_BOUNDARY: '2024-12-31',

  // Invalid/edge dates for validation testing
  INVALID_FORMAT: 'invalid-date',
  EMPTY_STRING: '',
} as const;

/**
 * Helper function to set date input value using fireEvent.change
 * This is the standardized approach for date inputs across all tests.
 *
 * @param dateInput - The date input element
 * @param dateValue - The date value in YYYY-MM-DD format
 * @param options - Additional options
 */
export const setDateInputValue = async (
  dateInput: HTMLInputElement,
  dateValue: string,
  options: { withAct?: boolean } = { withAct: true }
): Promise<void> => {
  const setDate = () => {
    fireEvent.change(dateInput, { target: { value: dateValue } });
  };

  if (options.withAct) {
    await act(async () => {
      setDate();
    });
  } else {
    setDate();
  }
};

/**
 * Helper function to set both start and end date inputs
 * Common pattern for forms with date ranges (like CreateGoalModal)
 *
 * @param startDateInput - The start date input element
 * @param endDateInput - The end date input element
 * @param startDate - Start date value in YYYY-MM-DD format
 * @param endDate - End date value in YYYY-MM-DD format
 */
export const setDateRange = async (
  startDateInput: HTMLInputElement,
  endDateInput: HTMLInputElement,
  startDate: string,
  endDate: string
): Promise<void> => {
  await setDateInputValue(startDateInput, startDate);
  await setDateInputValue(endDateInput, endDate);
};

/**
 * Helper function to generate a date range for testing
 *
 * @param startDate - Start date as string or Date
 * @param durationDays - Number of days from start to end
 * @returns Object with formatted start and end dates
 */
export const generateDateRange = (
  startDate: string | Date,
  durationDays: number
): { startDate: string; endDate: string } => {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = new Date(start);
  end.setDate(start.getDate() + durationDays);

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end),
  };
};

/**
 * Format a Date object to YYYY-MM-DD string for HTML date inputs
 *
 * @param date - Date object to format
 * @returns Formatted date string
 */
export const formatDateForInput = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Create a Date object from YYYY-MM-DD string
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object (in local timezone)
 */
export const parseInputDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
  return new Date(year, month - 1, day); // month is 0-indexed for Date constructor
};

/**
 * Validate if a date string is in correct HTML date input format
 *
 * @param dateString - Date string to validate
 * @returns True if valid format (YYYY-MM-DD)
 */
export const isValidDateFormat = (dateString: string): boolean => {
  // Check for null, undefined, or non-string values
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }

  // Check basic format with regex
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return false;
  }

  // Parse the date components
  const [yearStr, monthStr, dayStr] = dateString.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate year (reasonable range)
  if (year < 1000 || year > 9999) {
    return false;
  }

  // Validate month
  if (month < 1 || month > 12) {
    return false;
  }

  // Validate day
  if (day < 1) {
    return false;
  }

  // Get the maximum days for this month/year
  const maxDays = new Date(year, month, 0).getDate(); // month is 1-indexed here
  if (day > maxDays) {
    return false;
  }

  // Create a date and verify it matches our input (catches edge cases)
  const date = new Date(year, month - 1, day); // month is 0-indexed for Date constructor
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

/**
 * Get current date in HTML date input format (YYYY-MM-DD)
 * Useful for testing with "today" scenarios
 *
 * @returns Current date formatted for input
 */
export const getCurrentDateForInput = (): string => {
  return formatDateForInput(new Date());
};

/**
 * Get date N days from today in HTML date input format
 *
 * @param daysOffset - Number of days to add (positive) or subtract (negative)
 * @returns Date formatted for input
 */
export const getDateFromToday = (daysOffset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return formatDateForInput(date);
};

/**
 * Common date validation test scenarios
 * Useful for testing date validation logic
 */
export const DATE_VALIDATION_SCENARIOS = {
  valid: {
    description: 'Valid date range (start before end)',
    startDate: TEST_DATES.GOAL_START,
    endDate: TEST_DATES.GOAL_END,
    shouldPass: true,
  },
  invalidOrder: {
    description: 'Invalid date range (start after end)',
    startDate: TEST_DATES.GOAL_END,
    endDate: TEST_DATES.GOAL_START,
    shouldPass: false,
    expectedError: 'End date must be after start date',
  },
  sameDate: {
    description: 'Same start and end date',
    startDate: TEST_DATES.GOAL_START,
    endDate: TEST_DATES.GOAL_START,
    shouldPass: false,
    expectedError: 'End date must be after start date',
  },
  pastDate: {
    description: 'Start date in the past',
    startDate: TEST_DATES.PAST_DATE,
    endDate: TEST_DATES.FUTURE_DATE,
    shouldPass: true, // Depends on business logic
  },
  farFuture: {
    description: 'Very far future date',
    startDate: '2030-01-01',
    endDate: '2030-12-31',
    shouldPass: true,
  },
} as const;

/**
 * Edge case dates for comprehensive testing
 */
export const EDGE_CASE_DATES = {
  leapYearFeb29: {
    description: 'Leap year February 29th',
    date: TEST_DATES.LEAP_YEAR_DATE,
    isValid: true,
  },
  nonLeapYearFeb29: {
    description: 'Non-leap year February 29th',
    date: '2023-02-29',
    isValid: false,
  },
  monthBoundaries: {
    description: 'Month boundary dates',
    dates: [
      '2024-01-31', // January 31st
      '2024-02-01', // February 1st
      '2024-02-28', // February 28th (non-leap year)
      '2024-02-29', // February 29th (leap year)
      '2024-03-01', // March 1st
    ],
  },
  yearBoundaries: {
    description: 'Year boundary dates',
    dates: [
      '2023-12-31', // Last day of 2023
      '2024-01-01', // First day of 2024
      '2024-12-31', // Last day of 2024
      '2025-01-01', // First day of 2025
    ],
  },
} as const;

/**
 * Mock Date constructor for timezone testing
 * Use this to ensure consistent date behavior across different environments
 *
 * @param mockDate - Date to mock as "now"
 * @returns Cleanup function to restore original Date
 */
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

/**
 * Helper to create a date input testing environment
 * Sets up common test scenarios and provides utility functions
 *
 * @param baseDate - Base date for relative calculations (defaults to TEST_DATES.TODAY)
 * @returns Object with date utilities and test scenarios
 */
export const createDateTestEnvironment = (baseDate: string = TEST_DATES.TODAY) => {
  const base = new Date(baseDate);

  return {
    base,
    formatted: formatDateForInput(base),

    // Relative dates
    yesterday: getDateFromToday(-1),
    tomorrow: getDateFromToday(1),
    nextWeek: getDateFromToday(7),
    nextMonth: getDateFromToday(30),

    // Utilities
    setDateInput: setDateInputValue,
    setDateRange,
    generateRange: (days: number) => generateDateRange(base, days),

    // Validation
    isValidFormat: isValidDateFormat,

    // Mock utilities
    mockToday: () => mockCurrentDate(base),
  };
};

/**
 * Documentation helper for date testing patterns
 */
export const DATE_TESTING_PATTERNS = {
  standardDateInput: `
    // Standard pattern for setting date input values
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    await setDateInputValue(dateInput, TEST_DATES.GOAL_START);
  `,

  dateRangeInput: `
    // Pattern for setting date range inputs
    const startInput = screen.getByLabelText('Start Date') as HTMLInputElement;
    const endInput = screen.getByLabelText('End Date') as HTMLInputElement;
    await setDateRange(startInput, endInput, TEST_DATES.GOAL_START, TEST_DATES.GOAL_END);
  `,

  dateValidationTest: `
    // Pattern for testing date validation
    Object.values(DATE_VALIDATION_SCENARIOS).forEach(scenario => {
      it(scenario.description, async () => {
        await setDateRange(startInput, endInput, scenario.startDate, scenario.endDate);
        // Assert expected behavior
      });
    });
  `,

  mockDateTest: `
    // Pattern for testing with mocked dates
    const cleanup = mockCurrentDate(TEST_DATES.TODAY);
    try {
      // Run tests with mocked date
    } finally {
      cleanup();
    }
  `,
} as const;
