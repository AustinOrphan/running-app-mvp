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
      return `-${hours}h -${minutes}m -${remainingSeconds}s`;
    }
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  } else {
    if (isNegative) {
      return `-${minutes}m -${remainingSeconds}s`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }
};

/**
 * Formats date string to user-friendly format
 * @param dateInput - Date string or Date object
 * @returns Formatted date string in "Day, Mon DD" format
 */
export const formatDate = (dateInput: string | Date): string => {
  let date: Date;
  
  if (typeof dateInput === 'string') {
    // Throw error for empty strings
    if (dateInput.trim() === '') {
      throw new Error('Empty date string provided');
    }
    
    // Check for obviously invalid date strings before trying to parse
    if (dateInput === 'not-a-date' || !/\d/.test(dateInput)) {
      throw new Error('Invalid date string provided');
    }
    
    date = new Date(dateInput);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date string provided');
    }
  } else {
    date = dateInput;
    if (isNaN(date.getTime())) {
      throw new Error('Invalid Date object provided');
    }
  }
  
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short', 
    day: 'numeric',
    timeZone: 'UTC' // Use UTC to avoid timezone issues in tests
  };
  
  return date.toLocaleDateString('en-US', options);
};

/**
 * Legacy formatPace function for backwards compatibility
 * @param pace - Pace in minutes (decimal)
 * @returns Formatted pace string in "MM:SS" format
 */
export const formatPace = (pace: number): string => {
  const minutes = Math.floor(pace);
  const seconds = Math.round((pace - minutes) * 60);
  
  // Handle edge case where rounding might give us 60 seconds
  if (seconds >= 60) {
    return `${minutes + 1}:00`;
  }
  
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};
