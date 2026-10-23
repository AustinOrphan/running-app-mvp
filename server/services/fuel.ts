// The fuel lab on the server (phase 3a design 10.3 and 10.4; ADR 0011): the runner's products, the
// fuel switches and the per-run fuel log. Nothing here stores the ladder. Every answer replays it
// from the logs under the current settings (`replayLadder`), so an edited activity, a weather fill
// that arrives after logging, a deleted log or a changed switch takes effect on the next read.
//
// Writes go through the data-versioned client and never raise the version themselves: the three
// models are state (`server/dataVersion.ts`).
import { mondayOf, todayIso } from '../../shared/dates.ts'
import { fuelRungs, replayLadder, type LadderInput } from '../../shared/engine/fuel.ts'
import {
  advancedLockedMessage,
  logExistsMessage,
  notARunMessage,
  productArchivedMessage,
  productNameTakenMessage,
  productNotFoundMessage,
  productsFullMessage,
  productUnknownMessage,
  stepNote,
} from '../../shared/engine/fuelCopy.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { FuelRunInput, LadderResult, SessionFlag } from '../../shared/engine/types.ts'
import { FUEL_LADDER_STEPS_SHOWN, FUEL_PRODUCTS_MAX } from '../../shared/limits.ts'
import type {
  FuelLogItem,
  FuelLogResult,
  FuelProduct,
  FuelProductKind,
  FuelSettings,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { FuelLog as FuelLogRow, PrismaClient } from '../db.ts'
import { conflict, notFound, validationError } from '../errors.ts'
import { toFuelLogView, toFuelProduct, toFuelSettings } from '../serialize.ts'

/** What the fuel service needs from the app: the data-versioned client. */
export type FuelDeps = Pick<Deps, 'prisma'>

/** Activity types a fuel log can belong to; everywhere else in the app a run is a run or a race. */
export const FUEL_RUN_TYPES: readonly string[] = ['run', 'race']

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export async function loadFuelSettings(
  prisma: Pick<PrismaClient, 'fuelSettings'>,
  userId: string,
): Promise<FuelSettings> {
  return toFuelSettings(await prisma.fuelSettings.findUnique({ where: { userId } }))
}

/**
 * The rules of the four switches. A gut condition forces the others off, so it leaves the floor
 * and no gut-training block; opting out of the first tier clears the second, which needs it.
 */
function normalisedSettings(requested: FuelSettings): FuelSettings {
  if (requested.giDisease) {
    return { optIn90: false, optInAdvanced: false, giDisease: true, gutBlock: false }
  }
  return { ...requested, optInAdvanced: requested.optIn90 && requested.optInAdvanced }
}

/**
 * Saves the switches (the same body twice leaves the same row) and answers with what was kept. The
 * second opt-in opens only after a run at the second tier went well: the ladder is replayed under
 * the first opt-in alone, and the switch is refused with a 400 on `optInAdvanced` when that rung
 * was never tolerated. A switch that is already on stays on, whatever the logs say now, so
 * repeating a request never turns into a refusal.
 */
export async function saveFuelSettings(
  deps: FuelDeps,
  userId: string,
  requested: FuelSettings,
): Promise<FuelSettings> {
  const { prisma } = deps
  const next = normalisedSettings(requested)
  const current = await loadFuelSettings(prisma, userId)
  if (next.optInAdvanced && !current.optInAdvanced) {
    const { input } = await loadFuelState(deps, userId)
    const replay = replayLadder({
      ...input,
      settings: { optIn90: true, optInAdvanced: false, giDisease: false },
    })
    const secondTier = fuelRungs().findLastIndex((rung) => rung.gPerH <= P.h7.carbTier2GPerH.value)
    if (replay.toleratedIndex < secondTier) {
      const message = advancedLockedMessage()
      throw validationError(message, [{ path: 'optInAdvanced', message }])
    }
  }
  await prisma.fuelSettings.upsert({ where: { userId }, create: { userId, ...next }, update: next })
  return next
}

// ---------------------------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------------------------

/** What the replay of one user's logs rests on. */
export interface FuelState {
  settings: FuelSettings
  /** The input of `replayLadder` under the saved settings. */
  input: LadderInput
  ladder: LadderResult
  /** The stored logs of runs, by activity id. */
  logs: Map<string, FuelLogRow>
}

/** The columns of a run the replay reads. */
const RUN_COLUMNS = {
  id: true,
  date: true,
  startTime: true,
  durationSec: true,
  tempC: true,
  humidityPct: true,
  windKph: true,
} as const

/**
 * Replays the ladder from every fuel log of the user's runs. The weather is read from the
 * activities now, so a fill that arrived after the log was saved judges that run. The flags of the
 * linked session come from the session in whichever plan holds the link, and the gut-training
 * weeks from `gutTrainingWeeksOf`, so replacing the active plan (Make active, Regenerate) leaves
 * the credit of earlier runs as it was. Runs are joined with their activities and nothing is
 * cached here.
 */
export async function loadFuelState(deps: FuelDeps, userId: string): Promise<FuelState> {
  const { prisma } = deps
  const [settings, rows, weekRows] = await Promise.all([
    loadFuelSettings(prisma, userId),
    prisma.fuelLog.findMany({
      where: { userId, activity: { type: { in: [...FUEL_RUN_TYPES] } } },
      include: { activity: { select: RUN_COLUMNS } },
    }),
    // Every week of the active plan, and the gut-training weeks of every plan.
    prisma.planWeek.findMany({
      where: {
        plan: { userId },
        OR: [{ plan: { status: 'active' } }, { flags: { contains: GUT_TRAINING_FLAG } }],
      },
      select: { weekStart: true, flags: true, plan: { select: { status: true, updatedAt: true } } },
    }),
  ])
  // A session keeps its activity link in the plan that was active when it was linked.
  const sessionRows = await prisma.planSession.findMany({
    where: { plan: { userId }, activityId: { in: rows.map((row) => row.activityId) } },
    select: { activityId: true, flags: true },
  })

  const flagsByRun = new Map<string, readonly SessionFlag[]>()
  for (const session of sessionRows) {
    if (session.activityId !== null) {
      flagsByRun.set(session.activityId, parseFlags<SessionFlag>(session.flags))
    }
  }
  const gutTrainingWeeks = gutTrainingWeeksOf(weekRows)

  const runs: FuelRunInput[] = rows.map((row) => ({
    activityId: row.activityId,
    date: row.activity.date,
    startTime: row.activity.startTime,
    elapsedSec: row.activity.durationSec,
    weather:
      row.activity.tempC === null
        ? null
        : {
            tempC: row.activity.tempC,
            humidityPct: row.activity.humidityPct,
            windKph: row.activity.windKph,
          },
    sessionFlags: flagsByRun.get(row.activityId) ?? null,
    log: {
      skipped: row.skipped,
      items: parseItems(row.items),
      gut: row.gut ?? 0,
      nausea: row.nausea,
      hotOverride: row.hotOverride,
    },
  }))

  const input: LadderInput = {
    settings: {
      optIn90: settings.optIn90,
      optInAdvanced: settings.optInAdvanced,
      giDisease: settings.giDisease,
    },
    runs,
    gutTrainingWeeks,
  }
  return {
    settings,
    input,
    ladder: replayLadder(input),
    logs: new Map(rows.map((row) => [row.activityId, row])),
  }
}

function parseItems(text: string): FuelLogItem[] {
  try {
    const items: unknown = JSON.parse(text)
    return Array.isArray(items) ? (items as FuelLogItem[]) : []
  } catch {
    return []
  }
}

function parseFlags<T extends string>(text: string): T[] {
  try {
    const flags: unknown = JSON.parse(text)
    return Array.isArray(flags) ? (flags as T[]) : []
  } catch {
    return []
  }
}

const GUT_TRAINING_FLAG = 'gut-training'

/**
 * The Mondays of the weeks that count as a gut-training block for a run the app did not link. The
 * active plan decides every week it holds. A plan that was replaced decides only the weeks the
 * active plan does not hold and that began no later than the week it was replaced in, because
 * its later weeks were never run under it. Without this, replacing the plan would take the block
 * credit away from the runs it had already earned.
 */
function gutTrainingWeeksOf(
  weeks: readonly {
    weekStart: string
    flags: string
    plan: { status: string; updatedAt: Date }
  }[],
): string[] {
  const held = new Set(weeks.filter((w) => w.plan.status === 'active').map((w) => w.weekStart))
  const result = new Set<string>()
  for (const week of weeks) {
    if (!parseFlags(week.flags).includes(GUT_TRAINING_FLAG)) continue
    if (week.plan.status === 'active') result.add(week.weekStart)
    else if (
      !held.has(week.weekStart) &&
      week.weekStart <= mondayOf(todayIso(week.plan.updatedAt))
    ) {
      result.add(week.weekStart)
    }
  }
  return [...result]
}

/** The ladder as an answer carries it: the latest steps only, the rest is history. */
export function ladderView(ladder: LadderResult): LadderResult {
  return ladder.steps.length <= FUEL_LADDER_STEPS_SHOWN
    ? ladder
    : { ...ladder, steps: ladder.steps.slice(-FUEL_LADDER_STEPS_SHOWN) }
}

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

export interface ProductInput {
  name: string
  kind: FuelProductKind
  servingLabel: string
  carbsG: number
  sodiumMg: number | null
  kcal: number | null
  multiCarb: boolean
}

/** Names compare without regard to case or the spaces around them. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The runner's products, live ones first and each group by name. Archived products are listed only
 * on request: they are history, kept so that old logs and "same as last time" still read.
 */
export async function listProducts(
  prisma: Pick<PrismaClient, 'fuelProduct'>,
  userId: string,
  includeArchived: boolean,
): Promise<FuelProduct[]> {
  const rows = await prisma.fuelProduct.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
  })
  return rows
    .map(toFuelProduct)
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    )
}

/**
 * Adds a product. The name must be free among live products and the list holds up to
 * `FUEL_PRODUCTS_MAX`; both are service rules (409), checked in one transaction with the insert.
 */
export async function createProduct(
  prisma: PrismaClient,
  userId: string,
  data: ProductInput,
): Promise<FuelProduct> {
  const row = await prisma.$transaction(async (tx) => {
    const live = await tx.fuelProduct.findMany({
      where: { userId, archived: false },
      select: { name: true },
    })
    if (live.length >= FUEL_PRODUCTS_MAX) {
      throw conflict(productsFullMessage(FUEL_PRODUCTS_MAX), { code: 'products-full' })
    }
    if (live.some((product) => sameName(product.name, data.name))) {
      throw conflict(productNameTakenMessage(data.name), { code: 'name-taken' })
    }
    return tx.fuelProduct.create({ data: { ...data, userId } })
  })
  return toFuelProduct(row)
}

/** Replaces a live product's fields. An archived product cannot be changed. */
export async function updateProduct(
  prisma: PrismaClient,
  userId: string,
  id: string,
  data: ProductInput,
): Promise<FuelProduct> {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.fuelProduct.findFirst({ where: { id, userId } })
    if (!existing) throw notFound(productNotFoundMessage())
    if (existing.archived) throw conflict(productArchivedMessage(), { code: 'archived' })
    const others = await tx.fuelProduct.findMany({
      where: { userId, archived: false, id: { not: id } },
      select: { name: true },
    })
    if (others.some((product) => sameName(product.name, data.name))) {
      throw conflict(productNameTakenMessage(data.name), { code: 'name-taken' })
    }
    return tx.fuelProduct.update({ where: { id }, data })
  })
  return toFuelProduct(row)
}

/** Archives a product, which frees its name. Archiving twice is the same as once. */
export async function archiveProduct(
  prisma: PrismaClient,
  userId: string,
  id: string,
): Promise<void> {
  const existing = await prisma.fuelProduct.findFirst({ where: { id, userId } })
  if (!existing) throw notFound(productNotFoundMessage())
  if (!existing.archived) {
    await prisma.fuelProduct.update({ where: { id }, data: { archived: true } })
  }
}

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------

/** One item of a log request: a product of the list with the servings, or food of the runner's own. */
export type ItemInput =
  | { productId: string; servings: number }
  | {
      productId: null
      name: string
      carbsG: number
      sodiumMg: number | null
      kcal: number | null
      multiCarb: boolean
      servings: number
    }

export interface LogInput {
  items: ItemInput[]
  fluidMl: number | null
  sodiumMg: number | null
  gut: number
  nausea: number | null
  /** The runner's answer to "it was hot"; null leaves it to the weather. */
  hot: boolean | null
  notes: string | null
}

/** A 409 unless the activity is a run or a race: fuel is logged for running only. */
export function assertRun(activity: { type: string }): void {
  if (!FUEL_RUN_TYPES.includes(activity.type)) {
    throw conflict(notARunMessage(), { code: 'not-a-run' })
  }
}

/**
 * The items as the log keeps them: each product's name and amounts are copied now, so a later edit
 * or archive of the product leaves the log as it was. A product the runner archived since can still
 * be named (the log may be a replay of a request made offline). A product that is not the user's
 * is a 400 on the item, the same as one that does not exist.
 */
async function snapshotItems(
  prisma: PrismaClient,
  userId: string,
  items: readonly ItemInput[],
): Promise<FuelLogItem[]> {
  const ids = [
    ...new Set(items.flatMap((item) => (item.productId === null ? [] : [item.productId]))),
  ]
  const products = new Map(
    (await prisma.fuelProduct.findMany({ where: { userId, id: { in: ids } } })).map((product) => [
      product.id,
      product,
    ]),
  )
  return items.map((item, index) => {
    if (item.productId === null) return item
    const product = products.get(item.productId)
    if (!product) {
      const message = productUnknownMessage()
      throw validationError(message, [{ path: `items.${String(index)}.productId`, message }])
    }
    return {
      productId: product.id,
      name: product.name,
      carbsG: product.carbsG,
      sodiumMg: product.sodiumMg,
      kcal: product.kcal,
      multiCarb: product.multiCarb,
      servings: item.servings,
    }
  })
}

/** The log of a run with the ladder as it replays now; the log is null when the run has none. */
export async function readLog(
  deps: FuelDeps,
  userId: string,
  activityId: string,
): Promise<FuelLogResult> {
  const state = await loadFuelState(deps, userId)
  const row = state.logs.get(activityId)
  const step = state.ladder.steps.find((s) => s.activityId === activityId)
  const ladder = ladderView(state.ladder)
  if (!row || !step) return { log: null, ladder, message: null }
  return { log: toFuelLogView(row, step), ladder, message: stepNote(step) }
}

/**
 * Saves the log of a run, replacing any earlier one: the same request twice leaves the same row, so
 * the outbox may replay it. Products are snapshotted. The answer is the replay after the write.
 */
export async function saveLog(
  deps: FuelDeps,
  userId: string,
  activityId: string,
  input: LogInput,
): Promise<FuelLogResult> {
  const { prisma } = deps
  const items = await snapshotItems(prisma, userId, input.items)
  const data = {
    skipped: false,
    items: JSON.stringify(items),
    fluidMl: input.fluidMl,
    sodiumMg: input.sodiumMg,
    gut: input.gut,
    nausea: input.nausea,
    hotOverride: input.hot,
    notes: input.notes,
  }
  await prisma.fuelLog.upsert({
    where: { activityId },
    create: { userId, activityId, ...data },
    update: data,
  })
  return readLog(deps, userId, activityId)
}

/**
 * Marks a run "not this time": it does not count toward the ladder. It never replaces a log that
 * holds an answer (409); marking a skipped run again changes nothing.
 */
export async function skipLog(
  deps: FuelDeps,
  userId: string,
  activityId: string,
): Promise<FuelLogResult> {
  const { prisma } = deps
  const existing = await prisma.fuelLog.findUnique({ where: { activityId } })
  if (existing && !existing.skipped) {
    throw conflict(logExistsMessage(), { code: 'log-exists' })
  }
  if (!existing) {
    await prisma.fuelLog.upsert({
      where: { activityId },
      create: { userId, activityId, skipped: true, items: '[]' },
      update: {},
    })
  }
  return readLog(deps, userId, activityId)
}

/** Removes the log of a run, if it has one, and answers with the ladder replayed without it. */
export async function deleteLog(
  deps: FuelDeps,
  userId: string,
  activityId: string,
): Promise<FuelLogResult> {
  await deps.prisma.fuelLog.deleteMany({ where: { userId, activityId } })
  return readLog(deps, userId, activityId)
}
