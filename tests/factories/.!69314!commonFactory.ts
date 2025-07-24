import { faker } from "@faker-js/faker";
import crypto from "crypto";

/**
 * Common Test Utilities
 * Shared functions for generating test data
 */

/**
 * Generate a unique test email
 */
export function generateEmail(prefix: string = "test"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}@test.com`;
}

/**
 * Generate a secure test password
 */
export function generatePassword(length: number = 12): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let password = "";
  
  // Ensure at least one of each type
  password += "A"; // uppercase
  password += "a"; // lowercase
  password += "1"; // number
  password += "!"; // special
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Shuffle the password
  return password.split("").sort(() => Math.random() - 0.5).join("");
}

/**
 * Generate date ranges
 */
export interface DateRange {
  start: Date;
  end: Date;
}

export function generateDateRange(daysBack: number = 30, daysForward: number = 0): DateRange {
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date();
  end.setDate(end.getDate() + daysForward);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
}

/**
 * Generate dates within a range
 */
export function generateDates(count: number, range?: DateRange): Date[] {
  const { start, end } = range || generateDateRange();
  const dates: Date[] = [];
  
  for (let i = 0; i < count; i++) {
    const timestamp = start.getTime() + Math.random() * (end.getTime() - start.getTime());
    dates.push(new Date(timestamp));
  }
  
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Generate GeoJSON for routes
 */
export function generateGeoJSON(points: number = 100): string {
  const centerLat = faker.location.latitude({ min: 25, max: 50 });
  const centerLng = faker.location.longitude({ min: -125, max: -65 });
  
  const coordinates: number[][] = [];
  let currentLat = centerLat;
  let currentLng = centerLng;
  
  // Generate a realistic route
  for (let i = 0; i < points; i++) {
    // Small random walk
    currentLat += (Math.random() - 0.5) * 0.001;
    currentLng += (Math.random() - 0.5) * 0.001;
    
    // Occasionally larger changes for turns
    if (i % 10 === 0) {
      currentLat += (Math.random() - 0.5) * 0.005;
      currentLng += (Math.random() - 0.5) * 0.005;
    }
    
    coordinates.push([currentLng, currentLat]);
  }
  
  // Sometimes close the loop
  if (Math.random() > 0.5) {
    coordinates.push([centerLng, centerLat]);
  }
  
  return JSON.stringify({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates,
    },
    properties: {
      name: faker.helpers.arrayElement(["Morning Route", "Evening Run", "Park Loop", "Trail Run"]),
      distance: faker.number.float({ min: 3, max: 21, multipleOf: 0.1 }),
      elevation_gain: faker.number.int({ min: 0, max: 500 }),
      surface: faker.helpers.arrayElement(["road", "trail", "track", "mixed"]),
    },
  });
}

/**
 * Generate unique identifiers
 */
export function generateId(prefix: string = "id"): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Generate realistic run tags
 */
export function generateRunTag(): string {
  return faker.helpers.arrayElement([
    "Easy Run",
    "Long Run",
    "Tempo Run",
    "Interval Training",
    "Recovery Run",
    "Race",
    "Track Workout",
    "Hill Repeats",
    "Fartlek",
    "Progression Run",
  ]);
}

/**
 * Generate realistic pace (seconds per km)
 */
export function generatePace(type: "easy" | "tempo" | "speed" | "race" = "easy"): number {
  const paceRanges = {
    easy: { min: 330, max: 420 }, // 5:30 - 7:00 per km
    tempo: { min: 270, max: 330 }, // 4:30 - 5:30 per km
    speed: { min: 210, max: 270 }, // 3:30 - 4:30 per km
    race: { min: 240, max: 360 },  // 4:00 - 6:00 per km
  };
  
  const range = paceRanges[type];
  return faker.number.int({ min: range.min, max: range.max });
}

/**
 * Generate goal colors
 */
export function generateGoalColor(): string {
  return faker.helpers.arrayElement([
    "#3b82f6", // blue
    "#ef4444", // red
    "#10b981", // green
    "#f59e0b", // amber
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#14b8a6", // teal
    "#f97316", // orange
  ]);
}

/**
 * Generate goal icons
 */
export function generateGoalIcon(): string {
  return faker.helpers.arrayElement([
