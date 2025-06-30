export const calculatePace = (
  distance: number,
  durationInSeconds: number
): string => {
  const paceMinutes = durationInSeconds / 60 / distance;
  const minutes = Math.floor(paceMinutes);
  const seconds = Math.round((paceMinutes - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
};

export type DateFormat =
  | 'weekday-short'
  | 'month-day'
  | 'month-day-year'
  | 'month'
  | 'weekday'
  | 'default';

const DATE_OPTIONS: Record<DateFormat, Intl.DateTimeFormatOptions | undefined> = {
  'weekday-short': { weekday: 'short', month: 'short', day: 'numeric' },
  'month-day': { month: 'short', day: 'numeric' },
  'month-day-year': { month: 'short', day: 'numeric', year: 'numeric' },
  month: { month: 'short' },
  weekday: { weekday: 'short' },
  default: undefined,
};

export const formatDate = (
  dateInput: string | Date,
  format: DateFormat = 'weekday-short'
): string => {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  const options = DATE_OPTIONS[format];
  return options
    ? date.toLocaleDateString('en-US', options)
    : date.toLocaleDateString('en-US');
};

export const formatPace = (
  paceInSeconds: number,
  { includeUnit = false, unit = '/km' } = {}
): string => {
  if (!isFinite(paceInSeconds) || paceInSeconds <= 0) {
    return '-';
  }

  const minutes = Math.floor(paceInSeconds / 60);
  const seconds = Math.round(paceInSeconds % 60);
  const base = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return includeUnit ? `${base}${unit}` : base;
};

export const formatDistance = (
  distanceKm: number,
  { includeUnit = true, unit = 'km', precision = 1 } = {}
): string => {
  const rounded = distanceKm.toFixed(precision);
  return includeUnit ? `${rounded}${unit}` : rounded;
};
