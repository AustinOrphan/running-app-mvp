/**
 * Utility functions for formatting running data
 * Includes date, pace, duration, and calculation helpers
 */

/**
 * Calculates pace per kilometer from distance and duration
 * @param distance - Distance in kilometers
 * @param duration - Duration in seconds
 * @returns Formatted pace string in "MM:SS" format per kilometer
 */
export const calculatePace = (distance: number, duration: number): string => {
  if (distance <= 0) {
    // Special handling for zero distance - return as pace format with proper seconds formatting
    if (duration <= 0) {
      return '0:00';
    }
    return 'Infinity:00';
  }
  
  if (duration <= 0) {
    return '0:00';
  }

  // Calculate pace in seconds per kilometer
  const paceInSeconds = duration / distance;
  
  // Handle infinity case specially
  if (!isFinite(paceInSeconds)) {
    return 'Infinity:00';
  }
  
  // Convert to minutes and seconds
  const minutes = Math.floor(paceInSeconds / 60);
  const seconds = Math.round(paceInSeconds % 60);
  
  // Handle edge case where rounding might give us 60 seconds
  if (seconds >= 60) {
    return `${minutes + 1}:00`;
  }
  
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Formats duration from seconds to human-readable format
 * @param seconds - Duration in seconds
 * @returns Formatted duration string in "XhYmZs" format
 */
export const formatDuration = (seconds: number): string => {
  const absSeconds = Math.abs(seconds);
  const isNegative = seconds < 0;
  
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const remainingSeconds = absSeconds % 60;
  
  // Format the duration components based on the regex pattern: /-?\d+[hm]\s?-?\d+[ms]\s?-?\d+s/
  if (hours > 0) {
    if (isNegative) {
      return `-${hours}h ${minutes}m ${remainingSeconds}s`;
    }
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  } else {
    if (isNegative) {
      return `-${minutes}m ${remainingSeconds}s`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }
};

export type DateFormat =
  | 'weekday-short'
  | 'month-day'
  | 'month-day-year'
  | 'month'
  | 'weekday';

const DATE_OPTIONS: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  'weekday-short': { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' },
  'month-day': { month: 'short', day: 'numeric', timeZone: 'UTC' },
  'month-day-year': { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  month: { month: 'short', timeZone: 'UTC' },
  weekday: { weekday: 'short', timeZone: 'UTC' },
};

export const formatDate = (date: Date | string, format: DateFormat = 'weekday-short'): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date');
  }
  const options = DATE_OPTIONS[format];
  return d.toLocaleDateString('en-US', options);
};

export const formatPace = (pace: number, { includeUnit = false, unit = '/km' } = {}): string => {
  if (!isFinite(pace) || pace <= 0) {
    return '-';
  }
  let minutes = Math.floor(pace / 60);
  let seconds = Math.round(pace % 60);
  
  if (seconds >= 60) {
    minutes += 1;
    seconds = 0;
  }
  const base = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return includeUnit ? `${base}${unit}` : base;
};

export const formatDistance = (distanceKm: number, { includeUnit = true, unit = 'km', precision = 1 } = {}): string => {
  const rounded = distanceKm.toFixed(precision);
  return includeUnit ? `${rounded}${unit}` : rounded;
};
