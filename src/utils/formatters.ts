export const calculatePace = (
  distance: number,
  durationInSeconds: number
): string => {
  if (distance === 0) return 'Infinity:00';

  const sign = distance < 0 ? '-' : '';
  const paceMinutes = Math.abs(durationInSeconds) / 60 / Math.abs(distance);
  const totalSeconds = Math.round(paceMinutes * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatDuration = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const secs = abs % 60;

  if (hours > 0) {
    return `${sign}${hours}h ${mins}m ${secs}s`;
  }
  return `${sign}${mins}m ${secs}s`;
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};
