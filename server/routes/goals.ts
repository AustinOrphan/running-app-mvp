import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, todayIso } from '../../shared/dates.ts'
import { MAX_DURATION_SEC } from '../../shared/limits.ts'
import type { Deps } from '../app.ts'
import { conflict, notFound, parse, validationError } from '../errors.ts'
import { toGoal } from '../serialize.ts'
import { deleteRaceResult, saveRaceResult } from '../services/raceResults.ts'
import { warmWeatherCaches } from '../services/weatherCache.ts'

/** Trimmed text; an empty string becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value ? value : null))
  .refine((value) => {
    if (value === null) return true
    try {
      const { protocol } = new URL(value)
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Use an http or https link.')

/** The distance above which the design defaults a goal to finish-first (design 3.1). */
const FINISH_FIRST_ABOVE_M = 42_200
const TARGET_TIME_REQUIRED = 'Enter a target time for a time goal, or choose a finish goal.'

const metres = z.number().int().min(0).max(30_000).nullish()
/** Rounded to 0.01 degrees, about a kilometre: the race place, not the start line. */
const coordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    .nullish()
    .transform((value) => (value == null ? value : Math.round(value * 100) / 100))

const goalFields = z.object({
  name: z.string().trim().min(1).max(200),
  priority: z.enum(['A', 'B', 'C']),
  status: z.enum(['target', 'considering', 'done', 'dropped']).default('target'),
  targetDate: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD.'),
  dateProvisional: z.boolean().default(false),
  distanceM: z.number().int().min(1).max(500_000).nullish(),
  location: optionalText(200),
  successCriteria: optionalText(2000),
  notes: optionalText(5000),
  url: optionalUrl,
  gainM: metres,
  lossM: metres,
  surface: z.enum(['road', 'trail', 'track', 'mixed']).default('road'),
  goalType: z.enum(['finish', 'time']).optional(),
  targetTimeSec: z.number().int().min(60).max(864_000).nullish(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time as HH:MM.')
    .nullish(),
  raceLat: coordinate(90),
  raceLng: coordinate(180),
  supportLevel: z.enum(['aided', 'self']).default('aided'),
})

/** A goal type the caller chose as `time` needs a target; a defaulted one does not. */
const goalBody = goalFields.superRefine((body, ctx) => {
  if (body.goalType === 'time' && body.targetTimeSec == null) {
    ctx.addIssue({ code: 'custom', path: ['targetTimeSec'], message: TARGET_TIME_REQUIRED })
  }
})

/** PUT changes only the fields it carries; a null or empty text field clears the value. */
const goalPatch = z.object({
  name: goalFields.shape.name.optional(),
  priority: goalFields.shape.priority.optional(),
  status: z.enum(['target', 'considering', 'done', 'dropped']).optional(),
  targetDate: goalFields.shape.targetDate.optional(),
  dateProvisional: z.boolean().optional(),
  distanceM: goalFields.shape.distanceM,
  location: z.string().trim().max(200).nullish(),
  successCriteria: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  url: z.string().trim().max(500).nullish(),
  gainM: metres,
  lossM: metres,
  surface: goalFields.shape.surface.unwrap().optional(),
  goalType: goalFields.shape.goalType,
  targetTimeSec: goalFields.shape.targetTimeSec,
  startTime: goalFields.shape.startTime,
  raceLat: goalFields.shape.raceLat,
  raceLng: goalFields.shape.raceLng,
  supportLevel: goalFields.shape.supportLevel.unwrap().optional(),
})

/** A full replacement of a goal's race result (design 11.4): every field is sent each time. */
const resultBody = z
  .object({
    outcome: z.enum(['finished', 'did-not-finish']),
    timeSec: z
      .number()
      .int()
      .min(1)
      .max(MAX_DURATION_SEC)
      .nullish()
      .transform((value) => value ?? null),
    date: goalFields.shape.targetDate,
    distanceM: goalFields.shape.distanceM.transform((value) => value ?? null),
    gainM: metres.transform((value) => value ?? null),
    activityId: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? null),
    note: optionalText(2000),
  })
  .superRefine((body, ctx) => {
    if (body.outcome === 'finished' && body.timeSec === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeSec'],
        message: 'Enter the official finish time.',
      })
    }
    // A date that is not a real day has its own issue; it is not also called a future date.
    if (isIsoDate(body.date) && body.date > todayIso()) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Use a race date that has passed.' })
    }
  })

/** The fields the race climate is read for: place, date, start time, length and whether it is open. */
const CLIMATE_FIELDS = [
  'raceLat',
  'raceLng',
  'targetDate',
  'startTime',
  'distanceM',
  'targetTimeSec',
  'status',
] as const

function checkUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  return parse(optionalUrl, value)
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null
}

export function goalsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  async function ownedGoal(userId: string, id: string) {
    const goal = await prisma.goal.findFirst({ where: { id, userId } })
    if (!goal) throw notFound('Goal not found.')
    return goal
  }

  router.get('/', async (req, res) => {
    const goals = await prisma.goal.findMany({
      where: { userId: req.userId },
      orderBy: [{ targetDate: 'asc' }, { createdAt: 'asc' }],
    })
    res.json(goals.map(toGoal))
  })

  router.post('/', async (req, res) => {
    const body = parse(goalBody, req.body)
    const goal = await prisma.goal.create({
      data: {
        userId: req.userId,
        name: body.name,
        priority: body.priority,
        status: body.status,
        targetDate: body.targetDate,
        dateProvisional: body.dateProvisional,
        distanceM: body.distanceM ?? null,
        location: body.location,
        successCriteria: body.successCriteria,
        notes: body.notes,
        url: body.url,
        gainM: body.gainM ?? null,
        lossM: body.lossM ?? null,
        surface: body.surface,
        goalType:
          body.goalType ?? ((body.distanceM ?? 0) > FINISH_FIRST_ABOVE_M ? 'finish' : 'time'),
        targetTimeSec: body.targetTimeSec ?? null,
        startTime: body.startTime ?? null,
        raceLat: body.raceLat,
        raceLng: body.raceLng,
        supportLevel: body.supportLevel,
      },
    })
    // The race climate is read after the response, never during it.
    warmWeatherCaches(deps, req.userId)
    res.status(201).json(toGoal(goal))
  })

  router.get('/:id', async (req, res) => {
    res.json(toGoal(await ownedGoal(req.userId, req.params.id)))
  })

  router.put('/:id', async (req, res) => {
    const body = parse(goalPatch, req.body)
    const url = checkUrl(body.url)
    const existing = await ownedGoal(req.userId, req.params.id)
    // A type or target that the request changes must leave a time goal with a target; a goal made
    // earlier, edited without touching either, is left alone.
    if (body.goalType !== undefined || body.targetTimeSec !== undefined) {
      const type = body.goalType ?? existing.goalType
      const target = body.targetTimeSec === undefined ? existing.targetTimeSec : body.targetTimeSec
      if (type === 'time' && target === null) {
        throw validationError(TARGET_TIME_REQUIRED, [
          { path: 'targetTimeSec', message: TARGET_TIME_REQUIRED },
        ])
      }
    }
    const goal = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        name: body.name,
        priority: body.priority,
        status: body.status,
        targetDate: body.targetDate,
        dateProvisional: body.dateProvisional,
        // A finished or dropped goal cannot stay active, matching the activate rule.
        ...(body.status === 'done' || body.status === 'dropped' ? { isActive: false } : {}),
        distanceM: body.distanceM,
        location: blankToNull(body.location),
        successCriteria: blankToNull(body.successCriteria),
        notes: blankToNull(body.notes),
        url,
        gainM: body.gainM,
        lossM: body.lossM,
        surface: body.surface,
        goalType: body.goalType,
        targetTimeSec: body.targetTimeSec,
        startTime: body.startTime,
        raceLat: body.raceLat,
        raceLng: body.raceLng,
        supportLevel: body.supportLevel,
      },
    })
    if (CLIMATE_FIELDS.some((field) => body[field] !== undefined)) {
      warmWeatherCaches(deps, req.userId)
    }
    res.json(toGoal(goal))
  })

  router.delete('/:id', async (req, res) => {
    await ownedGoal(req.userId, req.params.id)
    const activePlans = await prisma.plan.count({
      where: { goalId: req.params.id, status: 'active' },
    })
    if (activePlans > 0) {
      throw conflict('This goal has an active plan. Generate a plan for another goal first.')
    }
    await prisma.goal.delete({ where: { id: req.params.id } })
    res.status(204).end()
  })

  // The result of a goal's race: one per goal, replaced as a whole. The record that compares it with
  // the weekly predictions is GET /api/predictions/record.
  router.put('/:id/result', async (req, res) => {
    const body = parse(resultBody, req.body)
    const goal = await ownedGoal(req.userId, req.params.id)
    const { result, created } = await saveRaceResult(deps, { userId: req.userId, goal, body })
    res.status(created ? 201 : 200).json(result)
  })

  router.delete('/:id/result', async (req, res) => {
    await ownedGoal(req.userId, req.params.id)
    await deleteRaceResult(deps, { userId: req.userId, goalId: req.params.id })
    res.status(204).end()
  })

  router.post('/:id/activate', async (req, res) => {
    const goal = await ownedGoal(req.userId, req.params.id)
    if (goal.status === 'done' || goal.status === 'dropped') {
      throw conflict('A finished or dropped goal cannot be the active goal.')
    }
    const activated = await prisma.$transaction(async (tx) => {
      await tx.goal.updateMany({ where: { userId: req.userId }, data: { isActive: false } })
      return tx.goal.update({ where: { id: goal.id }, data: { isActive: true } })
    })
    res.json(toGoal(activated))
  })

  return router
}
