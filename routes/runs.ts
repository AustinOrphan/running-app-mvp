import { PrismaClient } from '@prisma/client';
import express from 'express';

import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { createNotFoundError, createForbiddenError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import {
  validateCreateRun,
  validateUpdateRun,
  validateIdParam,
  sanitizeInput,
  securityHeaders,
} from '../middleware/validation.js';
import { createRateLimit, readRateLimit, apiRateLimit } from '../middleware/rateLimiting.js';
import { logUserAction } from '../utils/secureLogger.js';

const router = express.Router();
const prisma = new PrismaClient();

// Apply security headers to all runs routes
router.use(securityHeaders);

// Apply input sanitization to all runs routes
router.use(sanitizeInput);

// GET /api/runs - Get all runs for user
router.get(
  '/',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const runs = await prisma.run.findMany({
      where: { userId: req.user!.id },
      orderBy: { date: 'desc' },
    });
    return res.json(runs);
  })
);

// GET /api/runs/simple-list - Get simplified run list
router.get(
  '/simple-list',
  readRateLimit,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
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
    return res.json(runs);
  })
);

// GET /api/runs/:id - Get specific run
router.get(
  '/:id',
  readRateLimit,
  validateIdParam,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    // First check if run exists
    const run = await prisma.run.findUnique({
      where: { id: req.params.id },
    });

    if (!run) {
      return next(createNotFoundError('Run'));
    }

    // Then check ownership
    if (run.userId !== req.user!.id) {
      return next(createForbiddenError('Access denied to this run'));
    }

    return res.json(run);
  })
);

// POST /api/runs - Create new run
router.post(
  '/',
  createRateLimit,
  validateCreateRun,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

    logUserAction('Creating run', req, {
      distance: Number(distance),
      duration: Number(duration),
      hasRoute: !!routeGeoJson,
    });
    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
    });

    if (!user) {
      return next(createNotFoundError('User'));
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

    return res.status(201).json(run);
  })
);

// PUT /api/runs/:id - Update run
router.put(
  '/:id',
  apiRateLimit,
  validateIdParam,
  validateUpdateRun,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const { date, distance, duration, tag, notes, routeGeoJson } = req.body;

    // First check if run exists
    const existingRun = await prisma.run.findUnique({
      where: { id: req.params.id },
    });

    if (!existingRun) {
      return next(createNotFoundError('Run'));
    }

    // Then check ownership
    if (existingRun.userId !== req.user!.id) {
      return next(createForbiddenError('Access denied to this run'));
    }
    const updateData: Partial<{
      date: Date;
      distance: number;
      duration: number;
      tag: string | null;
      notes: string | null;
      routeGeoJson: string | null;
    }> = {};
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
      updateData.routeGeoJson = routeGeoJson ? JSON.stringify(routeGeoJson) : null;
    }

    const run = await prisma.run.update({
      where: { id: req.params.id },
      data: updateData,
    });

    return res.json(run);
  })
);

// DELETE /api/runs/:id - Delete run
router.delete(
  '/:id',
  apiRateLimit,
  validateIdParam,
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    // First check if run exists
    const existingRun = await prisma.run.findUnique({
      where: { id: req.params.id },
    });

    if (!existingRun) {
      return next(createNotFoundError('Run'));
    }

    // Then check ownership
    if (existingRun.userId !== req.user!.id) {
      return next(createForbiddenError('Access denied to this run'));
    }
    await prisma.run.delete({
      where: { id: req.params.id },
    });

    return res.status(204).send();
  })
);

export default router;
