import { Run } from '@prisma/client';
import { testDb } from '../fixtures/testDatabase.js';

/**
 * Run Factory
 * Functions for creating test run data with various configurations
 */

export interface RunFactoryOptions {
  userId: string;
  date?: Date;
  distance?: number;
  duration?: number;
  tag?: string;
  notes?: string;
  routeGeoJson?: string | null;
}

/**
 * Create a basic run
 */
export async function createRun(options: RunFactoryOptions): Promise<Run> {
  return testDb.prisma.run.create({
    data: {
      userId: options.userId,
      date: options.date || new Date(),
      distance: options.distance || 5.0,
      duration: options.duration || 1800, // 30 minutes
      tag: options.tag || 'Easy Run',
      notes: options.notes || 'Test run',
      routeGeoJson: options.routeGeoJson || null,
    },
  });
}

/**
 * Create a run with route
 */
export async function createRunWithRoute(
  options: Omit<RunFactoryOptions, 'routeGeoJson'>
): Promise<Run> {
  return createRun({
    ...options,
    routeGeoJson: JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122.4194, 37.7749],
          [-122.4195, 37.775],
          [-122.4196, 37.7751],
        ],
      },
      properties: { name: 'Test Route' },
    }),
  });
}

/**
 * Create multiple runs
 */
export async function createRunSeries(userId: string, count: number = 5): Promise<Run[]> {
  const runs: Run[] = [];

  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const run = await createRun({
      userId,
      date,
      distance: 3 + Math.random() * 7,
      duration: 900 + Math.floor(Math.random() * 2700),
    });
    runs.push(run);
  }

  return runs;
}
EOF < /dev/llnu;
