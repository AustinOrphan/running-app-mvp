import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { createError } from '../middleware/errorHandler.js';

const router = express.Router();
const prisma = new PrismaClient();

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
  } catch (error) {
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

    const breakdown = runs.reduce((acc, run) => {
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
    }, {} as Record<string, { count: number; totalDistance: number; totalDuration: number }>);

    const breakdownArray = Object.entries(breakdown).map(([tag, data]) => ({
      tag,
      count: data.count,
      totalDistance: Number(data.totalDistance.toFixed(2)),
      totalDuration: data.totalDuration,
      avgPace: data.totalDistance > 0 ? Number((data.totalDuration / data.totalDistance).toFixed(2)) : 0,
    }));

    res.json(breakdownArray);
  } catch (error) {
    throw createError('Failed to fetch type breakdown', 500);
  }
});

export default router;