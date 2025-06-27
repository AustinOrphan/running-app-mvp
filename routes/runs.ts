import { PrismaClient } from '@prisma/client';
import express from 'express';

import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { validateCreateRun, validateUpdateRun, validateIdParam, sanitizeInput, securityHeaders } from '../middleware/validation.js';
import { createRateLimit, readRateLimit, apiRateLimit } from '../middleware/rateLimiting.js';
import { logUserAction, logError } from '../utils/secureLogger.js';

const router = express.Router();
const prisma = new PrismaClient();

// Apply security headers to all runs routes
router.use(securityHeaders);

// Apply input sanitization to all runs routes
router.use(sanitizeInput);

// GET /api/runs - Get all runs for user
router.get('/', readRateLimit, requireAuth, async (req: AuthRequest, res) => {
  try {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });
    res.json(runs);
  } catch {
    throw createError('Failed to fetch runs', 500);
  }
});

// GET /api/runs/simple-list - Get simplified run list
router.get('/simple-list', readRateLimit, requireAuth, async (req: AuthRequest, res) => {
  try {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        date: true,
        distance: true,
        duration: true,
        tag: true,
      },
      orderBy: { date: 'desc' },
    });
    res.json(runs);
  } catch {
    throw createError('Failed to fetch run list', 500);
  }
});

// GET /api/runs/:id - Get specific run
router.get('/:id', readRateLimit, validateIdParam, requireAuth, async (req: AuthRequest, res) => {
  try {
    const run = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!run) {
      throw createError('Run not found', 404);
    }

    res.json(run);
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw error;
    }
    throw createError('Failed to fetch run', 500);
  }
});

// POST /api/runs - Create new run
router.post(
  '/',
  createRateLimit,
  validateCreateRun,
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

      logUserAction('Creating run', req, { 
        distance: Number(distance), 
        duration: Number(duration),
        hasRoute: !!routeGeoJson 
      });
      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
      });

      if (!user) {
        throw createError('User not found', 404);
      }

      const run = await prisma.run.create({
        data: {
          userId: req.user!.id,
          date: new Date(date),
          distance: Number(distance),
          duration: Number(duration),
          tag: tag || null,
          notes: notes || null,
          routeGeoJson: routeGeoJson || null,
        },
      });

      res.status(201).json(run);
    } catch (error) {
      logError('Failed to create run', req, error instanceof Error ? error : new Error(String(error)));
      throw createError('Failed to create run', 500);
    }
  }
);

// PUT /api/runs/:id - Update run
router.put('/:id', apiRateLimit, validateIdParam, validateUpdateRun, requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

    const existingRun = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!existingRun) {
      throw createError('Run not found', 404);
    }

    const updateData: any = {};
    if (date !== undefined) {
      updateData.date = new Date(date);
    }
    if (distance !== undefined) {
      updateData.distance = Number(distance);
    }
    if (duration !== undefined) {
      updateData.duration = Number(duration);
    }
    if (tag !== undefined) {
      updateData.tag = tag || null;
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
    }
    if (routeGeoJson !== undefined) {
      updateData.routeGeoJson = routeGeoJson || null;
    }

    const run = await prisma.run.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json(run);
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw error;
    }
    throw createError('Failed to update run', 500);
  }
});

// DELETE /api/runs/:id - Delete run
router.delete('/:id', apiRateLimit, validateIdParam, requireAuth, async (req: AuthRequest, res) => {
  try {
    const existingRun = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!existingRun) {
      throw createError('Run not found', 404);
    }

    await prisma.run.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw error;
    }
    throw createError('Failed to delete run', 500);
  }
});

export default router;
