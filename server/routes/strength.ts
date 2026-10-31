// The strength API, the write side and the list of logs (strength design 9.4 and 9.5; ADR 0014):
// the setup, the runner's starting points and the logs of their sessions. Mounted under
// `requireAuth` and under the general JSON parser, which sits below it (CLAUDE.md, request order):
// an anonymous request is a 401 before any byte of a body is read. Zod parses every body and query
// (400 with a path per field); another runner's record is 404; a conflict is 409. The read side of
// the epic (`GET /api/strength`, workouts, one exercise's history) is task E14-6.
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { addDays, daysBetween, isIsoDate, todayIso } from '../../shared/dates.ts'
import { quantityIssue } from '../../shared/copy/quantity.ts'
import type { Quantity } from '../../shared/copy/quantity.ts'
import { EXERCISES, exerciseById, isExerciseId } from '../../shared/domain/strengthLibrary.ts'
import {
  MAX_NOTES,
  STRENGTH_BACKDATE_DAYS,
  STRENGTH_COUNT_MAX,
  STRENGTH_DURATION_MAX_MIN,
  STRENGTH_LOAD_LIST_MAX,
  STRENGTH_LOAD_MAX_G,
  STRENGTH_LOGS_MAX_DAYS,
  STRENGTH_SETS_MAX,
  STRENGTH_SNAPSHOT_MAX_CHARS,
} from '../../shared/limits.ts'
import type {
  EquipmentKind,
  PinnedSlot,
  StrengthSnapshot,
  StrengthTemplate,
  WorkoutLift,
} from '../../shared/types.ts'
import {
  deleteStrengthLift,
  deleteStrengthLog,
  listStrengthLogs,
  saveStrengthLift,
  saveStrengthLog,
  saveStrengthSettings,
  type StrengthLiftInput,
  type StrengthLogInput,
  type StrengthLogQuery,
  type StrengthSettingsInput,
} from '../services/strength.ts'

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

const EQUIPMENT_KINDS = [
  'barbell',
  'dumbbells',
  'kettlebells',
  'bands',
  'step',
  'leg-press',
  'calf-machine',
  'leg-curl',
] as const satisfies readonly EquipmentKind[]

const TEMPLATES = [
  'ramp-in',
  'heavy',
  'lighter-week',
  'maintenance',
  'taper',
  'return',
] as const satisfies readonly StrengthTemplate[]

const MODES = ['normal', 'lighter-day', 'lighter-week', 'taper', 'return'] as const

const CHANGES = [
  'start',
  'increase',
  'hold',
  'reduce',
  'return',
  'variation',
  'lighter-day',
] as const satisfies readonly WorkoutLift['change'][]

const PINNED_SLOTS = ['knee', 'hip', 'calf'] as const satisfies readonly PinnedSlot[]

/** An id from the catalogue: retired exercises stay valid, because old logs name them. */
const exerciseId = z.string().refine(isExerciseId, 'Use an exercise of the catalogue.')

/** A whole number of grams from 1 up to the heaviest load the API stores. */
const grams = z.number().int().min(1).max(STRENGTH_LOAD_MAX_G)

/** A reps-left count: 0 to 5, where 5 is five or more. */
const repsLeft = z.number().int().min(0).max(5)

/** A free text: blank and absent both store null. */
const noteText = z
  .string()
  .trim()
  .max(MAX_NOTES)
  .transform((value) => (value === '' ? null : value))

/** A calendar day, real and written as YYYY-MM-DD. */
const dayText = z
  .string({ error: 'Use a date as YYYY-MM-DD.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD.')
  .refine(isIsoDate, 'Use a real calendar date.')

/** The id of a record in a path or a body: no more than the database holds. */
const recordId = z.string().min(1).max(64)

function idParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const loadSteps = z.union([
  z
    .strictObject({ minG: grams, stepG: grams, maxG: grams.nullable() })
    .refine((steps) => steps.maxG === null || steps.maxG >= steps.minG, {
      error: 'The top load must be at least the first load.',
      path: ['maxG'],
    }),
  z.strictObject({ loadsG: z.array(grams).min(1).max(STRENGTH_LOAD_LIST_MAX) }),
])

const equipmentItem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('barbell'), barG: grams, jumpG: grams }),
  z.strictObject({ kind: z.enum(['dumbbells', 'kettlebells']), loads: loadSteps }),
  z
    .strictObject({
      kind: z.enum(['leg-press', 'calf-machine', 'leg-curl']),
      stepG: grams,
      maxG: grams,
    })
    .refine((machine) => machine.maxG >= machine.stepG, {
      error: 'The top weight must be at least one step.',
      path: ['maxG'],
    }),
  z.strictObject({ kind: z.enum(['bands', 'step']) }),
])

const equipmentList = z
  .array(equipmentItem)
  .max(EQUIPMENT_KINDS.length)
  .refine((items) => new Set(items.map((item) => item.kind)).size === items.length, {
    error: 'List each kind of equipment once.',
  })

const pinnedSchema = z
  .strictObject({
    knee: exerciseId.optional(),
    hip: exerciseId.optional(),
    calf: exerciseId.optional(),
  })
  .superRefine((pinned, ctx) => {
    for (const slot of PINNED_SLOTS) {
      const id = pinned[slot]
      if (id !== undefined && exerciseById(id)?.slot !== slot) {
        ctx.addIssue({
          code: 'custom',
          path: [slot],
          message: `Use an exercise that fills the ${slot} slot.`,
        })
      }
    }
  })
  .transform((pinned) => {
    const kept: Partial<Record<PinnedSlot, string>> = {}
    for (const slot of PINNED_SLOTS) {
      const id = pinned[slot]
      if (id !== undefined) kept[slot] = id
    }
    return kept
  })

/** Every field is optional: the setup is five short sheets, and each saves its own part. */
const settingsSchema = z.strictObject({
  equipment: equipmentList.optional(),
  level: z.enum(['new', 'some', 'experienced']).optional(),
  currentlyLifting: z.boolean().optional(),
  avoid: z
    .array(exerciseId)
    .max(EXERCISES.length)
    .refine((ids) => new Set(ids).size === ids.length, { error: 'List each exercise once.' })
    .optional(),
  pinned: pinnedSchema.optional(),
  note: noteText.nullable().optional(),
}) satisfies z.ZodType<StrengthSettingsInput, unknown>

// ---------------------------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------------------------

/**
 * A recent set needs its reps; a maximum is one rep with nothing left, so it takes neither. `asOf`
 * is a day that has begun, and today when left out.
 */
function liftSchema() {
  const today = todayIso()
  return z
    .strictObject({
      kind: z.enum(['set', 'max']),
      loadG: grams,
      reps: z.number().int().min(1).max(STRENGTH_COUNT_MAX).optional(),
      rir: repsLeft.nullish(),
      asOf: dayText
        .refine((day) => day <= today, { error: 'Use today or an earlier day.' })
        .optional(),
    })
    .superRefine((lift, ctx) => {
      if (lift.kind === 'set' && lift.reps === undefined) {
        ctx.addIssue({ code: 'custom', path: ['reps'], message: 'Enter the reps of the set.' })
      }
      if (lift.kind === 'max' && lift.reps !== undefined && lift.reps !== 1) {
        ctx.addIssue({ code: 'custom', path: ['reps'], message: 'A maximum is one rep.' })
      }
      if (lift.kind === 'max' && lift.rir !== undefined && lift.rir !== null) {
        ctx.addIssue({
          code: 'custom',
          path: ['rir'],
          message: 'A maximum has no reps left to count.',
        })
      }
    })
    .transform((lift): StrengthLiftInput => ({
      kind: lift.kind,
      loadG: lift.loadG,
      reps: lift.kind === 'max' ? 1 : (lift.reps ?? 1),
      rir: lift.kind === 'max' ? null : (lift.rir ?? null),
      asOf: lift.asOf ?? today,
    }))
}

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------

/** A quantity slot of a reason, as `quantityIssue` reads one. */
const quantity = z.custom<Quantity>((value) => quantityIssue(value) === null, {
  error: 'Use a quantity.',
})

const basisSchema = z.strictObject({
  rule: z.enum(['F7', 'F8', 'F9']),
  facts: z
    .array(
      z.strictObject({
        template: z.string().min(1).max(80),
        slots: z
          .record(z.string().min(1).max(40), z.union([z.string().max(80), quantity]))
          .refine((slots) => Object.keys(slots).length <= 8, { error: 'Use at most 8 slots.' }),
      }),
    )
    .max(8),
})

const repRange = z
  .strictObject({
    min: z.number().int().min(0).max(STRENGTH_COUNT_MAX),
    max: z.number().int().min(0).max(STRENGTH_COUNT_MAX),
  })
  .refine((range) => range.max >= range.min, {
    error: 'The top of the range must be at least the bottom.',
    path: ['max'],
  })

const repsLeftRange = z
  .strictObject({ min: repsLeft, max: repsLeft })
  .refine((range) => range.max >= range.min, {
    error: 'The top of the range must be at least the bottom.',
    path: ['max'],
  })

const snapshotLift = z.strictObject({
  exerciseId,
  implement: z.enum(EQUIPMENT_KINDS).nullable(),
  sets: z.number().int().min(0).max(STRENGTH_SETS_MAX),
  range: repRange,
  rir: repsLeftRange.nullable(),
  baseLoadG: z.number().int().min(0).max(STRENGTH_LOAD_MAX_G).nullable(),
  shownLoadG: z.number().int().min(0).max(STRENGTH_LOAD_MAX_G).nullable(),
  change: z.enum(CHANGES),
  basis: basisSchema,
})

const snapshotSchema = z.strictObject({
  template: z.enum(TEMPLATES),
  variant: z.enum(['A', 'B']),
  week: z.number().int().min(1).max(100).nullable(),
  mode: z.enum(MODES),
  lifts: z.array(snapshotLift).max(EXERCISES.length),
}) satisfies z.ZodType<StrengthSnapshot, unknown>

const setSchema = z.strictObject({
  exerciseId,
  loadG: z.number().int().min(0).max(STRENGTH_LOAD_MAX_G).nullish(),
  count: z.number().int().min(1).max(STRENGTH_COUNT_MAX),
  rir: repsLeft.nullish(),
})

/** The id the client chose for a log: a UUID, as the outbox's route pattern reads it. */
const logIdParam = z.object({
  logId: z.string().regex(/^[\w-]{8,64}$/, 'Use an id of 8 to 64 letters, digits, - or _.'),
})

/** `date` is a day that has begun and is not more than a year back (design 6.4). */
function logSchema() {
  const today = todayIso()
  const earliest = addDays(today, -STRENGTH_BACKDATE_DAYS)
  return z
    .strictObject({
      date: dayText
        .refine((day) => day <= today, { error: 'Use today or an earlier day.' })
        .refine((day) => day >= earliest, { error: 'Use a day within the last year.' }),
      activityId: recordId.optional(),
      sessionId: recordId.optional(),
      durationMin: z.number().int().min(1).max(STRENGTH_DURATION_MAX_MIN),
      rpe: z.number().int().min(1).max(10).nullish(),
      pain: z.number().int().min(0).max(10).nullish(),
      notes: noteText.nullish(),
      prescribed: snapshotSchema,
      sets: z.array(setSchema).max(STRENGTH_SETS_MAX),
    })
    .superRefine((body, ctx) => {
      if (JSON.stringify(body.prescribed).length > STRENGTH_SNAPSHOT_MAX_CHARS) {
        ctx.addIssue({
          code: 'custom',
          path: ['prescribed'],
          message: `The snapshot is larger than ${String(STRENGTH_SNAPSHOT_MAX_CHARS)} characters.`,
        })
      }
    })
    .transform((body): StrengthLogInput => ({
      ...body,
      sets: body.sets.map((set) => ({
        exerciseId: set.exerciseId,
        loadG: set.loadG ?? null,
        count: set.count,
        rir: set.rir ?? null,
      })),
    }))
}

/** Either one activity's log, or the logs of a span of days. */
const logsQuerySchema = z
  .object({ activityId: recordId.optional(), from: dayText.optional(), to: dayText.optional() })
  .transform((query, ctx): StrengthLogQuery => {
    const fail = (path: string, message: string) => {
      ctx.issues.push({ code: 'custom', path: [path], message, input: query })
    }
    if (query.activityId !== undefined) {
      if (query.from !== undefined || query.to !== undefined) {
        fail('activityId', 'Ask for one activity or for a span of days, not both.')
        return z.NEVER
      }
      return { activityId: query.activityId }
    }
    if (query.from === undefined || query.to === undefined) {
      fail('from', 'Give an activityId, or both from and to.')
      return z.NEVER
    }
    if (query.from > query.to) fail('from', 'Use a start day on or before the end day.')
    else if (daysBetween(query.from, query.to) > STRENGTH_LOGS_MAX_DAYS) {
      fail('to', `Ask for at most ${String(STRENGTH_LOGS_MAX_DAYS)} days at a time.`)
    }
    return { from: query.from, to: query.to }
  })

// ---------------------------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------------------------

export function strengthRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.put('/settings', async (req, res) => {
    const body = parse(settingsSchema, req.body)
    res.json(await saveStrengthSettings(prisma, req.userId, body))
  })

  router.put('/lifts/:exerciseId', async (req, res) => {
    const { exerciseId: id } = parse(z.object({ exerciseId }), req.params)
    const body = parse(liftSchema(), req.body)
    res.json(await saveStrengthLift(prisma, req.userId, id, body))
  })

  router.delete('/lifts/:exerciseId', async (req, res) => {
    await deleteStrengthLift(prisma, req.userId, idParam(req.params.exerciseId))
    res.status(204).end()
  })

  router.get('/logs', async (req, res) => {
    const query = parse(logsQuerySchema, req.query)
    res.json(await listStrengthLogs(prisma, req.userId, query))
  })

  router.put('/logs/:logId', async (req, res) => {
    const { logId } = parse(logIdParam, req.params)
    const body = parse(logSchema(), req.body)
    const saved = await saveStrengthLog(deps, req.userId, logId, body)
    res.status(saved.created ? 201 : 200).json(saved.result)
  })

  router.delete('/logs/:logId', async (req, res) => {
    await deleteStrengthLog(prisma, req.userId, idParam(req.params.logId))
    res.status(204).end()
  })

  return router
}
