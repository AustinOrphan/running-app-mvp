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
  if (distance <= 0 || duration <= 0) return '-';

  const paceInSeconds = duration / distance;
  return formatPace(paceInSeconds);
};

/**
 * Formats duration from seconds to human-readable format
 * @param seconds - Duration in seconds
 * @returns Formatted duration string in "Xh Ym Zs" or "Xm Zs" format
 */
export const formatDuration = (seconds: number): string => {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';

  const hours = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;

  return hours > 0 ? `${sign}${hours}h ${mins}m ${secs}s` : `${sign}${mins}m ${secs}s`;
};

export type DateFormat = 'weekday-short' | 'month-day' | 'month-day-year' | 'month' | 'weekday';

const DATE_OPTIONS: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  'weekday-short': { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' },
  'month-day': { month: 'short', day: 'numeric', timeZone: 'UTC' },
  'month-day-year': { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  month: { month: 'short', timeZone: 'UTC' },
  weekday: { weekday: 'short', timeZone: 'UTC' },
};

/**
 * Formats a date string or Date object to a readable format
 */
export const formatDate = (
  dateInput: string | Date,
  format: DateFormat = 'weekday-short'
): string => {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  return date.toLocaleDateString('en-US', DATE_OPTIONS[format]);
};

/**
 * Formats pace (in seconds per unit) to readable string
 * @param paceInSeconds - Pace in seconds per km or mile
 * @param options.unit - 'km' or 'mi' (default: 'km')
 * @returns Formatted string like "5:00/km" or "8:03/mi"
 */
export const formatPace = (
  paceInSeconds: number,
  {
    includeUnit = false,
    unit = 'km',
  }: {
    includeUnit?: boolean;
    unit?: 'km' | 'mi';
  } = {}
): string => {
  if (!isFinite(paceInSeconds) || paceInSeconds <= 0) return '-';

  const roundedPace = paceInSeconds.toFixed(2);

  let minutes = Math.floor(roundedPace / 60);
  let seconds = Math.round(roundedPace % 60);

  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }

  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return includeUnit ? `${formatted}/${unit}` : formatted;
};

/**
 * Converts pace (seconds per km or mi) to speed in km/h or mph
 * @param paceInSeconds - Pace in seconds per unit (e.g., per km)
 * @param unit - 'km' or 'mi'
 * @returns Speed as string with 1 decimal place (e.g. "12.3 km/h")
 */
export const formatSpeed = (paceInSeconds: number, unit: 'km' | 'mi' = 'km'): string => {
  if (!isFinite(paceInSeconds) || paceInSeconds <= 0) return '-';

  const speed = 3600 / paceInSeconds; // seconds per hour ÷ pace = units per hour
  const suffix = unit === 'mi' ? 'mph' : 'km/h';

  return `${speed.toFixed(1)} ${suffix}`;
};

/**
 * Formats distance in km to a string with optional unit and precision
 */
export const formatDistance = (
  distanceKm: number,
  {
    includeUnit = true,
    unit = 'km',
    precision = 1,
  }: { includeUnit?: boolean; unit?: string; precision?: number } = {}
): string => {
  const rounded = distanceKm.toFixed(precision);
  return includeUnit ? `${rounded}${unit}` : rounded;
};

/**
 * Formats a timestamp or Date into a readable time of day (e.g., "6:32 AM")
 * @param input - Date string or Date object
 * @returns Formatted time string
 */
export const formatTimeOfDay = (input: string | Date): string => {
  const date = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC', // change to 'America/Chicago' or local TZ if needed
  });
};

/**
 * Parses a duration string like "1h 45m 30s" into total seconds
 * Accepts formats like "90s", "3m 15s", "2h", etc.
 * @param durationStr - Human-readable duration
 * @returns Total duration in seconds
 */
export const parseDuration = (durationStr: string): number => {
  const regex = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;
  const match = durationStr.trim().match(regex);

  if (!match) throw new Error(`Invalid duration string: "${durationStr}"`);

  const [, h, m, s] = match.map(val => parseInt(val ?? '0', 10));
  return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
};
