import express from 'express';

import { asyncAuthHandler } from '../middleware/asyncHandler';
import { createNotFoundError } from '../middleware/errorHandler';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import {
  sanitizeInput,
  validateCreateRace,
  validateUpdateRace,
  validateIdParam,
} from '../middleware/validation';
import { prisma } from '../server';

const router = express.Router();

// Apply input sanitization to all race routes
router.use(sanitizeInput);

// GET /api/races - Get all races for authenticated user
router.get(
  '/',
  requireAuth,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const races = await prisma.race.findMany({
      where: { userId: req.user!.id },
      orderBy: { raceDate: 'asc' },
    });

    return res.json(races);
  })
);

// GET /api/races/:id - Get specific race
router.get(
  '/:id',
  requireAuth,
  validateIdParam,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const race = await prisma.race.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!race) {
      return next(createNotFoundError('Race'));
    }

    return res.json(race);
  })
);

// POST /api/races - Create new race
router.post(
  '/',
  requireAuth,
  validateCreateRace,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    const { name, raceDate, distance, targetTime, actualTime, notes } = req.body;

    const race = await prisma.race.create({
      data: {
        userId: req.user!.id,
        name: name.trim(),
        raceDate: new Date(raceDate),
        distance: Number(distance),
        targetTime: targetTime !== undefined ? Number(targetTime) : undefined,
        actualTime: actualTime !== undefined ? Number(actualTime) : undefined,
        notes: notes ?? null,
      },
    });

    return res.status(201).json(race);
  })
);

// PUT /api/races/:id - Update race
router.put(
  '/:id',
  requireAuth,
  validateIdParam,
  validateUpdateRace,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const existingRace = await prisma.race.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existingRace) {
      return next(createNotFoundError('Race'));
    }

    const { name, raceDate, distance, targetTime, actualTime, notes } = req.body;
    const data: prisma.race = {};
    if (name !== undefined) data.name = name.trim();
    if (raceDate !== undefined) data.raceDate = new Date(raceDate);
    if (distance !== undefined) data.distance = Number(distance);
    if (targetTime !== undefined) data.targetTime = Number(targetTime);
    if (actualTime !== undefined) data.actualTime = Number(actualTime);
    if (notes !== undefined) data.notes = notes ?? null;

    const updated = await prisma.race.update({
      where: { id: req.params.id },
      data,
    });

    return res.json(updated);
  })
);

// DELETE /api/races/:id - Delete race
router.delete(
  '/:id',
  requireAuth,
  validateIdParam,
  asyncAuthHandler(async (req: AuthRequest, res, next) => {
    const existingRace = await prisma.race.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existingRace) {
      return next(createNotFoundError('Race'));
    }

    await prisma.race.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  })
);

export default router;
