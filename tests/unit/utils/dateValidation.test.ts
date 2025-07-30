/**
 * Date Format Validation Tests
 *
 * Comprehensive tests for date format validation, edge cases, and various date input scenarios.
 * Tests date parsing, validation, and edge cases like leap years and month boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidDateFormat,
  parseInputDate,
  formatDateForInput,
  getCurrentDateForInput,
  getDateFromToday,
  TEST_DATES,
  EDGE_CASE_DATES,
  mockCurrentDate,
} from '../../utils/dateTestUtils';

describe('Date Format Validation', () => {
  describe('isValidDateFormat', () => {
    describe('Valid Date Formats', () => {
      it('accepts valid YYYY-MM-DD format', () => {
        const validDates = [
          '2024-01-01',
          '2024-12-31',
          '2000-02-29', // Leap year
          '2024-07-26',
          '1999-09-15',
          '2025-06-30',
        ];

        validDates.forEach(date => {
          expect(isValidDateFormat(date)).toBe(true);
        });
      });

      it('accepts edge case dates correctly', () => {
        expect(isValidDateFormat(TEST_DATES.LEAP_YEAR_DATE)).toBe(true);
        expect(isValidDateFormat(TEST_DATES.MONTH_BOUNDARY_START)).toBe(true);
        expect(isValidDateFormat(TEST_DATES.MONTH_BOUNDARY_END)).toBe(true);
        expect(isValidDateFormat(TEST_DATES.YEAR_BOUNDARY)).toBe(true);
      });

      it('accepts leap year February 29th', () => {
        const leapYearDates = [
          '2000-02-29', // Divisible by 400
          '2004-02-29', // Divisible by 4, not by 100
          '2020-02-29',
          '2024-02-29',
        ];

        leapYearDates.forEach(date => {
          expect(isValidDateFormat(date)).toBe(true);
        });
      });
    });

    describe('Invalid Date Formats', () => {
      it('rejects invalid format strings', () => {
        const invalidFormats = [
          'invalid-date',
          '2024/07/26', // Wrong separator
          '07-26-2024', // Wrong order
          '26-07-2024', // Wrong order
          '2024-7-26', // Single digit month
          '2024-07-6', // Single digit day
          '24-07-26', // Two digit year
          '', // Empty string
          '2024-13-01', // Invalid month
          '2024-01-32', // Invalid day
          '2024-02-30', // Invalid day for February
          '2024-04-31', // Invalid day for April
        ];

        invalidFormats.forEach(date => {
          expect(isValidDateFormat(date)).toBe(false);
        });
      });

      it('rejects February 29th in non-leap years', () => {
        const nonLeapYearDates = [
          '2023-02-29', // Not divisible by 4
          '2021-02-29',
          '1900-02-29', // Divisible by 100 but not 400
          '2100-02-29',
        ];

        nonLeapYearDates.forEach(date => {
          expect(isValidDateFormat(date)).toBe(false);
        });
      });

      it('rejects null and undefined values', () => {
        expect(isValidDateFormat(null as any)).toBe(false);
        expect(isValidDateFormat(undefined as any)).toBe(false);
      });

      it('rejects non-string values', () => {
        expect(isValidDateFormat(123 as any)).toBe(false);
        expect(isValidDateFormat(new Date() as any)).toBe(false);
        expect(isValidDateFormat({} as any)).toBe(false);
        expect(isValidDateFormat([] as any)).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('handles month boundaries correctly', () => {
        const monthBoundaries = [
          { date: '2024-01-31', valid: true }, // January 31st
          { date: '2024-02-01', valid: true }, // February 1st
          { date: '2024-02-28', valid: true }, // February 28th (non-leap)
          { date: '2024-02-29', valid: true }, // February 29th (leap)
          { date: '2024-03-01', valid: true }, // March 1st
          { date: '2024-04-30', valid: true }, // April 30th
          { date: '2024-04-31', valid: false }, // April 31st (invalid)
          { date: '2024-06-30', valid: true }, // June 30th
          { date: '2024-06-31', valid: false }, // June 31st (invalid)
        ];

        monthBoundaries.forEach(({ date, valid }) => {
          expect(isValidDateFormat(date)).toBe(valid);
        });
      });

      it('handles year boundaries correctly', () => {
        const yearBoundaries = [
          '1999-12-31',
          '2000-01-01',
          '2023-12-31',
          '2024-01-01',
          '2024-12-31',
          '2025-01-01',
        ];

        yearBoundaries.forEach(date => {
          expect(isValidDateFormat(date)).toBe(true);
        });
      });

      it('validates leap year logic correctly', () => {
        // Test specific leap year rules
        expect(isValidDateFormat('2000-02-29')).toBe(true); // Divisible by 400
        expect(isValidDateFormat('1900-02-29')).toBe(false); // Divisible by 100, not 400
        expect(isValidDateFormat('2004-02-29')).toBe(true); // Divisible by 4, not 100
        expect(isValidDateFormat('2003-02-29')).toBe(false); // Not divisible by 4
      });
    });
  });

  describe('parseInputDate', () => {
    it('parses valid date strings correctly', () => {
      const testDate = '2024-07-26';
      const parsed = parseInputDate(testDate);

      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(6); // 0-indexed
      expect(parsed.getDate()).toBe(26);
    });

    it('handles timezone correctly', () => {
      const testDate = '2024-07-26';
      const parsed = parseInputDate(testDate);

      // Should parse in local timezone but maintain correct date values
      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(6); // 0-indexed
      expect(parsed.getDate()).toBe(26);
    });

    it('parses edge case dates correctly', () => {
      const edgeCases = [
        { date: '2024-02-29', year: 2024, month: 1, day: 29 }, // Leap year
        { date: '2024-01-01', year: 2024, month: 0, day: 1 }, // Year start
        { date: '2024-12-31', year: 2024, month: 11, day: 31 }, // Year end
      ];

      edgeCases.forEach(({ date, year, month, day }) => {
        const parsed = parseInputDate(date);
        expect(parsed.getFullYear()).toBe(year);
        expect(parsed.getMonth()).toBe(month);
        expect(parsed.getDate()).toBe(day);
      });
    });
  });

  describe('formatDateForInput', () => {
    it('formats Date objects correctly', () => {
      const testDate = new Date('2024-07-26T12:30:45.123Z');
      const formatted = formatDateForInput(testDate);

      expect(formatted).toBe('2024-07-26');
    });

    it('handles edge case dates correctly', () => {
      const edgeCases = [
        { date: new Date('2024-02-29T00:00:00.000Z'), expected: '2024-02-29' },
        { date: new Date('2024-01-01T00:00:00.000Z'), expected: '2024-01-01' },
        { date: new Date('2024-12-31T23:59:59.999Z'), expected: '2024-12-31' },
      ];

      edgeCases.forEach(({ date, expected }) => {
        expect(formatDateForInput(date)).toBe(expected);
      });
    });

    it('maintains consistency with parseInputDate', () => {
      const testDates = ['2024-01-01', '2024-07-26', '2024-12-31', '2024-02-29'];

      testDates.forEach(dateString => {
        const parsed = parseInputDate(dateString);
        const formatted = formatDateForInput(parsed);
        expect(formatted).toBe(dateString);
      });
    });
  });

  describe('getCurrentDateForInput', () => {
    it('returns current date in correct format', () => {
      const result = getCurrentDateForInput();
      expect(isValidDateFormat(result)).toBe(true);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('works with mocked dates', () => {
      const mockDate = '2024-07-26';
      const cleanup = mockCurrentDate(mockDate);

      try {
        const result = getCurrentDateForInput();
        expect(result).toBe(mockDate);
      } finally {
        cleanup();
      }
    });
  });

  describe('getDateFromToday', () => {
    let cleanup: (() => void) | null = null;

    beforeEach(() => {
      // Mock a consistent "today" for testing
      cleanup = mockCurrentDate('2024-07-26');
    });

    afterEach(() => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    });

    it('calculates future dates correctly', () => {
      expect(getDateFromToday(1)).toBe('2024-07-27'); // Tomorrow
      expect(getDateFromToday(7)).toBe('2024-08-02'); // Next week
      expect(getDateFromToday(30)).toBe('2024-08-25'); // Approximately next month
    });

    it('calculates past dates correctly', () => {
      expect(getDateFromToday(-1)).toBe('2024-07-25'); // Yesterday
      expect(getDateFromToday(-7)).toBe('2024-07-19'); // Last week
      expect(getDateFromToday(-30)).toBe('2024-06-26'); // Approximately last month
    });

    it('handles zero offset', () => {
      expect(getDateFromToday(0)).toBe('2024-07-26'); // Today
    });

    it('handles month boundaries', () => {
      // Mock end of month
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2024-07-31');

      expect(getDateFromToday(1)).toBe('2024-08-01'); // Next month
      expect(getDateFromToday(-1)).toBe('2024-07-30'); // Previous day
    });

    it('handles year boundaries', () => {
      // Mock end of year
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2024-12-31');

      expect(getDateFromToday(1)).toBe('2025-01-01'); // Next year
      expect(getDateFromToday(-1)).toBe('2024-12-30'); // Previous day
    });

    it('handles leap year boundaries', () => {
      // Mock February 28th in leap year
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2024-02-28');

      expect(getDateFromToday(1)).toBe('2024-02-29'); // Leap day
      expect(getDateFromToday(2)).toBe('2024-03-01'); // March 1st
    });
  });

  describe('Date Constants Validation', () => {
    it('validates all valid TEST_DATES constants', () => {
      // Only test the valid date constants
      const validDates = Object.entries(TEST_DATES).filter(
        ([key]) => !key.includes('INVALID') && !key.includes('EMPTY')
      );

      validDates.forEach(([, date]) => {
        expect(isValidDateFormat(date)).toBe(true);
      });
    });

    it('validates invalid TEST_DATES constants', () => {
      // Test the invalid date constants
      expect(isValidDateFormat(TEST_DATES.INVALID_FORMAT)).toBe(false);
      expect(isValidDateFormat(TEST_DATES.EMPTY_STRING)).toBe(false);
    });

    it('validates EDGE_CASE_DATES constants', () => {
      expect(isValidDateFormat(EDGE_CASE_DATES.leapYearFeb29.date)).toBe(true);
      expect(isValidDateFormat(EDGE_CASE_DATES.nonLeapYearFeb29.date)).toBe(false);

      EDGE_CASE_DATES.monthBoundaries.dates.forEach(date => {
        expect(isValidDateFormat(date)).toBe(true);
      });

      EDGE_CASE_DATES.yearBoundaries.dates.forEach(date => {
        expect(isValidDateFormat(date)).toBe(true);
      });
    });
  });

  describe('Date Validation Scenarios', () => {
    it('covers all validation scenarios from date utilities', () => {
      // Test that our validation function works with the predefined scenarios
      const validationTests = [
        { dates: ['2024-07-01', '2024-07-31'], shouldBeValid: true },
        { dates: ['2024-02-29'], shouldBeValid: true }, // Leap year
        { dates: ['2023-02-29'], shouldBeValid: false }, // Non-leap year
        { dates: ['2024-04-31'], shouldBeValid: false }, // Invalid day for April
        { dates: ['2024-13-01'], shouldBeValid: false }, // Invalid month
      ];

      validationTests.forEach(({ dates, shouldBeValid }) => {
        dates.forEach(date => {
          expect(isValidDateFormat(date)).toBe(shouldBeValid);
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('handles malformed input gracefully', () => {
      const malformedInputs = [
        null,
        undefined,
        '',
        '   ',
        '2024-',
        '-07-26',
        '2024--26',
        '2024-07-',
        'not-a-date',
        '2024-07-26T12:30:00', // ISO string with time
        '2024/07/26', // Wrong separators
      ];

      malformedInputs.forEach(input => {
        expect(() => isValidDateFormat(input as any)).not.toThrow();
        expect(isValidDateFormat(input as any)).toBe(false);
      });
    });

    it('handles extreme date values', () => {
      const extremeDates = [
        '0000-01-01', // Year 0
        '9999-12-31', // Year 9999
        '2024-00-01', // Month 0
        '2024-13-01', // Month 13
        '2024-01-00', // Day 0
      ];

      extremeDates.forEach(date => {
        expect(() => isValidDateFormat(date)).not.toThrow();
        // Most should be false except possibly the extreme year cases
        const result = isValidDateFormat(date);
        expect(typeof result).toBe('boolean');
      });
    });
  });

  describe('Performance', () => {
    it('validates dates efficiently', () => {
      const startTime = performance.now();

      // Test a large number of validations
      for (let i = 0; i < 1000; i++) {
        isValidDateFormat('2024-07-26');
        isValidDateFormat('invalid-date');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(100); // 100ms for 2000 validations
    });
  });
});
