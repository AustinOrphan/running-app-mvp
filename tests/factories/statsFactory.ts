import { Run } from '@prisma/client';
import { createRun } from './runFactory.js';

/**
 * Statistics Factory
 * Functions for creating test data that generates specific statistics patterns
 */

export interface WeeklyStatsData {
  totalDistance: number;
  totalDuration: number;
  totalRuns: number;
  avgPace: number;
  weekStart: Date;
  weekEnd: Date;
}

export interface MonthlyStatsData {
  month: string;
  year: number;
  totalDistance: number;
  totalDuration: number;
  totalRuns: number;
  avgPace: number;
  longestRun: number;
}

/**
 * Create runs for weekly statistics
 */
export async function createWeeklyStats(
  userId: string,
  weeksAgo: number = 0,
  runCount: number = 4
): Promise<{ runs: Run[]; stats: WeeklyStatsData }> {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() - weeksAgo * 7);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const runs: Run[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < runCount; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + Math.floor((i * 7) / runCount));

    const distance = 5 + Math.random() * 10; // 5-15 km
    const pace = 300 + Math.random() * 60; // 5:00-6:00 per km
    const duration = Math.round(distance * pace);

    const run = await createRun({
      userId,
      date,
      distance,
      duration,
    });

    runs.push(run);
    totalDistance += distance;
    totalDuration += duration;
  }

  const avgPace = totalDistance > 0 ? totalDuration / totalDistance : 0;

  return {
    runs,
    stats: {
      totalDistance,
      totalDuration,
      totalRuns: runCount,
      avgPace,
      weekStart,
      weekEnd,
    },
  };
}

/**
 * Create runs for monthly statistics
 */
export async function createMonthlyStats(
  userId: string,
  monthsAgo: number = 0,
  runsPerWeek: number = 3
): Promise<{ runs: Run[]; stats: MonthlyStatsData }> {
  const date = new Date();
  date.setMonth(date.getMonth() - monthsAgo);
  const year = date.getFullYear();
  const month = date.getMonth();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const weeks = Math.ceil(monthEnd.getDate() / 7);

  const runs: Run[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  let longestRun = 0;

  for (let week = 0; week < weeks; week++) {
    for (let i = 0; i < runsPerWeek; i++) {
      const runDate = new Date(monthStart);
      runDate.setDate(runDate.getDate() + week * 7 + Math.floor((i * 7) / runsPerWeek));

      if (runDate <= monthEnd) {
        const distance = 3 + Math.random() * 15; // 3-18 km
        const pace = 280 + Math.random() * 80; // 4:40-6:00 per km
        const duration = Math.round(distance * pace);

        const run = await createRun({
          userId,
          date: runDate,
          distance,
          duration,
        });

        runs.push(run);
        totalDistance += distance;
        totalDuration += duration;
        longestRun = Math.max(longestRun, distance);
      }
    }
  }

  const avgPace = totalDistance > 0 ? totalDuration / totalDistance : 0;
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  return {
    runs,
    stats: {
      month: monthNames[month],
      year,
      totalDistance,
      totalDuration,
      totalRuns: runs.length,
      avgPace,
      longestRun,
    },
  };
}

/**
 * Create runs for yearly statistics
 */
export async function createYearlyStats(
  userId: string,
  year: number = new Date().getFullYear()
): Promise<Run[]> {
  const runs: Run[] = [];

  // Create runs for each month
  for (let month = 0; month < 12; month++) {
    const monthsAgo = (new Date().getFullYear() - year) * 12 + (new Date().getMonth() - month);
    if (monthsAgo >= 0) {
      const monthData = await createMonthlyStats(userId, monthsAgo, 3);
      runs.push(...monthData.runs);
    }
  }

  return runs;
}

/**
 * Create progress data for goals
 */
export async function createProgressData(
  userId: string,
  days: number = 30,
  targetDistance: number = 100
): Promise<Run[]> {
  const runs: Run[] = [];
  const dailyTarget = targetDistance / days;
  const accumulated = 0;

  for (let day = 0; day < days; day++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - day - 1));

    // Some days no run
    if (Math.random() > 0.3) {
      // Vary around daily target
      const distance = dailyTarget * (0.5 + Math.random());

      const run = await createRun({
        userId,
        date,
        distance,
      });
      runs.push(run);
    }
  }

  return runs;
}

/**
 * Create trend data showing improvement
 */
export async function createTrendData(
  userId: string,
  weeks: number = 12,
  improvementRate: number = 0.02 // 2% weekly improvement
): Promise<Run[]> {
  const runs: Run[] = [];
  const baseDistance = 5;
  const basePace = 360; // 6:00 per km

  for (let week = 0; week < weeks; week++) {
    const weeklyRuns = 3 + Math.floor(Math.random() * 2); // 3-4 runs per week
    const improvement = Math.pow(1 + improvementRate, week);

    for (let i = 0; i < weeklyRuns; i++) {
      const date = new Date();
      date.setDate(date.getDate() - (weeks - week - 1) * 7 - Math.floor((i * 7) / weeklyRuns));

      const distance = baseDistance * improvement * (0.8 + Math.random() * 0.4);
      const pace = (basePace / improvement) * (0.9 + Math.random() * 0.2);

      const run = await createRun({
        userId,
        date,
        distance,
        duration: Math.round(distance * pace),
      });
      runs.push(run);
    }
  }

  return runs.sort((a, b) => a.date.getTime() - b.date.getTime());
}
