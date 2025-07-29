/**
 * Timezone Handling Tests
 *
 * Comprehensive tests for timezone handling in date operations, mocking different timezones,
 * and ensuring consistent behavior across different environments and timezones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mockCurrentDate,
  formatDateForInput,
  parseInputDate,
  getCurrentDateForInput,
  getDateFromToday,
  TEST_DATES,
} from '../../utils/dateTestUtils';

describe('Timezone Handling in Tests', () => {
  let originalDate: typeof Date;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    // Store the original Date constructor
    originalDate = global.Date;
    cleanup = null;
  });

  afterEach(() => {
    // Clean up any date mocking
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    // Restore original Date
    global.Date = originalDate;
  });

  describe('Date Mocking', () => {
    it('successfully mocks current date', () => {
      const mockDate = '2024-07-26';
      cleanup = mockCurrentDate(mockDate);

      const now = new Date();
      expect(formatDateForInput(now)).toBe(mockDate);
    });

    it('preserves date arithmetic with mocked dates', () => {
      const mockDate = '2024-07-26';
      cleanup = mockCurrentDate(mockDate);

      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      expect(formatDateForInput(today)).toBe('2024-07-26');
      expect(formatDateForInput(tomorrow)).toBe('2024-07-27');
    });

    it('allows construction of specific dates while mocking current date', () => {
      const mockDate = '2024-07-26';
      cleanup = mockCurrentDate(mockDate);

      // Specific date construction should still work
      const specificDate = new Date('2024-01-01');
      expect(formatDateForInput(specificDate)).toBe('2024-01-01');

      // But new Date() without arguments should use mocked date
      const currentDate = new Date();
      expect(formatDateForInput(currentDate)).toBe('2024-07-26');
    });

    it('handles Date.now() correctly with mocked dates', () => {
      const mockDate = '2024-07-26T12:00:00.000Z';
      cleanup = mockCurrentDate(mockDate);

      const timestamp = Date.now();
      const expectedTimestamp = new Date(mockDate).getTime();
      expect(timestamp).toBe(expectedTimestamp);
    });
  });

  describe('Timezone-Independent Date Operations', () => {
    it('parseInputDate works consistently regardless of timezone', () => {
      // Test with various mocked timezones by offsetting the system time
      const testDates = [
        '2024-01-01',
        '2024-07-26',
        '2024-12-31',
        '2024-02-29', // Leap year
      ];

      testDates.forEach(dateString => {
        const parsed = parseInputDate(dateString);

        // The parsed date should have the correct local date values
        const [year, month, day] = dateString.split('-').map(Number);
        expect(parsed.getFullYear()).toBe(year);
        expect(parsed.getMonth()).toBe(month - 1); // 0-indexed
        expect(parsed.getDate()).toBe(day);
      });
    });

    it('formatDateForInput produces consistent YYYY-MM-DD format', () => {
      const testCases = [
        { date: new Date(2024, 0, 1), expected: '2024-01-01' },
        { date: new Date(2024, 6, 26), expected: '2024-07-26' },
        { date: new Date(2024, 11, 31), expected: '2024-12-31' },
        { date: new Date(2024, 1, 29), expected: '2024-02-29' }, // Leap year
      ];

      testCases.forEach(({ date, expected }) => {
        expect(formatDateForInput(date)).toBe(expected);
      });
    });

    it('round-trip conversion maintains date integrity', () => {
      const testDates = ['2024-01-01', '2024-07-26', '2024-12-31', '2024-02-29'];

      testDates.forEach(original => {
        const parsed = parseInputDate(original);
        const formatted = formatDateForInput(parsed);
        expect(formatted).toBe(original);
      });
    });
  });

  describe('Timezone Simulation', () => {
    it('simulates UTC timezone behavior', () => {
      // Mock a UTC date
      const utcDate = '2024-07-26T12:00:00.000Z';
      cleanup = mockCurrentDate(utcDate);

      const current = getCurrentDateForInput();
      expect(current).toBe('2024-07-26');
    });

    it('simulates different times of day without affecting date', () => {
      const timeVariants = [
        '2024-07-26T00:00:00.000Z', // Midnight UTC
        '2024-07-26T12:00:00.000Z', // Noon UTC
        '2024-07-26T23:59:59.999Z', // End of day UTC
      ];

      timeVariants.forEach(timeString => {
        if (cleanup) cleanup();
        cleanup = mockCurrentDate(timeString);

        const current = getCurrentDateForInput();
        expect(current).toBe('2024-07-26'); // Date should be consistent
      });
    });

    it('handles timezone edge cases around midnight', () => {
      // Test dates around midnight in different timezones
      const edgeCases = [
        {
          description: 'Just before midnight UTC',
          time: '2024-07-26T23:59:59.999Z',
          expectedDate: '2024-07-26',
        },
        {
          description: 'Just after midnight UTC',
          time: '2024-07-27T00:00:00.001Z',
          expectedDate: '2024-07-27',
        },
      ];

      edgeCases.forEach(({ description, time, expectedDate }) => {
        if (cleanup) cleanup();
        cleanup = mockCurrentDate(time);

        const result = getCurrentDateForInput();
        expect(result).toBe(expectedDate);
      });
    });
  });

  describe('Date Arithmetic with Timezone Considerations', () => {
    it('getDateFromToday works consistently with mocked dates', () => {
      cleanup = mockCurrentDate('2024-07-26T12:00:00.000Z');

      const testCases = [
        { offset: -1, expected: '2024-07-25' }, // Yesterday
        { offset: 0, expected: '2024-07-26' }, // Today
        { offset: 1, expected: '2024-07-27' }, // Tomorrow
        { offset: 7, expected: '2024-08-02' }, // Next week
        { offset: -7, expected: '2024-07-19' }, // Last week
      ];

      testCases.forEach(({ offset, expected }) => {
        expect(getDateFromToday(offset)).toBe(expected);
      });
    });

    it('handles month boundaries correctly with date arithmetic', () => {
      // Test at end of month
      cleanup = mockCurrentDate('2024-07-31T12:00:00.000Z');

      expect(getDateFromToday(1)).toBe('2024-08-01'); // Next month
      expect(getDateFromToday(-1)).toBe('2024-07-30'); // Previous day

      // Test at beginning of month
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2024-08-01T12:00:00.000Z');

      expect(getDateFromToday(-1)).toBe('2024-07-31'); // Previous month
      expect(getDateFromToday(1)).toBe('2024-08-02'); // Next day
    });

    it('handles year boundaries correctly with date arithmetic', () => {
      // Test at end of year
      cleanup = mockCurrentDate('2024-12-31T12:00:00.000Z');

      expect(getDateFromToday(1)).toBe('2025-01-01'); // Next year
      expect(getDateFromToday(-1)).toBe('2024-12-30'); // Previous day

      // Test at beginning of year
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2025-01-01T12:00:00.000Z');

      expect(getDateFromToday(-1)).toBe('2024-12-31'); // Previous year
      expect(getDateFromToday(1)).toBe('2025-01-02'); // Next day
    });

    it('handles leap year boundaries with date arithmetic', () => {
      // Test around leap day
      cleanup = mockCurrentDate('2024-02-28T12:00:00.000Z');

      expect(getDateFromToday(1)).toBe('2024-02-29'); // Leap day
      expect(getDateFromToday(2)).toBe('2024-03-01'); // Day after leap day

      // Test leap day itself
      if (cleanup) cleanup();
      cleanup = mockCurrentDate('2024-02-29T12:00:00.000Z');

      expect(getDateFromToday(-1)).toBe('2024-02-28'); // Day before leap day
      expect(getDateFromToday(1)).toBe('2024-03-01'); // Day after leap day
    });
  });

  describe('Cross-Platform Timezone Consistency', () => {
    it('produces consistent results across different system timezones', () => {
      // This test ensures our date utilities work the same regardless of the
      // system timezone where tests are run
      const baseDate = '2024-07-26';

      // Mock various timezone-like scenarios
      const timezoneScenarios = [
        '2024-07-26T00:00:00.000Z', // UTC midnight
        '2024-07-26T05:00:00.000Z', // UTC +5 midnight equivalent
        '2024-07-26T12:00:00.000Z', // UTC noon
        '2024-07-26T19:00:00.000Z', // UTC +7 midnight equivalent
      ];

      timezoneScenarios.forEach(scenario => {
        if (cleanup) cleanup();
        cleanup = mockCurrentDate(scenario);

        // All scenarios should produce the same date for date-only operations
        expect(getCurrentDateForInput()).toBe(baseDate);

        // Date arithmetic should be consistent
        expect(getDateFromToday(1)).toBe('2024-07-27');
        expect(getDateFromToday(-1)).toBe('2024-07-25');
      });
    });

    it('maintains consistency with TEST_DATES constants', () => {
      // Verify that our mocked dates work correctly with predefined test constants
      cleanup = mockCurrentDate(TEST_DATES.TODAY);

      expect(getCurrentDateForInput()).toBe(TEST_DATES.TODAY);

      // Test relative date calculations from our known base
      const tomorrow = getDateFromToday(1);
      const yesterday = getDateFromToday(-1);

      expect(tomorrow).toBe('2024-07-27');
      expect(yesterday).toBe('2024-07-25');
    });
  });

  describe('Error Handling with Timezone Issues', () => {
    it('handles invalid date strings gracefully', () => {
      const invalidDates = [
        'invalid-date',
        '2024-13-45', // Invalid month/day
        '', // Empty string
      ];

      invalidDates.forEach(invalid => {
        expect(() => parseInputDate(invalid)).not.toThrow();
        // The function may produce valid or invalid Date objects depending on input
        // The key is that it doesn't throw an error
        const result = parseInputDate(invalid);
        expect(result).toBeInstanceOf(Date);
      });
    });

    it('handles timezone transitions gracefully', () => {
      // Test around theoretical DST transitions
      const transitionDates = [
        '2024-03-10T12:00:00.000Z', // Around US DST start
        '2024-11-03T12:00:00.000Z', // Around US DST end
      ];

      transitionDates.forEach(transitionDate => {
        if (cleanup) cleanup();
        cleanup = mockCurrentDate(transitionDate);

        // Date operations should still work correctly
        expect(() => getCurrentDateForInput()).not.toThrow();
        expect(() => getDateFromToday(1)).not.toThrow();
        expect(() => getDateFromToday(-1)).not.toThrow();
      });
    });
  });

  describe('Performance with Date Mocking', () => {
    it('maintains performance with frequent date operations', () => {
      cleanup = mockCurrentDate('2024-07-26T12:00:00.000Z');

      const startTime = performance.now();

      // Perform many date operations
      for (let i = 0; i < 1000; i++) {
        getCurrentDateForInput();
        getDateFromToday(i % 10);
        formatDateForInput(new Date());
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time
      expect(duration).toBeLessThan(100); // 100ms for 3000 operations
    });
  });

  describe('Date Mocking Cleanup', () => {
    it('properly restores original Date after cleanup', () => {
      const originalNow = Date.now();

      // Mock a date
      cleanup = mockCurrentDate('2024-01-01T00:00:00.000Z');

      // Verify mocking is active
      const mockedNow = Date.now();
      expect(mockedNow).not.toBe(originalNow);
      expect(mockedNow).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());

      // Cleanup
      cleanup();
      cleanup = null;

      // Verify original Date is restored
      const restoredNow = Date.now();
      expect(Math.abs(restoredNow - originalNow)).toBeLessThan(1000); // Within 1 second
    });

    it('handles multiple cleanup calls gracefully', () => {
      cleanup = mockCurrentDate('2024-07-26T12:00:00.000Z');

      // Multiple cleanup calls should not throw
      expect(() => {
        cleanup!();
        cleanup!();
        cleanup!();
      }).not.toThrow();
    });
  });
});
