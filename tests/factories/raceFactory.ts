import { Race } from '@prisma/client';
import { testDb } from '../fixtures/testDatabase.js';

/**
 * Race Factory
 * Functions for creating test race data
 */

export interface RaceFactoryOptions {
  userId: string;
  name?: string;
  raceDate?: Date;
  distance?: number;
  targetTime?: number | null;
  actualTime?: number | null;
  notes?: string | null;
}

/**
 * Create a basic race
 */
export async function createRace(options: RaceFactoryOptions): Promise<Race> {
  return testDb.prisma.race.create({
    data: {
      userId: options.userId,
      name: options.name || 'Test Race',
      raceDate: options.raceDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      distance: options.distance || 10, // 10K default
      targetTime: options.targetTime !== undefined ? options.targetTime : 3000, // 50 minutes
      actualTime: options.actualTime !== undefined ? options.actualTime : null,
      notes: options.notes !== undefined ? options.notes : 'Race notes',
    },
  });
}

/**
 * Create a past race with results
 */
export async function createPastRace(userId: string, daysAgo: number = 7): Promise<Race> {
  const raceDate = new Date();
  raceDate.setDate(raceDate.getDate() - daysAgo);

  return createRace({
    userId,
    name: 'Past Race',
    raceDate,
    distance: 21.1, // Half marathon
    targetTime: 6300, // 1:45:00
    actualTime: 6240, // 1:44:00 - beat target!
    notes: 'Great race, beat my target time!',
  });
}

/**
 * Create an upcoming race
 */
export async function createUpcomingRace(userId: string, daysFromNow: number = 30): Promise<Race> {
  const raceDate = new Date();
  raceDate.setDate(raceDate.getDate() + daysFromNow);

  return createRace({
    userId,
    name: 'Upcoming Marathon',
    raceDate,
    distance: 42.195,
    targetTime: 14400, // 4:00:00
    actualTime: null,
    notes: 'Training hard for this one',
  });
}

/**
 * Create multiple races
 */
export async function createRaceSeries(userId: string, count: number = 3): Promise<Race[]> {
  const races: Race[] = [];
  const raceTypes = [
    { name: '5K Fun Run', distance: 5, targetTime: 1500 },
    { name: '10K Challenge', distance: 10, targetTime: 3000 },
    { name: 'Half Marathon', distance: 21.1, targetTime: 6300 },
    { name: 'Marathon', distance: 42.195, targetTime: 14400 },
  ];

  for (let i = 0; i < count; i++) {
    const raceType = raceTypes[i % raceTypes.length];
    const daysOffset = (i - Math.floor(count / 2)) * 60; // Spread over time
    const raceDate = new Date();
    raceDate.setDate(raceDate.getDate() + daysOffset);

    const race = await createRace({
      userId,
      name: raceType.name,
      raceDate,
      distance: raceType.distance,
      targetTime: raceType.targetTime,
      actualTime: daysOffset < 0 ? raceType.targetTime - 60 : null, // Past races have results
    });
    races.push(race);
  }

  return races;
}
