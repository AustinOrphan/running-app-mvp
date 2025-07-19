import express from 'express';
import { Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { GeospatialService } from '../services/geospatialService.js';
import { apiRateLimit } from '../middleware/rateLimiting.js';
import { validateQuery } from '../middleware/validation.js';
import { z } from 'zod';

const router = express.Router();

// Validation schemas
const analyticsQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional().default('monthly'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  lookback: z.coerce.number().min(1).max(52).optional().default(12),
});

const heatmapQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  cellSize: z.coerce.number().min(0.1).max(5).optional().default(0.5),
  format: z.enum(['points', 'grid']).optional().default('points'),
});

/**
 * GET /api/analytics/statistics
 * Get comprehensive running statistics
 */
router.get(
  '/statistics',
  apiRateLimit,
  requireAuth,
  validateQuery(analyticsQuerySchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { period, startDate, endDate, lookback } = req.query;

    let start: Date;
    let end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string);
      end = new Date(endDate as string);
    } else {
      // Default to last period
      end = new Date();
      const lookbackNum = Number(lookback) || 12;
      const monthsBack =
        period === 'yearly'
          ? lookbackNum * 12
          : period === 'monthly'
            ? lookbackNum
            : period === 'weekly'
              ? Math.ceil(lookbackNum / 4)
              : 1;
      start = new Date();
      start.setMonth(start.getMonth() - monthsBack);
    }

    const statistics = await AnalyticsService.calculateStatistics(userId, start, end);
    const trends = await AnalyticsService.generateTrends(
      userId,
      period as any,
      Number(lookback) || 12
    );
    const insights = await AnalyticsService.generateInsights(userId);

    res.json({
      period: {
        start,
        end,
      },
      statistics: {
        ...statistics,
        trends,
        insights,
      },
    });
  })
);

/**
 * GET /api/analytics/trends
 * Get trend analysis data
 */
router.get(
  '/trends',
  apiRateLimit,
  requireAuth,
  validateQuery(analyticsQuerySchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { period, lookback } = req.query;

    const trends = await AnalyticsService.generateTrends(
      userId,
      period as 'weekly' | 'monthly' | 'yearly',
      Number(lookback) || 12
    );

    res.json({ trends });
  })
);

/**
 * GET /api/analytics/insights
 * Get AI-generated insights
 */
router.get(
  '/insights',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const insights = await AnalyticsService.generateInsights(userId);

    res.json({ insights });
  })
);

/**
 * GET /api/analytics/heatmap
 * Get location heatmap data
 */
router.get(
  '/heatmap',
  apiRateLimit,
  requireAuth,
  validateQuery(heatmapQuerySchema),
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { startDate, endDate, cellSize, format } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    if (format === 'grid') {
      // Return grid-based heatmap for visualization
      const gridHeatmap = await GeospatialService.createGridHeatmap(
        userId,
        Number(cellSize) || 0.5,
        'kilometers'
      );

      res.json({
        type: 'grid',
        data: gridHeatmap,
      });
    } else {
      // Return point-based heatmap
      const heatmapPoints = await GeospatialService.generateHeatmap(userId, start, end);

      res.json({
        type: 'points',
        data: heatmapPoints,
      });
    }
  })
);

/**
 * GET /api/analytics/routes/popular
 * Get popular running routes
 */
router.get(
  '/routes/popular',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const minOverlap = Number(req.query.minOverlap) || 0.5;

    const popularRoutes = await GeospatialService.findPopularRoutes(userId, minOverlap);

    res.json({ routes: popularRoutes });
  })
);

/**
 * POST /api/analytics/update
 * Trigger analytics update for a specific period
 */
router.post(
  '/update',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { period } = req.body;

    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) {
      res.status(400).json({
        message: 'Invalid period. Must be daily, weekly, monthly, or yearly.',
      });
      return;
    }

    await AnalyticsService.updateAnalytics(userId, period);

    res.json({
      message: `Analytics updated for ${period} period`,
    });
  })
);

/**
 * GET /api/analytics/performance/zones
 * Get heart rate and pace zones analysis
 */
router.get(
  '/performance/zones',
  apiRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const { days = 30 } = req.query;

    // This would analyze heart rate zones and pace zones
    // For now, return a placeholder structure
    const zones = {
      heartRate: {
        zone1: { min: 0, max: 120, percentage: 15 }, // Recovery
        zone2: { min: 120, max: 140, percentage: 65 }, // Aerobic
        zone3: { min: 140, max: 160, percentage: 15 }, // Tempo
        zone4: { min: 160, max: 180, percentage: 4 }, // Threshold
        zone5: { min: 180, max: 200, percentage: 1 }, // VO2 Max
      },
      pace: {
        easy: { minPace: 6.0, maxPace: 7.0, percentage: 70 },
        tempo: { minPace: 4.5, maxPace: 5.5, percentage: 20 },
        hard: { minPace: 3.5, maxPace: 4.5, percentage: 10 },
      },
    };

    res.json({ zones, period: `${days} days` });
  })
);

export default router;
