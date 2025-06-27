import { PrismaClient } from '@prisma/client';
import express, { NextFunction } from 'express';

import { createError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import { validateBody } from '../middleware/validateBody.js';

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/runs - Get all runs for user
router.get('/', requireAuth, async (req: AuthRequest, res, next: NextFunction) => {
  try {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });
    res.json(runs);
  } catch (error) {
    console.error('Failed to fetch runs:', error);
    next(createError('Failed to fetch runs', 500));
  }
});

// GET /api/runs/simple-list - Get simplified run list
router.get('/simple-list', requireAuth, async (req: AuthRequest, res, next: NextFunction) => {
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
  } catch (error) {
    console.error('Failed to fetch run list:', error);
    next(createError('Failed to fetch run list', 500));
  }
});

// GET /api/runs/:id - Get specific run
router.get('/:id', requireAuth, async (req: AuthRequest, res, next: NextFunction) => {
  try {
    const run = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!run) {
      return next(createError('Run not found', 404));
    }

    res.json(run);
  } catch (error: any) {
    console.error('Failed to fetch run:', error);
    if (error.statusCode === 404) {
      return next(error);
    }
    next(createError('Failed to fetch run', 500));
  }
});

// POST /api/runs - Create new run
router.post(
  '/',
  requireAuth,
  validateBody([
    { field: 'date', required: true, type: 'date' },
    { field: 'distance', required: true, type: 'number', min: 0 },
    { field: 'duration', required: true, type: 'number', min: 0 },
    { field: 'tag', required: false, type: 'string' },
    { field: 'notes', required: false, type: 'string' },
  ]),
  async (req: AuthRequest, res, next: NextFunction) => {
    try {
      const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

      console.log('Creating run for user:', req.user?.id);
      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
      });

      if (!user) {
        return next(createError('User not found', 404));
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
      console.error('Error creating run:', error);
      next(createError('Failed to create run', 500));
    }
  }
);

// PUT /api/runs/:id - Update run
router.put('/:id', requireAuth, async (req: AuthRequest, res, next: NextFunction) => {
  try {
    const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

    const existingRun = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!existingRun) {
      return next(createError('Run not found', 404));
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
    console.error('Failed to update run:', error);
    if (error.statusCode === 404) {
      return next(error);
    }
    next(createError('Failed to update run', 500));
  }
});

// DELETE /api/runs/:id - Delete run
router.delete('/:id', requireAuth, async (req: AuthRequest, res, next: NextFunction) => {
  try {
    const existingRun = await prisma.run.findFirst({
      where: {
        id: req.params.id,
        userId: req.user!.id,
      },
    });

    if (!existingRun) {
      return next(createError('Run not found', 404));
    }

    await prisma.run.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error: any) {
    console.error('Failed to delete run:', error);
    if (error.statusCode === 404) {
      return next(error);
    }
    next(createError('Failed to delete run', 500));
  }
});

export default router;
