import { PrismaClient } from '@prisma/client';
import express from 'express';

import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { validateStatsQuery, sanitizeInput, securityHeaders } from '../middleware/validation.js';
import { readRateLimit } from '../middleware/rateLimiting.js';
import { logError } from '../utils/secureLogger.js';

const router = express.Router();
const prisma = new PrismaClient();

// Apply security headers to all stats routes
router.use(securityHeaders);

// Apply input sanitization to all stats routes
router.use(sanitizeInput);

// Apply read rate limiting to all stats routes (they're all read-only)
router.use(readRateLimit);

// GET /api/stats/insights-summary - Get weekly insights summary
router.get('/insights-summary', requireAuth, async (req: AuthRequest, res) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyRuns = await prisma.run.findMany({
      where: {
        userId: req.user!.id,
        date: {
          gte: oneWeekAgo,
        },
      },
    });

    const totalDistance = weeklyRuns.reduce((sum, run) => sum + run.distance, 0);
    const totalDuration = weeklyRuns.reduce((sum, run) => sum + run.duration, 0);
    const totalRuns = weeklyRuns.length;

    const avgPace = totalDistance > 0 ? totalDuration / totalDistance : 0;

    res.json({
      totalDistance: Number(totalDistance.toFixed(2)),
      totalDuration,
      totalRuns,
      avgPace: Number(avgPace.toFixed(2)),
      weekStart: oneWeekAgo.toISOString(),
      weekEnd: new Date().toISOString(),
    });
  } catch {
    throw createError('Failed to fetch insights summary', 500);
  }
});

// GET /api/stats/type-breakdown - Get run type breakdown
router.get('/type-breakdown', requireAuth, async (req: AuthRequest, res) => {
  try {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      select: {
        tag: true,
        distance: true,
        duration: true,
      },
    });

    const breakdown = runs.reduce(
      (acc, run) => {
        const tag = run.tag || 'Untagged';

        if (!acc[tag]) {
          acc[tag] = {
            count: 0,
            totalDistance: 0,
            totalDuration: 0,
          };
        }

        acc[tag].count++;
        acc[tag].totalDistance += run.distance;
        acc[tag].totalDuration += run.duration;

        return acc;
      },
      {} as Record<string, { count: number; totalDistance: number; totalDuration: number }>
    );

    const breakdownArray = Object.entries(breakdown).map(([tag, data]) => ({
      tag,
      count: data.count,
      totalDistance: Number(data.totalDistance.toFixed(2)),
      totalDuration: data.totalDuration,
      avgPace:
        data.totalDistance > 0 ? Number((data.totalDuration / data.totalDistance).toFixed(2)) : 0,
    }));

    res.json(breakdownArray);
  } catch {
    throw createError('Failed to fetch type breakdown', 500);
  }
});

// GET /api/stats/trends - Get historical trends data
router.get('/trends', validateStatsQuery, requireAuth, async (req: AuthRequest, res) => {
  try {
    const { period = '3m' } = req.query; // 1m, 3m, 6m, 1y

    let daysBack = 90; // default 3 months
    switch (period) {
      case '1m':
        daysBack = 30;
        break;
      case '6m':
        daysBack = 180;
        break;
      case '1y':
        daysBack = 365;
        break;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const runs = await prisma.run.findMany({
      where: {
        userId: req.user!.id,
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        distance: true,
        duration: true,
      },
    });

    // Group by week for smoother trends
    const weeklyData = runs.reduce(
      (acc, run) => {
        const weekStart = new Date(run.date);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];

        if (!acc[weekKey]) {
          acc[weekKey] = {
            date: weekKey,
            distance: 0,
            duration: 0,
            runCount: 0,
          };
        }

        acc[weekKey].distance += run.distance;
        acc[weekKey].duration += run.duration;
        acc[weekKey].runCount++;

        return acc;
      },
      {} as Record<string, { date: string; distance: number; duration: number; runCount: number }>
    );

    const trendsData = Object.values(weeklyData).map(week => ({
      date: week.date,
      distance: Number(week.distance.toFixed(2)),
      duration: week.duration,
      pace: week.distance > 0 ? Number((week.duration / week.distance).toFixed(2)) : 0,
      weeklyDistance: Number(week.distance.toFixed(2)),
    }));

    res.json(trendsData);
  } catch (error) {
    logError('Failed to fetch trends data', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to fetch trends data', 500);
  }
});

// GET /api/stats/personal-records - Get personal best records
router.get('/personal-records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });

    // Common distances to track PRs for (in km)
    const distances = [1, 2, 5, 10, 15, 21.1, 42.2];
    const records: Array<{
      distance: number;
      bestTime: number;
      bestPace: number;
      date: string;
      runId: string;
    }> = [];

    distances.forEach(targetDistance => {
      // Find runs within 10% of target distance
      const relevantRuns = runs.filter(
        run => Math.abs(run.distance - targetDistance) <= targetDistance * 0.1
      );

      if (relevantRuns.length > 0) {
        // Find best time (lowest duration) for this distance
        const bestRun = relevantRuns.reduce((best, current) =>
          current.duration < best.duration ? current : best
        );

        records.push({
          distance: targetDistance,
          bestTime: bestRun.duration,
          bestPace: Number((bestRun.duration / bestRun.distance).toFixed(2)),
          date: bestRun.date.toISOString(),
          runId: bestRun.id,
        });
      }
    });

    // Sort by distance
    records.sort((a, b) => a.distance - b.distance);

    res.json(records);
  } catch (error) {
    logError('Failed to fetch personal records', req, error instanceof Error ? error : new Error(String(error)));
    throw createError('Failed to fetch personal records', 500);
  }
});

export default router;
