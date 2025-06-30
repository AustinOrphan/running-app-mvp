// Date + pace formatting helpers - TODO: implement
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
  date: Date | string,
  format: DateFormat = 'weekday-short'
): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date');
  }
  const options = DATE_OPTIONS[format];
  return options ? d.toLocaleDateString('en-US', options) : d.toLocaleDateString('en-US');
};

export const formatPace = (
  pace: number,
  { includeUnit = false, unit = '/km' } = {}
): string => {
  if (!isFinite(pace) || pace <= 0) {
    return '-';
  }
  const minutes = Math.floor(pace / 60);
  const seconds = Math.round(pace % 60);
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
