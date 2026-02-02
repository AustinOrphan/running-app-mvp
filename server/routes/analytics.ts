import express from 'express';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { sanitizeInput, securityHeaders } from '../middleware/validation.js';
import { readRateLimit } from '../middleware/rateLimiting.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { GeospatialService } from '../services/geospatialService.js';
import { prisma } from '../../lib/prisma.js';

const router = express.Router();

// Apply security headers to all analytics routes
router.use(securityHeaders);

// Apply input sanitization
router.use(sanitizeInput);

/**
 * GET /api/analytics/statistics
 * Get aggregated running statistics for a time period
 * Query params: period (weekly|monthly|yearly)
 */
router.get(
  '/statistics',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const period = (req.query.period as string) || 'weekly';

    if (!['weekly', 'monthly', 'yearly'].includes(period)) {
      res.status(400).json({ error: 'Invalid period. Must be weekly, monthly, or yearly.' });
      return;
    }

    const stats = await AnalyticsService.getStatistics(
      req.user!.id,
      period as 'weekly' | 'monthly' | 'yearly'
    );

    res.json(stats);
  })
);

/**
 * GET /api/analytics/trends
 * Get trend analysis over multiple time periods
 * Query params:
 *  - period (weekly|monthly)
 *  - dataPoints (2-52)
 */
router.get(
  '/trends',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const period = (req.query.period as string) || 'weekly';
    const dataPoints = parseInt(req.query.dataPoints as string) || 12;

    if (!['weekly', 'monthly'].includes(period)) {
      res.status(400).json({ error: 'Invalid period. Must be weekly or monthly.' });
      return;
    }

    if (dataPoints < 2 || dataPoints > 52) {
      res.status(400).json({ error: 'dataPoints must be between 2 and 52.' });
      return;
    }

    const trends = await AnalyticsService.getTrends(
      req.user!.id,
      period as 'weekly' | 'monthly',
      dataPoints
    );

    res.json(trends);
  })
);

/**
 * GET /api/analytics/insights
 * Get rule-based algorithmic insights about running performance
 */
router.get(
  '/insights',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const insights = await AnalyticsService.generateInsights(req.user!.id);

    res.json({ insights });
  })
);

/**
 * GET /api/analytics/heatmap
 * Get GPS heatmap of running locations
 * Query params: gridSize (0.1-5.0 km)
 */
router.get(
  '/heatmap',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const gridSize = parseFloat(req.query.gridSize as string) || 0.5;

    if (gridSize < 0.1 || gridSize > 5.0) {
      res.status(400).json({ error: 'gridSize must be between 0.1 and 5.0 km.' });
      return;
    }

    // Fetch all runs with GPS data for the user
    const runs = await prisma.run.findMany({
      where: {
        userId: req.user!.id,
        routeGeoJson: { not: null },
      },
      select: {
        routeGeoJson: true,
      },
    });

    // Extract all GPS points from routes
    const allPoints: Array<[number, number]> = [];

    for (const run of runs) {
      if (run.routeGeoJson) {
        try {
          const geoJson = JSON.parse(run.routeGeoJson);
          if (geoJson.type === 'LineString' && Array.isArray(geoJson.coordinates)) {
            allPoints.push(...geoJson.coordinates);
          }
        } catch {
          // Skip invalid GeoJSON
          continue;
        }
      }
    }

    const heatmap = GeospatialService.generateHeatmap(allPoints, gridSize);

    res.json(heatmap);
  })
);

export default router;
