/**
 * Analytics test data fixtures
 *
 * Provides 90-day run patterns for testing analytics endpoints:
 * - Consistent running patterns
 * - Improving/declining pace trends
 * - Volume spikes
 * - GPS routes for heatmap testing
 * - Heart rate data
 */

// Helper to generate dates going back N days from today
const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

// Helper to get dates within current week (Monday - Sunday)
const currentWeekDates = (count: number): string[] => {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const dates: string[] = [];
  for (let i = 0; i < Math.min(count, 7); i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
};

// Helper to get dates within current month
const currentMonthDates = (count: number): string[] => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const daysInMonth = lastDay.getDate();
  const dates: string[] = [];
  const step = Math.max(1, Math.floor(daysInMonth / count));

  for (let i = 0; i < Math.min(count, daysInMonth); i++) {
    const date = new Date(firstDay);
    date.setDate(1 + i * step);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
};

// Helper to get dates within current year
const currentYearDates = (count: number): string[] => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((today.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));

  const dates: string[] = [];
  const step = Math.max(1, Math.floor(dayOfYear / count));

  for (let i = 0; i < Math.min(count, dayOfYear); i++) {
    const date = new Date(firstDay);
    date.setDate(1 + i * step);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
};

// GPS coordinates for different cities (lat, lng)
const GPS_LOCATIONS = {
  boston: { lat: 42.3601, lng: -71.0589 },
  nyc: { lat: 40.7128, lng: -74.006 },
  sf: { lat: 37.7749, lng: -122.4194 },
};

// Generate a simple GPS route (straight line with slight variation)
const generateGPSRoute = (startLat: number, startLng: number, distanceKm: number): object => {
  const points = 20;
  const latDelta = 0.009 * distanceKm; // ~1km = 0.009 degrees
  const coordinates: [number, number][] = [];

  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    coordinates.push([
      startLng + (Math.random() - 0.5) * 0.001,
      startLat + latDelta * progress + (Math.random() - 0.5) * 0.001,
    ]);
  }

  return {
    type: 'LineString',
    coordinates,
  };
};

/**
 * Consistent Runner Pattern
 * 3-4 runs per week, steady pace around 5:30/km
 * Good for testing consistency insights
 */
export const consistentRunPattern = Array.from({ length: 90 }, (_, i) => {
  const dayIndex = 89 - i; // Most recent first
  const weekDay = dayIndex % 7;

  // Run on Mon, Wed, Fri, Sat (4 days/week)
  if (![1, 3, 5, 6].includes(weekDay)) return null;

  return {
    date: daysAgo(dayIndex),
    distance: 5.0 + Math.random() * 3.0, // 5-8 km
    duration: Math.floor((5.0 + Math.random() * 3.0) * 330), // ~5:30/km pace
    tag: weekDay === 6 ? 'long run' : 'easy',
    notes: weekDay === 6 ? 'Weekend long run' : 'Midweek easy run',
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, 6.0)
    ),
  };
}).filter(Boolean);

/**
 * Improving Pace Pattern
 * Pace improves from 6:00/km to 5:00/km over 90 days
 * Good for testing pace trend analysis
 */
export const improvingPacePattern = Array.from({ length: 90 }, (_, i) => {
  const dayIndex = 89 - i;
  const weekDay = dayIndex % 7;

  if (![0, 2, 4].includes(weekDay)) return null;

  const distance = 5.0 + Math.random() * 2.0;
  // Pace improves linearly: starts at 360 sec/km, ends at 300 sec/km
  const pacePerKm = 360 - (dayIndex / 90) * 60;
  const duration = Math.floor(distance * pacePerKm);

  return {
    date: daysAgo(dayIndex),
    distance,
    duration,
    tag: 'tempo',
    notes: `Training run - pace improving`,
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.nyc.lat, GPS_LOCATIONS.nyc.lng, distance)
    ),
  };
}).filter(Boolean);

/**
 * Declining Pace Pattern
 * Pace declines from 5:00/km to 6:00/km (overtraining signal)
 * Good for testing performance decline insights
 */
export const decliningPacePattern = Array.from({ length: 90 }, (_, i) => {
  const dayIndex = 89 - i;
  const weekDay = dayIndex % 7;

  if (![1, 3, 5].includes(weekDay)) return null;

  const distance = 5.0 + Math.random() * 2.0;
  // Pace declines: starts at 300 sec/km, ends at 360 sec/km
  const pacePerKm = 300 + (dayIndex / 90) * 60;
  const duration = Math.floor(distance * pacePerKm);

  return {
    date: daysAgo(dayIndex),
    distance,
    duration,
    tag: 'easy',
    notes: `Feeling tired`,
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.sf.lat, GPS_LOCATIONS.sf.lng, distance)
    ),
  };
}).filter(Boolean);

/**
 * Volume Spike Pattern
 * Sudden 50% mileage increase in recent 2 weeks
 * Good for testing volume/injury risk insights
 */
export const volumeSpikePattern = Array.from({ length: 90 }, (_, i) => {
  const dayIndex = 89 - i;
  const weekDay = dayIndex % 7;

  if (![0, 2, 4, 6].includes(weekDay)) return null;

  // Recent 14 days: higher volume
  const isRecentSpike = dayIndex < 14;
  const distance = isRecentSpike ? 8.0 + Math.random() * 4.0 : 5.0 + Math.random() * 2.0;
  const duration = Math.floor(distance * 330); // 5:30/km pace

  return {
    date: daysAgo(dayIndex),
    distance,
    duration,
    tag: isRecentSpike ? 'long run' : 'easy',
    notes: isRecentSpike ? 'Building mileage' : 'Regular run',
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, distance)
    ),
  };
}).filter(Boolean);

/**
 * Varied Locations Pattern
 * Runs in 3 different cities for heatmap testing
 */
export const variedLocationsPattern = Array.from({ length: 30 }, (_, i) => {
  const dayIndex = 29 - i;
  const weekDay = dayIndex % 7;

  if (![1, 3, 5].includes(weekDay)) return null;

  // Cycle through cities
  const cities = [GPS_LOCATIONS.boston, GPS_LOCATIONS.nyc, GPS_LOCATIONS.sf];
  const city = cities[Math.floor(dayIndex / 10) % 3];

  const distance = 5.0 + Math.random() * 3.0;

  return {
    date: daysAgo(dayIndex),
    distance,
    duration: Math.floor(distance * 330),
    tag: 'easy',
    notes: `Run in ${Object.keys(GPS_LOCATIONS)[Math.floor(dayIndex / 10) % 3]}`,
    routeGeoJson: JSON.stringify(generateGPSRoute(city.lat, city.lng, distance)),
  };
}).filter(Boolean);

/**
 * Runs with Heart Rate Data
 * For testing heart rate analytics
 */
export const runsWithHeartRateData = Array.from({ length: 20 }, (_, i) => {
  const dayIndex = 19 - i;
  const weekDay = dayIndex % 7;

  if (![0, 2, 4].includes(weekDay)) return null;

  const distance = 5.0 + Math.random() * 2.0;
  const duration = Math.floor(distance * 330);

  return {
    run: {
      date: daysAgo(dayIndex),
      distance,
      duration,
      tag: 'tempo',
      notes: 'HR monitored run',
    },
    detail: {
      avgHeartRate: 145 + Math.floor(Math.random() * 15), // 145-160 bpm
      maxHeartRate: 170 + Math.floor(Math.random() * 10), // 170-180 bpm
      hrZoneDistribution: JSON.stringify({
        zone1: 5,
        zone2: 30,
        zone3: 40,
        zone4: 20,
        zone5: 5,
      }),
      elevationGain: 50 + Math.random() * 100,
      elevationLoss: 50 + Math.random() * 100,
      temperature: 15 + Math.random() * 10,
      weatherCondition: ['Clear', 'Cloudy', 'Light Rain'][Math.floor(Math.random() * 3)],
    },
  };
}).filter(Boolean);

/**
 * Empty/Edge Cases
 */
export const edgeCases = {
  // Single run only
  singleRun: [
    {
      date: daysAgo(0),
      distance: 5.0,
      duration: 1650,
      tag: 'easy',
      notes: 'First run',
    },
  ],

  // Runs with large gaps (sporadic runner)
  sporadicPattern: [
    { date: daysAgo(1), distance: 5.0, duration: 1650, tag: 'easy' },
    { date: daysAgo(15), distance: 6.0, duration: 2000, tag: 'easy' },
    { date: daysAgo(45), distance: 5.0, duration: 1700, tag: 'easy' },
    { date: daysAgo(80), distance: 7.0, duration: 2300, tag: 'long run' },
  ],

  // Very long run (edge case for stats)
  ultraDistance: [
    {
      date: daysAgo(0),
      distance: 42.2, // Marathon
      duration: 12600, // 5:00/km pace * 42.2km
      tag: 'race',
      notes: 'Marathon race',
    },
  ],
};

/**
 * Helper function to get date range for test data
 */
export const getDateRange = (pattern: Array<{ date: string } | null>) => {
  const validDates = pattern.filter(Boolean).map(run => new Date(run!.date));
  return {
    start: new Date(Math.min(...validDates.map(d => d.getTime()))),
    end: new Date(Math.max(...validDates.map(d => d.getTime()))),
  };
};

/**
 * CURRENT-PERIOD FIXTURE GENERATORS
 * These functions generate runs within the current week/month/year
 * to match the time filtering in analytics API endpoints
 *
 * IMPORTANT: These are functions, not constants, so dates are calculated
 * at test runtime, not module load time.
 */

/**
 * Generate consistent runs for current week
 * Good for weekly statistics and trends tests
 */
export const getCurrentWeekConsistentRuns = () => {
  const dates = currentWeekDates(4); // 4 runs this week
  return dates.map((date, i) => ({
    date,
    distance: 5.0 + Math.random() * 3.0,
    duration: Math.floor((5.0 + Math.random() * 3.0) * 330), // ~5:30/km pace
    tag: i === dates.length - 1 ? 'long run' : 'easy',
    notes: i === dates.length - 1 ? 'Weekend long run' : 'Midweek easy run',
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, 6.0)
    ),
  }));
};

/**
 * Generate consistent runs for current month
 * Good for monthly statistics tests
 */
export const getCurrentMonthConsistentRuns = () => {
  const dates = currentMonthDates(12); // ~12 runs this month (3/week)
  return dates.map((date, i) => ({
    date,
    distance: 5.0 + Math.random() * 3.0,
    duration: Math.floor((5.0 + Math.random() * 3.0) * 330),
    tag: i % 4 === 3 ? 'long run' : 'easy',
    notes: `Monthly run ${i + 1}`,
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, 6.0)
    ),
  }));
};

/**
 * Generate improving pace pattern for current month
 * Good for trend analysis tests
 */
export const getCurrentMonthImprovingPace = () => {
  const dates = currentMonthDates(10); // 10 runs with improving pace
  return dates.map((date, i) => {
    const distance = 5.0 + Math.random() * 2.0;
    // Pace improves from 360 to 300 sec/km over the month
    const pacePerKm = 360 - (i / dates.length) * 60;
    const duration = Math.floor(distance * pacePerKm);

    return {
      date,
      distance,
      duration,
      tag: 'tempo',
      notes: `Training run ${i + 1} - pace improving`,
      routeGeoJson: JSON.stringify(
        generateGPSRoute(GPS_LOCATIONS.nyc.lat, GPS_LOCATIONS.nyc.lng, distance)
      ),
    };
  });
};

/**
 * Generate runs for current year
 * Good for yearly statistics tests
 */
export const getCurrentYearConsistentRuns = () => {
  const dates = currentYearDates(50); // ~50 runs spread across year so far
  return dates.map((date, i) => ({
    date,
    distance: 5.0 + Math.random() * 3.0,
    duration: Math.floor((5.0 + Math.random() * 3.0) * 330),
    tag: i % 5 === 4 ? 'long run' : 'easy',
    notes: `Run ${i + 1} of the year`,
    routeGeoJson: JSON.stringify(
      generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, 6.0)
    ),
  }));
};

/**
 * Generate volume spike in current month (last 2 weeks)
 * Good for insights tests about injury risk
 */
export const getCurrentMonthVolumeSpike = () => {
  const dates = currentMonthDates(16); // ~16 runs this month
  return dates.map((date, i) => {
    // Recent half of runs: higher volume
    const isRecent = i >= dates.length / 2;
    const distance = isRecent ? 8.0 + Math.random() * 4.0 : 5.0 + Math.random() * 2.0;
    const duration = Math.floor(distance * 330);

    return {
      date,
      distance,
      duration,
      tag: isRecent ? 'long run' : 'easy',
      notes: isRecent ? 'Building mileage' : 'Regular run',
      routeGeoJson: JSON.stringify(
        generateGPSRoute(GPS_LOCATIONS.boston.lat, GPS_LOCATIONS.boston.lng, distance)
      ),
    };
  });
};

/**
 * Generate varied locations for current month (for heatmap)
 * Runs in 3 different cities
 */
export const getCurrentMonthVariedLocations = () => {
  const dates = currentMonthDates(9); // 9 runs, 3 per city
  const cities = [GPS_LOCATIONS.boston, GPS_LOCATIONS.nyc, GPS_LOCATIONS.sf];

  return dates.map((date, i) => {
    const city = cities[i % 3];
    const cityName = Object.keys(GPS_LOCATIONS)[i % 3];
    const distance = 5.0 + Math.random() * 3.0;

    return {
      date,
      distance,
      duration: Math.floor(distance * 330),
      tag: 'easy',
      notes: `Run in ${cityName}`,
      routeGeoJson: JSON.stringify(generateGPSRoute(city.lat, city.lng, distance)),
    };
  });
};
