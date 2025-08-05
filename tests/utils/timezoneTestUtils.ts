/**
 * Timezone Testing Utilities
 *
 * Helper functions to handle timezone-sensitive operations in tests
 * and ensure consistent behavior across different environments.
 */

// import { vi } from 'vitest';

/**
 * Common timezones for testing
 */
export const TEST_TIMEZONES = {
  UTC: 'UTC',
  EST: 'America/New_York',
  PST: 'America/Los_Angeles',
  JST: 'Asia/Tokyo',
  CET: 'Europe/Paris',
} as const;

/**
 * Mock the system timezone for consistent testing
 *
 * @param timezone - The timezone to use (e.g., 'UTC', 'America/New_York')
 * @returns Cleanup function to restore original timezone methods
 */
export function mockTimezone(timezone: string): () => void {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  const originalTimeZone = process.env.TZ;

  // Set process timezone (Node.js)
  process.env.TZ = timezone;

  // Mock Intl.DateTimeFormat for browser environments
  if (typeof Intl !== 'undefined') {
    const MockedDateTimeFormat = class extends Intl.DateTimeFormat {
      constructor(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        super(locales, { ...options, timeZone: timezone });
      }

      resolvedOptions() {
        const original = super.resolvedOptions();
        return { ...original, timeZone: timezone };
      }
    };

    // @ts-expect-error - Intentionally overriding global Intl for testing
    global.Intl.DateTimeFormat = MockedDateTimeFormat;
  }

  // Return cleanup function
  return () => {
    if (originalTimeZone !== undefined) {
      process.env.TZ = originalTimeZone;
    } else {
      delete process.env.TZ;
    }

    if (typeof Intl !== 'undefined') {
      global.Intl.DateTimeFormat = originalDateTimeFormat;
    }
  };
}

/**
 * Format a date consistently regardless of timezone
 * Always returns UTC-based formatting
 *
 * @param date - Date to format
 * @param options - Formatting options
 */
export function formatDateUTC(
  date: Date,
  options: {
    includeTime?: boolean;
    format?: 'iso' | 'input' | 'display';
  } = {}
): string {
  const { includeTime = false, format = 'iso' } = options;

  switch (format) {
    case 'input': {
      // HTML date input format (YYYY-MM-DD)
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    case 'display':
      // Human-readable format
      return date.toUTCString();

    case 'iso':
    default:
      // ISO 8601 format
      return includeTime ? date.toISOString() : date.toISOString().split('T')[0];
  }
}

/**
 * Parse a date string consistently regardless of timezone
 * Always interprets the date as UTC
 *
 * @param dateString - Date string to parse
 * @param format - Format of the input string
 */
export function parseDateUTC(dateString: string, format: 'input' | 'iso' = 'iso'): Date {
  if (format === 'input') {
    // Parse YYYY-MM-DD format as UTC
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  // Parse ISO format
  return new Date(dateString);
}

/**
 * Get timezone offset for a specific date and timezone
 *
 * @param date - Date to check
 * @param timezone - Timezone to check (default: current system timezone)
 * @returns Offset in minutes
 */
export function getTimezoneOffset(date: Date, timezone?: string): number {
  if (!timezone) {
    return date.getTimezoneOffset();
  }

  // Create formatter for the specific timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Parse the formatted date
  const parts = formatter.formatToParts(date);
  const dateParts: any = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      dateParts[part.type] = parseInt(part.value, 10);
    }
  });

  // Create date in target timezone
  const tzDate = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    dateParts.hour,
    dateParts.minute,
    dateParts.second
  );

  // Calculate offset
  return (date.getTime() - tzDate.getTime()) / (60 * 1000);
}

/**
 * Convert a local date to UTC
 * Useful for ensuring consistent date handling in tests
 *
 * @param localDate - Date in local timezone
 * @returns Date adjusted to UTC
 */
export function toUTC(localDate: Date): Date {
  return new Date(
    Date.UTC(
      localDate.getFullYear(),
      localDate.getMonth(),
      localDate.getDate(),
      localDate.getHours(),
      localDate.getMinutes(),
      localDate.getSeconds(),
      localDate.getMilliseconds()
    )
  );
}

/**
 * Test helper to ensure date operations work consistently across timezones
 *
 * @param testFn - Test function to run
 * @param timezones - Array of timezones to test (defaults to common timezones)
 */
export function testAcrossTimezones(
  testFn: (timezone: string) => void | Promise<void>,
  timezones: string[] = Object.values(TEST_TIMEZONES)
): void {
  timezones.forEach(timezone => {
    describe(`in ${timezone} timezone`, () => {
      let cleanup: () => void;

      beforeEach(() => {
        cleanup = mockTimezone(timezone);
      });

      afterEach(() => {
        cleanup();
      });

      // Run the test function with the mocked timezone
      testFn(timezone);
    });
  });
}

/**
 * Normalize date for comparison
 * Strips time component and converts to UTC for consistent comparison
 *
 * @param date - Date to normalize
 * @returns Normalized date at UTC midnight
 */
export function normalizeDateForComparison(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Check if two dates are the same day (ignoring time and timezone)
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if dates are the same day
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = normalizeDateForComparison(date1);
  const d2 = normalizeDateForComparison(date2);
  return d1.getTime() === d2.getTime();
}

/**
 * Add days to a date (timezone-safe)
 *
 * @param date - Starting date
 * @param days - Number of days to add (can be negative)
 * @returns New date with days added
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Get start of day in UTC
 *
 * @param date - Date to get start of day for
 * @returns Date at 00:00:00.000 UTC
 */
export function startOfDayUTC(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Get end of day in UTC
 *
 * @param date - Date to get end of day for
 * @returns Date at 23:59:59.999 UTC
 */
export function endOfDayUTC(date: Date = new Date()): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

/**
 * Mock date methods to use UTC
 * This ensures all date operations in tests use UTC
 *
 * @returns Cleanup function
 */
export function enforceUTCDates(): () => void {
  const originalMethods = {
    toLocaleDateString: Date.prototype.toLocaleDateString,
    toLocaleTimeString: Date.prototype.toLocaleTimeString,
    toLocaleString: Date.prototype.toLocaleString,
    getTimezoneOffset: Date.prototype.getTimezoneOffset,
  };

  // Override methods to use UTC
  Date.prototype.toLocaleDateString = function (_locale?: string, _options?: any) {
    return this.toISOString().split('T')[0];
  };

  Date.prototype.toLocaleTimeString = function (_locale?: string, _options?: any) {
    return this.toISOString().split('T')[1].split('.')[0];
  };

  Date.prototype.toLocaleString = function (_locale?: string, _options?: any) {
    return this.toISOString().replace('T', ' ').split('.')[0];
  };

  Date.prototype.getTimezoneOffset = function () {
    return 0; // UTC has no offset
  };

  // Return cleanup function
  return () => {
    Object.assign(Date.prototype, originalMethods);
  };
}
