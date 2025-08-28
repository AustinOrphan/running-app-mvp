import express from 'express';

import { prisma } from '../../lib/prisma.js';
import { asyncAuthHandler } from '../middleware/asyncHandler.js';
import { createNotFoundError, createForbiddenError } from '../middleware/errorHandler.js';
import { requireAuth, AuthRequest } from '../middleware/requireAuth.js';
import {
  sanitizeInput,
  validateCreateRace,
  validateUpdateRace,
  validateIdParam,
} from '../middleware/validation.js';

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

    res.json(races);
  })
);

// GET /api/races/:id - Get specific race
router.get(
  '/:id',
  requireAuth,
  validateIdParam,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Check if race exists first
    const race = await prisma.race.findUnique({
      where: { id: req.params.id },
    });

    if (!race) {
      throw createNotFoundError('Race');
    }

    // Then check authorization
    if (race.userId !== req.user!.id) {
      throw createForbiddenError('You do not have permission to access this race');
    }

    res.json(race);
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

    res.status(201).json(race);
  })
);

// PUT /api/races/:id - Update race
router.put(
  '/:id',
  requireAuth,
  validateIdParam,
  validateUpdateRace,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Check if race exists first
    const existingRace = await prisma.race.findUnique({
      where: { id: req.params.id },
    });

    if (!existingRace) {
      throw createNotFoundError('Race');
    }

    // Then check authorization
    if (existingRace.userId !== req.user!.id) {
      throw createForbiddenError('You do not have permission to update this race');
    }

    const { name, raceDate, distance, targetTime, actualTime, notes } = req.body;
    const data: Partial<{
      name: string;
      raceDate: Date;
      distance: number;
      targetTime: number | null;
      actualTime: number | null;
      notes: string | null;
    }> = {};
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

    res.json(updated);
  })
);

// DELETE /api/races/:id - Delete race
router.delete(
  '/:id',
  requireAuth,
  validateIdParam,
  asyncAuthHandler(async (req: AuthRequest, res) => {
    // Check if race exists first
    const existingRace = await prisma.race.findUnique({
      where: { id: req.params.id },
    });

    if (!existingRace) {
      throw createNotFoundError('Race');
    }

    // Then check authorization
    if (existingRace.userId !== req.user!.id) {
      throw createForbiddenError('You do not have permission to delete this race');
    }

    await prisma.race.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

export default router;
