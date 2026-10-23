import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanWeek } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { notFound, parse, validationError } from '../errors.ts'
import { toPlanWeek } from '../serialize.ts'
import {
  generateEnginePlan,
  linkPlanSession,
  loadPlanWithSessions,
  replanActivePlan,
  updatePlanSession,
} from '../services/planEngine.ts'
import { listRevisions } from '../services/replan.ts'
import { sessionWorkoutFile, weekWorkoutZip } from '../services/workouts.ts'

/** A week's baseline can be at most a full week of minutes. */
const MAX_WEEK_MIN = 7 * 24 * 60

// Version-1 request fields (`baselineRunMin`, `startDate`) are still accepted and ignored: the
// engine reads the baseline from the runner's history and plans from today. `strengthPreference`
// is the older name of `options.strengthSessions`.
const generateBody = z.object({
  goalId: z.string().min(1),
  baselineRunMin: z.number().int().min(1).max(MAX_WEEK_MIN).optional(),
  startDate: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD.').optional(),
  strengthPreference: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  options: z
    .strictObject({
      recoveryCycle: z.enum(['3:1', '2:1']).optional(),
      strengthSessions: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
      tidModel: z.enum(['pyramidal', 'polarized']).optional(),
    })
    .optional(),
})

const sessionPatch = z
  .strictObject({
    date: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD.').optional(),
    kind: z
      .enum([
        'easy',
        'recovery',
        'long',
        'long-fast-finish',
        'threshold',
        'intervals',
        'race-pace',
        'strides',
        'hills',
        'hike',
        'b2b',
        'strength',
        'mobility',
        'rest',
        'cross',
      ])
      .optional(),
    skip: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length === 1, 'Send exactly one of date, kind or skip.')

const linkBody = z.strictObject({ activityId: z.string().min(1).nullable() })

const sessionParams = z.strictObject({ id: z.string().min(1).max(64) })

/** A Monday as YYYY-MM-DD, the start of a plan week (ADR 0003). */
const weekStartParams = z.strictObject({
  weekStart: z
    .string()
    .refine(
      (value) => isIsoDate(value) && mondayOf(value) === value,
      'Use the Monday of the week as YYYY-MM-DD.',
    ),
})

/** A page of the revision log; revisions with an empty diff are hidden unless asked for. */
const revisionsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().min(1).max(64).optional(),
  include: z.literal('empty').optional(),
})

const weekBody = z
  .object({
    targetRunMin: z.number().int().min(0).max(MAX_WEEK_MIN),
    longRunMin: z.number().int().min(0).max(MAX_WEEK_MIN),
    day2Min: z.number().int().min(0).max(MAX_WEEK_MIN).nullable(),
    runDays: z.number().int().min(0).max(7),
    strengthSessions: z.number().int().min(0).max(7),
    focus: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .transform((value) => (value ? value : null)),
    overrideNote: z.string().trim().max(500),
  })
  .partial()
  .strict()

function issue(path: string, message: string) {
  return validationError(message, [{ path, message }])
}

export function planRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await loadPlanWithSessions(deps, req.userId, todayIso()))
  })

  router.post('/generate', async (req, res) => {
    const body = parse(generateBody, req.body)
    const options = {
      ...(body.strengthPreference === undefined
        ? {}
        : { strengthSessions: body.strengthPreference }),
      ...body.options,
    }
    const plan = await generateEnginePlan(deps, {
      userId: req.userId,
      goalId: body.goalId,
      today: todayIso(),
      options,
    })
    res.status(201).json(plan)
  })

  router.post('/replan', async (req, res) => {
    res.json(
      await replanActivePlan(deps, { userId: req.userId, reason: 'owner', today: todayIso() }),
    )
  })

  router.get('/revisions', async (req, res) => {
    const query = parse(revisionsQuery, req.query)
    res.json(
      await listRevisions(deps, {
        userId: req.userId,
        limit: query.limit,
        before: query.before,
        includeEmpty: query.include === 'empty',
      }),
    )
  })

  router.put('/sessions/:id', async (req, res) => {
    const patch = parse(sessionPatch, req.body)
    res.json(
      await updatePlanSession(deps, {
        userId: req.userId,
        sessionId: req.params.id,
        patch,
        today: todayIso(),
      }),
    )
  })

  router.post('/sessions/:id/link', async (req, res) => {
    const { activityId } = parse(linkBody, req.body)
    res.json(
      await linkPlanSession(deps, { userId: req.userId, sessionId: req.params.id, activityId }),
    )
  })

  // The FIT workout file of one session, as it would go to the watch today. The two download
  // routes are never cached: the file holds today's version of the session.
  router.get('/sessions/:id/workout.fit', async (req, res) => {
    const { id } = parse(sessionParams, req.params)
    res.set('Cache-Control', 'no-store')
    const file = await sessionWorkoutFile(deps, {
      userId: req.userId,
      sessionId: id,
      today: todayIso(),
      now: new Date(),
    })
    res
      .status(200)
      .type('application/octet-stream')
      .set('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(Buffer.from(file.bytes))
  })

  router.get('/weeks/:weekStart/workouts.zip', async (req, res) => {
    const { weekStart } = parse(weekStartParams, req.params)
    res.set('Cache-Control', 'no-store')
    const file = await weekWorkoutZip(deps, {
      userId: req.userId,
      weekStart,
      today: todayIso(),
      now: new Date(),
    })
    res
      .status(200)
      .type('application/zip')
      .set('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(Buffer.from(file.bytes))
  })

  router.put('/weeks/:weekStart', async (req, res) => {
    const weekStart = req.params.weekStart
    if (!isIsoDate(weekStart) || mondayOf(weekStart) !== weekStart) {
      throw issue('weekStart', 'Use the Monday of the week as YYYY-MM-DD.')
    }
    const body = parse(weekBody, req.body)

    const plan = await prisma.plan.findFirst({
      where: { userId: req.userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    })
    const week = plan
      ? await prisma.planWeek.findUnique({
          where: { planId_weekStart: { planId: plan.id, weekStart } },
        })
      : null
    if (!week) throw notFound('That week is not in the active plan.')

    // Working target rules (spec 7.4): a target other than the baseline is an override and needs a
    // note; the baseline value resets the week; a note alone only rewords an existing override.
    let targetRunMin = week.targetRunMin
    let targetSource: PlanWeek['targetSource'] = week.targetSource as PlanWeek['targetSource']
    let overrideNote = week.overrideNote

    if (body.targetRunMin !== undefined) {
      if (body.targetRunMin === week.baselineRunMin) {
        targetRunMin = week.baselineRunMin
        targetSource = 'baseline'
        overrideNote = null
      } else {
        if (!body.overrideNote) {
          throw issue('overrideNote', 'Add a note saying why this week differs from the baseline.')
        }
        targetRunMin = body.targetRunMin
        targetSource = 'override'
        overrideNote = body.overrideNote
      }
    } else if (body.overrideNote !== undefined) {
      if (targetSource !== 'override') {
        throw issue('overrideNote', 'A note applies only to a week with an overridden target.')
      }
      if (!body.overrideNote) {
        throw issue('overrideNote', 'An overridden week needs a note.')
      }
      overrideNote = body.overrideNote
    }

    const updated = await prisma.planWeek.update({
      where: { id: week.id },
      data: {
        targetRunMin,
        targetSource,
        overrideNote,
        longRunMin: body.longRunMin,
        day2Min: body.day2Min,
        runDays: body.runDays,
        strengthSessions: body.strengthSessions,
        focus: body.focus,
      },
    })
    res.json(toPlanWeek(updated))
  })

  return router
}
