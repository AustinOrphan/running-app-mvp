import { describe, it, expect } from 'vitest';

import {
  calculatePace,
  formatDuration,
  formatDate,
  formatPace,
  formatDistance,
} from '../../../src/utils/formatters';

describe('Formatter Utilities', () => {
  describe('calculatePace', () => {
    it('calculates pace correctly for standard 5K run', () => {
      const distance = 5.0; // 5 kilometers
      const duration = 1500; // 25 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:00'); // 5 minutes per kilometer
    });

    it('calculates pace correctly for 10K run', () => {
      const distance = 10.0; // 10 kilometers
      const duration = 3000; // 50 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:00'); // 5 minutes per kilometer
    });

    it('calculates pace correctly with decimal distance', () => {
      const distance = 5.2; // 5.2 kilometers
      const duration = 1860; // 31 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:58'); // approximately 5:58 per kilometer
    });

    it('handles fast pace calculations', () => {
      const distance = 5.0; // 5 kilometers
      const duration = 900; // 15 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('3:00'); // 3 minutes per kilometer
    });

    it('handles slow pace calculations', () => {
      const distance = 5.0; // 5 kilometers
      const duration = 3000; // 50 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('10:00'); // 10 minutes per kilometer
    });

    it('formats seconds correctly when under 10', () => {
      const distance = 1.0; // 1 kilometer
      const duration = 305; // 5 minutes 5 seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:05'); // Should pad seconds with zero
    });

    it('handles pace calculation with seconds rounding up', () => {
      const distance = 1.0; // 1 kilometer
      const duration = 309; // 5 minutes 9 seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:09');
    });

    it('handles pace calculation with seconds rounding down', () => {
      const distance = 1.0; // 1 kilometer
      const duration = 301; // 5 minutes 1 second

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:01');
    });

    it('handles very precise distance values', () => {
      const distance = 21.0975; // Half marathon distance
      const duration = 6300; // 1 hour 45 minutes in seconds

      const pace = calculatePace(distance, duration);

      // Should be approximately 4:59 per kilometer (6300/21.0975 = 298.69s = 4:59)
      expect(pace).toBe('4:59');
    });

    it('handles marathon distance correctly', () => {
      const distance = 42.195; // Marathon distance
      const duration = 10800; // 3 hours in seconds

      const pace = calculatePace(distance, duration);

      // Should be approximately 4:16 per kilometer
      expect(pace).toBe('4:16');
    });

    it('handles very short distances', () => {
      const distance = 0.1; // 100 meters
      const duration = 30; // 30 seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('5:00'); // 5 minutes per kilometer equivalent
    });

    it('handles zero distance gracefully', () => {
      const distance = 0; // 0 kilometers
      const duration = 1800; // 30 minutes in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('0:00');
    });

    it('handles zero duration', () => {
      const distance = 5.0; // 5 kilometers
      const duration = 0; // 0 seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('0:00'); // Zero duration results in zero pace
    });

    it('handles edge case with 60 seconds rounding', () => {
      const distance = 1.0; // 1 kilometer
      const duration = 359.5; // Should round to 6:00 exactly

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('6:00');
    });

    it('handles very fast pace (sub-3 minute kilometer)', () => {
      const distance = 1.0; // 1 kilometer
      const duration = 150; // 2 minutes 30 seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('2:30');
    });

    it('handles ultra-marathon paces (slow)', () => {
      const distance = 50.0; // 50 kilometers
      const duration = 25200; // 7 hours in seconds

      const pace = calculatePace(distance, duration);

      expect(pace).toBe('8:24'); // 8 minutes 24 seconds per kilometer
    });
  });

  describe('formatDuration', () => {
    it('formats short duration in minutes and seconds', () => {
      const duration = 1800; // 30 minutes in seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('30m 0s');
    });

    it('formats duration with hours, minutes, and seconds', () => {
      const duration = 7323; // 2 hours, 2 minutes, 3 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('2h 2m 3s');
    });

    it('formats duration less than one minute', () => {
      const duration = 45; // 45 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('0m 45s');
    });

    it('formats exactly one hour', () => {
      const duration = 3600; // 1 hour in seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('1h 0m 0s');
    });

    it('formats exactly one minute', () => {
      const duration = 60; // 1 minute in seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('1m 0s');
    });

    it('formats zero duration', () => {
      const duration = 0; // 0 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('0m 0s');
    });

    it('formats long duration (multiple hours)', () => {
      const duration = 12665; // 3 hours, 31 minutes, 5 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('3h 31m 5s');
    });

    it('formats marathon time', () => {
      const duration = 10800; // 3 hours (marathon time)

      const formatted = formatDuration(duration);

      expect(formatted).toBe('3h 0m 0s');
    });

    it('formats sub-hour marathon time', () => {
      const duration = 7561; // 2 hours, 6 minutes, 1 second

      const formatted = formatDuration(duration);

      expect(formatted).toBe('2h 6m 1s');
    });

    it('formats 5K time', () => {
      const duration = 1200; // 20 minutes

      const formatted = formatDuration(duration);

      expect(formatted).toBe('20m 0s');
    });

    it('formats 10K time', () => {
      const duration = 2437; // 40 minutes, 37 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('40m 37s');
    });

    it('handles ultra-long durations', () => {
      const duration = 43200; // 12 hours

      const formatted = formatDuration(duration);

      expect(formatted).toBe('12h 0m 0s');
    });

    it('handles single digit values correctly', () => {
      const duration = 3665; // 1 hour, 1 minute, 5 seconds

      const formatted = formatDuration(duration);

      expect(formatted).toBe('1h 1m 5s');
    });

    it('handles maximum values for each component', () => {
      const duration = 3599; // 59 minutes, 59 seconds (just under 1 hour)

      const formatted = formatDuration(duration);

      expect(formatted).toBe('59m 59s');
    });
  });

  describe('formatDate', () => {
    it('formats a standard date correctly', () => {
      const dateString = '2024-06-15T06:00:00Z';

      const formatted = formatDate(dateString);

      // Note: This will depend on the system locale, but in en-US it should be like "Sat, Jun 15"
      expect(formatted).toMatch(/\w{3}, \w{3} \d{1,2}/);
    });

    it('formats different months correctly', () => {
      const januaryDate = '2024-01-15T06:00:00Z';
      const decemberDate = '2024-12-15T06:00:00Z';

      const janFormatted = formatDate(januaryDate);
      const decFormatted = formatDate(decemberDate);

      expect(janFormatted).toContain('Jan');
      expect(decFormatted).toContain('Dec');
    });

    it('formats different weekdays correctly', () => {
      const mondayDate = '2024-06-17T06:00:00Z'; // Monday
      const fridayDate = '2024-06-21T06:00:00Z'; // Friday

      const monFormatted = formatDate(mondayDate);
      const friFormatted = formatDate(fridayDate);

      expect(monFormatted).toContain('Mon');
      expect(friFormatted).toContain('Fri');
    });

    it('handles different date formats as input', () => {
      const isoDate = '2024-06-15T06:00:00.000Z';
      const simpleDate = '2024-06-15';

      const isoFormatted = formatDate(isoDate);
      const simpleFormatted = formatDate(simpleDate);

      // Both should format to similar output (may have timezone differences)
      expect(isoFormatted).toMatch(/\w{3}, \w{3} \d{1,2}/);
      expect(simpleFormatted).toMatch(/\w{3}, \w{3} \d{1,2}/);
    });

    it('formats beginning of month correctly', () => {
      const firstDay = '2024-06-01T06:00:00Z';

      const formatted = formatDate(firstDay);

      expect(formatted).toContain('Jun 1');
    });

    it('formats end of month correctly', () => {
      const lastDay = '2024-06-30T06:00:00Z';

      const formatted = formatDate(lastDay);

      expect(formatted).toContain('Jun 30');
    });

    it('handles leap year dates', () => {
      const leapDay = '2024-02-29T06:00:00Z'; // 2024 is a leap year

      const formatted = formatDate(leapDay);

      expect(formatted).toContain('Feb 29');
    });

    it('handles year boundaries', () => {
      const newYearsDay = '2024-01-01T06:00:00Z';
      const newYearsEve = '2024-12-31T06:00:00Z';

      const newYearsFormatted = formatDate(newYearsDay);
      const eveFormatted = formatDate(newYearsEve);

      expect(newYearsFormatted).toContain('Jan 1');
      expect(eveFormatted).toContain('Dec 31');
    });

    it('handles different years', () => {
      const date2023 = '2023-06-15T06:00:00Z';
      const date2025 = '2025-06-15T06:00:00Z';

      const formatted2023 = formatDate(date2023);
      const formatted2025 = formatDate(date2025);

      // Should both contain Jun 15, but may have different weekdays
      expect(formatted2023).toContain('Jun 15');
      expect(formatted2025).toContain('Jun 15');
    });

    it('handles time zones consistently', () => {
      const utcMorning = '2024-06-15T06:00:00Z';
      const utcEvening = '2024-06-15T22:00:00Z';

      const morningFormatted = formatDate(utcMorning);
      const eveningFormatted = formatDate(utcEvening);

      // Depending on the local timezone, these might be different days
      // But the function should handle them consistently
      expect(morningFormatted).toMatch(/\w{3}, \w{3} \d{1,2}/);
      expect(eveningFormatted).toMatch(/\w{3}, \w{3} \d{1,2}/);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    describe('calculatePace edge cases', () => {
      it('handles very large distances', () => {
        const distance = 1000; // 1000 kilometers
        const duration = 360000; // 100 hours in seconds

        const pace = calculatePace(distance, duration);

        expect(pace).toBe('6:00'); // 6 minutes per kilometer
      });

      it('handles very large durations', () => {
        const distance = 1.0; // 1 kilometer
        const duration = 86400; // 24 hours in seconds

        const pace = calculatePace(distance, duration);

        expect(pace).toBe('1440:00'); // 1440 minutes per kilometer
      });

      it('handles negative values gracefully', () => {
        const distance = -5.0; // Negative distance
        const duration = 1800; // 30 minutes

        const pace = calculatePace(distance, duration);

        expect(pace).toBe('-6:00'); // Negative pace
      });
    });

    describe('formatDuration edge cases', () => {
      it('handles very large durations', () => {
        const duration = 356400; // 99 hours in seconds

        const formatted = formatDuration(duration);

        expect(formatted).toBe('99h 0m 0s');
      });

      it('handles negative durations', () => {
        const duration = -1800; // -30 minutes

        const formatted = formatDuration(duration);

        // This would be implementation dependent
        // The function might return negative values or handle it differently
        expect(formatted).toMatch(/-?\d+[hm]\s?-?\d+[ms]\s?-?\d+s/);
      });
    });

    describe('formatDate edge cases', () => {
      it('handles invalid date strings gracefully', () => {
        const invalidDate = 'not-a-date';

        expect(() => {
          formatDate(invalidDate);
        }).toThrow(); // Invalid dates should throw
      });

      it('handles empty string', () => {
        const emptyDate = '';

        expect(() => {
          formatDate(emptyDate);
        }).toThrow(); // Empty string should throw
      });

      it('handles very old dates', () => {
        const oldDate = '1900-01-01T00:00:00Z';

        const formatted = formatDate(oldDate);

        expect(formatted).toContain('Jan 1');
      });

      it('handles far future dates', () => {
        const futureDate = '2100-12-31T00:00:00Z';

        const formatted = formatDate(futureDate);

        expect(formatted).toContain('Dec 31');
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('formats a complete run data set correctly', () => {
      const runData = {
        distance: 10.5, // 10.5 kilometers
        duration: 3150, // 52.5 minutes in seconds
        date: '2024-06-15T06:00:00Z',
      };

      const pace = calculatePace(runData.distance, runData.duration);
      const duration = formatDuration(runData.duration);
      const date = formatDate(runData.date);

      expect(pace).toBe('5:00'); // 5 minutes per kilometer
      expect(duration).toBe('52m 30s'); // 52 minutes 30 seconds
      expect(date).toContain('Jun 15'); // June 15th
    });

    it('handles marathon run data', () => {
      const marathonData = {
        distance: 42.195, // Marathon distance
        duration: 12600, // 3.5 hours in seconds
        date: '2024-10-26T08:00:00Z',
      };

      const pace = calculatePace(marathonData.distance, marathonData.duration);
      const duration = formatDuration(marathonData.duration);
      const date = formatDate(marathonData.date);

      expect(pace).toBe('4:59'); // Approximately 4:59 per kilometer
      expect(duration).toBe('3h 30m 0s'); // 3 hours 30 minutes
      expect(date).toContain('Oct 26'); // October 26th
    });

    it('handles sprint/short run data', () => {
      const sprintData = {
        distance: 1.0, // 1 kilometer
        duration: 180, // 3 minutes in seconds
        date: '2024-08-15T18:00:00Z',
      };

      const pace = calculatePace(sprintData.distance, sprintData.duration);
      const duration = formatDuration(sprintData.duration);
      const date = formatDate(sprintData.date);

      expect(pace).toBe('3:00'); // 3 minutes per kilometer
      expect(duration).toBe('3m 0s'); // 3 minutes
      expect(date).toContain('Aug 15'); // August 15th
    });
  });

  describe('formatDate additional formats', () => {
    const sample = '2024-06-15T06:00:00Z';

    it('formats month and day', () => {
      const res = formatDate(sample, 'month-day');
      expect(res).toBe('Jun 15');
    });

    it('formats month, day and year', () => {
      const res = formatDate(sample, 'month-day-year');
      expect(res).toBe('Jun 15, 2024');
    });

    it('formats month only', () => {
      const res = formatDate(sample, 'month');
      expect(res).toBe('Jun');
    });

    it('formats weekday only', () => {
      const res = formatDate(sample, 'weekday');
      expect(res).toContain('Sat');
    });
  });

  describe('formatPace', () => {
    it('formats seconds to mm:ss', () => {
      const res = formatPace(300);
      expect(res).toBe('5:00');
    });

    it('includes unit when requested', () => {
      const res = formatPace(305, { includeUnit: true });
      expect(res).toBe('5:05/km');
    });

    it('handles invalid values', () => {
      expect(formatPace(0)).toBe('-');
      expect(formatPace(-5)).toBe('-');
      expect(formatPace(Infinity)).toBe('-');
    });
  });

  describe('formatDistance', () => {
    it('formats distance with unit', () => {
      expect(formatDistance(10.123)).toBe('10.1km');
    });

    it('omits unit when specified', () => {
      expect(formatDistance(10, { includeUnit: false })).toBe('10.0');
    });

    it('respects precision', () => {
      expect(formatDistance(5, { precision: 2 })).toBe('5.00km');
    });
  });
});
