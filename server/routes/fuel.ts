// The fuel lab API (phase 3a design 10.4; ADR 0011): settings, the runner's products and the
// per-run fuel log. Mounted under `requireAuth`. Bodies are parsed with Zod (400 with a path per
// field); a missing activity or product is 404; a service rule such as a duplicate live name is
// 409. The ladder is never stored: every log answer carries it replayed.
//
// `GET /api/fuel` (the lab view) and `GET /api/fuel/targets` are served by the same router in a
// later task; until then those paths answer with the app's JSON 404.
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { notFound, parse } from '../errors.ts'
import {
  itemNeedsFoodMessage,
  itemProductOnlyMessage,
  scoreMessage,
} from '../../shared/engine/fuelCopy.ts'
import { P } from '../../shared/engine/params/index.ts'
import {
  FUEL_FLUID_MAX_ML,
  FUEL_ITEMS_MAX,
  FUEL_NAME_MAX,
  FUEL_SERVING_CARBS_MAX_G,
  FUEL_SERVING_KCAL_MAX,
  FUEL_SERVING_LABEL_MAX,
  FUEL_SERVING_SODIUM_MAX_MG,
  FUEL_SERVINGS_MAX,
  FUEL_SODIUM_MAX_MG,
  MAX_NOTES,
} from '../../shared/limits.ts'
import type { FuelProductKind } from '../../shared/types.ts'
import {
  archiveProduct,
  assertRun,
  createProduct,
  deleteLog,
  listProducts,
  readLog,
  saveFuelSettings,
  saveLog,
  skipLog,
  updateProduct,
  type ItemInput,
  type LogInput,
  type ProductInput,
} from '../services/fuel.ts'

const PRODUCT_KINDS = [
  'gel',
  'drink',
  'chew',
  'bar',
  'food',
  'electrolyte',
  'other',
] as const satisfies readonly FuelProductKind[]

/** An optional whole number: absent and null both store null. */
function optionalInt(min: number, max: number) {
  return z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null)
}

/** An optional free text: blank and absent both store null. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))
}

const settingsSchema = z.strictObject({
  optIn90: z.boolean(),
  optInAdvanced: z.boolean(),
  giDisease: z.boolean(),
  gutBlock: z.boolean(),
})

// A full replacement, so PUT leaves the same row however often it is sent.
const productSchema = z.strictObject({
  name: z.string().trim().min(1).max(FUEL_NAME_MAX),
  kind: z.enum(PRODUCT_KINDS),
  servingLabel: z.string().trim().min(1).max(FUEL_SERVING_LABEL_MAX),
  carbsG: z.number().min(0).max(FUEL_SERVING_CARBS_MAX_G),
  sodiumMg: optionalInt(0, FUEL_SERVING_SODIUM_MAX_MG),
  kcal: optionalInt(0, FUEL_SERVING_KCAL_MAX),
  multiCarb: z.boolean().default(false),
}) satisfies z.ZodType<ProductInput, unknown>

const productListSchema = z.object({ archived: z.enum(['0', '1']).optional() })

/**
 * One item of a log: a product of the list with the servings taken (the server copies the
 * product's name and amounts), or food of the runner's own with its name and carbohydrate.
 */
const itemSchema = z
  .strictObject({
    productId: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(FUEL_NAME_MAX).optional(),
    carbsG: z.number().min(0).max(FUEL_SERVING_CARBS_MAX_G).optional(),
    sodiumMg: z.number().int().min(0).max(FUEL_SERVING_SODIUM_MAX_MG).nullable().optional(),
    kcal: z.number().int().min(0).max(FUEL_SERVING_KCAL_MAX).nullable().optional(),
    multiCarb: z.boolean().optional(),
    servings: z.number().positive().max(FUEL_SERVINGS_MAX),
  })
  .check((ctx) => {
    const item = ctx.value
    const flag = (field: string, message: string) => {
      ctx.issues.push({ code: 'custom', message, path: [field], input: item })
    }
    if (item.productId !== undefined) {
      for (const field of ['name', 'carbsG', 'sodiumMg', 'kcal', 'multiCarb'] as const) {
        if (item[field] !== undefined) flag(field, itemProductOnlyMessage())
      }
    } else {
      if (item.name === undefined) flag('name', itemNeedsFoodMessage())
      if (item.carbsG === undefined) flag('carbsG', itemNeedsFoodMessage())
    }
  })
  .transform((item): ItemInput =>
    item.productId !== undefined
      ? { productId: item.productId, servings: item.servings }
      : {
          productId: null,
          name: item.name ?? '',
          carbsG: item.carbsG ?? 0,
          sodiumMg: item.sodiumMg ?? null,
          kcal: item.kcal ?? null,
          multiCarb: item.multiCarb ?? false,
          servings: item.servings,
        },
  )

/** A gut or nausea score on the scale of `h7.gutSymptomScaleMax`, read at each request. */
function score() {
  const message = scoreMessage()
  return z
    .number({ error: message })
    .int(message)
    .min(0, message)
    .max(P.h7.gutSymptomScaleMax.value, message)
}

/** `hot` null (or absent) leaves "was it hot" to the weather the run has, on every replay. */
function logSchema() {
  return z.strictObject({
    items: z.array(itemSchema).max(FUEL_ITEMS_MAX).default([]),
    fluidMl: optionalInt(0, FUEL_FLUID_MAX_ML),
    sodiumMg: optionalInt(0, FUEL_SODIUM_MAX_MG),
    gut: score(),
    nausea: score()
      .nullish()
      .transform((value) => value ?? null),
    hot: z
      .boolean()
      .nullish()
      .transform((value) => value ?? null),
    notes: optionalText(MAX_NOTES),
  }) satisfies z.ZodType<LogInput, unknown>
}

function idParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function fuelRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  async function findRun(userId: string, id: string) {
    const row = id
      ? await prisma.activity.findFirst({ where: { id, userId }, select: { id: true, type: true } })
      : null
    if (!row) throw notFound('Activity not found.')
    return row
  }

  router.put('/settings', async (req, res) => {
    const body = parse(settingsSchema, req.body)
    res.json(await saveFuelSettings(deps, req.userId, body))
  })

  router.get('/products', async (req, res) => {
    const query = parse(productListSchema, req.query)
    res.json(await listProducts(prisma, req.userId, query.archived === '1'))
  })

  router.post('/products', async (req, res) => {
    const body = parse(productSchema, req.body)
    res.status(201).json(await createProduct(prisma, req.userId, body))
  })

  router.put('/products/:id', async (req, res) => {
    const body = parse(productSchema, req.body)
    res.json(await updateProduct(prisma, req.userId, idParam(req.params.id), body))
  })

  router.delete('/products/:id', async (req, res) => {
    await archiveProduct(prisma, req.userId, idParam(req.params.id))
    res.status(204).end()
  })

  router.get('/logs/:activityId', async (req, res) => {
    const run = await findRun(req.userId, idParam(req.params.activityId))
    res.json((await readLog(deps, req.userId, run.id)).log)
  })

  router.put('/logs/:activityId', async (req, res) => {
    const run = await findRun(req.userId, idParam(req.params.activityId))
    const body = parse(logSchema(), req.body)
    assertRun(run)
    res.json(await saveLog(deps, req.userId, run.id, body))
  })

  router.post('/logs/:activityId/skip', async (req, res) => {
    const run = await findRun(req.userId, idParam(req.params.activityId))
    assertRun(run)
    res.json(await skipLog(deps, req.userId, run.id))
  })

  router.delete('/logs/:activityId', async (req, res) => {
    const run = await findRun(req.userId, idParam(req.params.activityId))
    res.json(await deleteLog(deps, req.userId, run.id))
  })

  return router
}
