// The athlete snapshot (ADR 0009, phase 3a design 4.3): one deep-frozen picture of the runner per
// user, day and data version, built in one round of queries and shared by every reader. A cached
// value is valid for one key, `<boot>.<writes>.<external>` from `server/dataVersion.ts` plus the
// day and the parameter version, so a write by any caller, another connection or another process,
// and midnight, all make the next read build a fresh picture. Nothing here raises the data version.
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { goalModel } from '../../shared/engine/goal.ts'
import { isDuplicate } from '../../shared/engine/load.ts'
import { P, PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import { predictFromState } from '../../shared/engine/predict.ts'
import { isQualityKind, readinessSnapshot } from '../../shared/engine/readiness.ts'
import type {
  AthleteState,
  EngineInput,
  GoalModel,
  PlanChange,
  Prediction,
  ReadinessSnapshot,
  SessionSpec,
  WeekDraft,
  ZoneProposal,
  ZoneSet,
} from '../../shared/engine/types.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type {
  Activity,
  AthleteProfile,
  Goal,
  Plan,
  PlanPhase,
  PlanSession,
  PlanWeek,
  StateInputs,
  StateView,
  WeeklyReview,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import {
  dataVersionKey,
  onDataVersionChange,
  openTransactions,
  type DataVersionKey,
} from '../dataVersion.ts'
import {
  loadActivities,
  loadProfile,
  toGoal,
  toPlan,
  toPlanSession,
  toPlanWeek,
  toWeeklyReview,
  toWellnessDay,
} from '../serialize.ts'
import { currentGoalFor } from './currentGoal.ts'
import { readClimate, type RaceClimate } from './weatherCache.ts'

/** Snapshots kept per client; a runner reads a handful of days and the picture is large. */
export const SNAPSHOT_LRU_SIZE = 8
/** Memoised derived values kept per client (statistics, heart-rate model, weekly decision, ...). */
export const MEMO_LRU_SIZE = 64
/** Backstop only: the key already changes on every write, so the TTL covers what no hook can see. */
export const SNAPSHOT_TTL_MS = 5 * 60_000

const WELLNESS_DAYS = 60
const REVIEW_WEEKS = 16
/** Summary prefix of the owner revision `decideZoneProposal` writes when a proposal is accepted. */
const ACCEPTED_PROPOSAL = 'Accepted zone proposal '
const ZONE_FIELD = /^zones\.(\w+)$/

/** What the snapshot needs from the app: the data-versioned client. */
export type SnapshotDeps = Pick<Deps, 'prisma'>

/**
 * The runner as of one day and one data version. Every field is deep-frozen, so a reader that
 * sorts, pushes into or edits any of it in place throws instead of corrupting the next reader's
 * picture; copy before changing. `activities` are oldest first, the order the engine reads.
 */
export interface AthleteContext {
  readonly userId: string
  /** The local day the picture is for. */
  readonly asOf: string
  /** When the picture was built, as an instant. */
  readonly builtAt: string
  /** `<boot>.<writes>.<external>`: the data version the picture was built at. */
  readonly version: string
  /** `version` plus the day and the parameter version: what a cached value is valid for. */
  readonly key: string
  readonly profile: AthleteProfile
  /** The history window (`P.a5.historyWindowDays`), flagged duplicates included. */
  readonly activities: Activity[]
  readonly wellness: EngineInput['wellness']
  readonly reviews: WeeklyReview[]
  /** The REDs flag count of the latest screening, 0 without one. */
  readonly screeningFlags: number
  readonly zoneChanges: NonNullable<EngineInput['zoneChanges']>
  /** Every goal of the user. */
  readonly goals: Goal[]
  /** `currentGoalFor`: the active plan's goal, else the active goal. */
  readonly goal: Goal | null
  /** The active version-2 plan, without its weeks and sessions. */
  readonly plan: Plan | null
  /** The state the engine estimates from the data above (it does not depend on a goal). */
  readonly state: AthleteState
  readonly zones: ZoneSet
  /** Readiness for `asOf`, computed with the stored plan so the masters gate sees done sessions. */
  readonly readiness: ReadinessSnapshot
  readonly inputs: StateInputs
  /** The stored plan's weeks and sessions in the engine's shapes; null without a version-2 plan. */
  existing(): EngineInput['existing']
  /**
   * The race prediction for a goal of the user, from the state above and the race-day climate.
   * Null for an unknown goal, a goal without a distance, or a state that supports no source. Built
   * once per picture.
   */
  prediction(goalId: string): Promise<Prediction | null>
  /**
   * The cached race-day climate of a goal of the user (`ClimateCache`, filled by the weather job
   * and by plan generation). Null for an unknown goal, a goal without a place, or a place not read
   * yet. Never fetches. A refresh writes a state table, so the picture it belongs to is dropped.
   */
  climate(goalId: string): Promise<RaceClimate | null>
}

// ---------------------------------------------------------------------------------------------
// Engine shapes of stored rows
// ---------------------------------------------------------------------------------------------

/**
 * A stand-in goal for reads that concern the athlete, not a race (zones, readiness). No plan is
 * ever built from it.
 */
export function neutralGoal(today: string): GoalModel {
  return {
    goalId: '',
    name: 'No goal',
    date: addDays(today, 365),
    distanceM: 21_097,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    isUltra: false,
    distanceClass: 'half',
    expectedDurationSec: 7200,
    crossesDarkness: false,
    raceWbgtC: null,
  }
}

/** A stored session as the engine's prescription (without row fields). */
export function sessionSpec(s: PlanSession): SessionSpec {
  return {
    date: s.date,
    order: s.order,
    kind: s.kind,
    title: s.title,
    durationMin: s.durationMin,
    distanceM: s.distanceM,
    gainM: s.gainM,
    structure: s.structure,
    target: s.target,
    purpose: s.purpose,
    rules: s.rules,
    flags: s.flags,
  }
}

/** The stored plan's weeks and sessions in the engine's shapes, for re-plans, advice and decisions. */
export function existingFrom(
  weekRows: PlanWeek[],
  sessionRows: PlanSession[],
): NonNullable<EngineInput['existing']> {
  const sessions = sessionRows.map((s) => ({
    ...sessionSpec(s),
    id: s.id,
    status: s.status,
    activityId: s.activityId,
    linkSource: s.linkSource,
  }))
  const weeks: WeekDraft[] = weekRows.map((w) => {
    const inWeek = sessionRows.filter((s) => s.weekStart === w.weekStart)
    const longest = inWeek
      .filter((s) => s.kind === 'long' && s.distanceM !== null)
      .reduce<number | null>(
        (max, s) => (max === null || s.distanceM! > max ? s.distanceM : max),
        null,
      )
    return {
      weekStart: w.weekStart,
      index: w.index,
      phase: w.phase as WeekDraft['phase'],
      focus: w.focus ?? '',
      targetRunMin: w.targetRunMin,
      longRunMin: w.longRunMin,
      longRunM: longest,
      gainTargetM: w.gainTargetM,
      runDays: w.runDays,
      qualitySessions: inWeek.filter((s) => isQualityKind(s.kind)).length,
      strengthSessions: w.strengthSessions,
      tid: w.tid ?? { z1: 80, z2: 5, z3: 15 },
      flags: w.flags,
      isRecovery: w.flags.includes('recovery'),
      isTaper: w.flags.includes('taper') || w.phase === ('taper' as PlanPhase),
    }
  })
  return { weeks, sessions }
}

// ---------------------------------------------------------------------------------------------
// Freezing
// ---------------------------------------------------------------------------------------------

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** Freezes arrays and plain objects all the way down; dates, maps and functions are left alone. */
function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

// ---------------------------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------------------------

interface Entry<V> {
  value: V
  storedAt: number
}

/** Least recently used, with a time to live checked on read. */
class Lru<V> {
  private readonly entries = new Map<string, Entry<V>>()
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  /** The entry wraps the value because a memoised value may itself be `undefined`. */
  get(key: string): { value: V } | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    if (Date.now() - entry.storedAt >= SNAPSHOT_TTL_MS) return undefined
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { value, storedAt: Date.now() })
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.max) break
      this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

/** The caches of one client, dropped whenever its data version moves. */
interface Registry {
  snapshots: Lru<AthleteContext>
  memos: Lru<unknown>
  /** Builds in progress by cache key, so concurrent readers share one. */
  flights: Map<string, Promise<unknown>>
}

const registries = new WeakMap<object, Registry>()

function registryOf(prisma: PrismaClient): Registry {
  let registry = registries.get(prisma)
  if (!registry) {
    const created: Registry = {
      snapshots: new Lru(SNAPSHOT_LRU_SIZE),
      memos: new Lru(MEMO_LRU_SIZE),
      flights: new Map(),
    }
    registry = created
    registries.set(prisma, created)
    // Entries of an older version can never be read again; letting go of them frees the memory now.
    onDataVersionChange(prisma, () => {
      created.snapshots.clear()
      created.memos.clear()
    })
  }
  return registry
}

/** How many entries each cache of the client holds; tests use it to see what was stored. */
export function cacheSizes(prisma: PrismaClient): { snapshots: number; memos: number } {
  const { snapshots, memos } = registryOf(prisma)
  return { snapshots: snapshots.size, memos: memos.size }
}

/** What a cached value is valid for: the data version, the day and the parameter version. */
export function athleteKey(version: DataVersionKey, today: string): string {
  return `${version.key}.${today}.${PARAMS_VERSION}`
}

/**
 * The cached value for `key`, or the one build in flight for it, or a new build. A build is
 * stored only when it started and finished with no transaction open and no write counted in
 * between by this client or another connection: a build that overlapped a write may have read
 * rows a rollback is about to undo, and it is still returned to the callers that asked for it.
 */
async function cachedByVersion<V>(
  prisma: PrismaClient,
  cache: Lru<V>,
  flights: Map<string, Promise<unknown>>,
  key: (version: DataVersionKey) => string,
  build: (version: DataVersionKey) => Promise<V>,
): Promise<V> {
  const version = await dataVersionKey(prisma)
  const cacheKey = key(version)
  const hit = cache.get(cacheKey)
  if (hit !== undefined) return hit.value
  const flight = flights.get(cacheKey) as Promise<V> | undefined
  if (flight) return flight

  const run = async (): Promise<V> => {
    const openAtStart = openTransactions(prisma)
    const built = await build(version)
    const end = await dataVersionKey(prisma)
    if (openAtStart === 0 && openTransactions(prisma) === 0 && end.key === version.key) {
      cache.set(cacheKey, built)
    }
    return built
  }
  const started = run()
  flights.set(cacheKey, started)
  try {
    return await started
  } finally {
    if (flights.get(cacheKey) === started) flights.delete(cacheKey)
  }
}

// ---------------------------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------------------------

/** The local day of the newest accepted change of each zone boundary, so proposals count fresh data. */
function zoneChangesOf(
  revisions: Array<{ changes: string; createdAt: Date }>,
): NonNullable<EngineInput['zoneChanges']> {
  const changes: NonNullable<EngineInput['zoneChanges']> = {}
  for (const revision of revisions) {
    for (const change of JSON.parse(revision.changes) as PlanChange[]) {
      const boundary = ZONE_FIELD.exec(change.field)?.[1] as ZoneProposal['boundary'] | undefined
      if (boundary !== undefined) changes[boundary] = todayIso(revision.createdAt)
    }
  }
  return changes
}

/** The goal model for one of the context's goals; null when the goal is unknown or has no distance. */
export async function goalModelFor(
  ctx: Pick<AthleteContext, 'goals' | 'state' | 'climate'>,
  goalId: string,
  opts: { climate: boolean },
): Promise<GoalModel | null> {
  const goal = ctx.goals.find((candidate) => candidate.id === goalId)
  if (!goal || goal.distanceM === null) return null
  const climate = opts.climate ? await ctx.climate(goal.id) : null
  return goalModel(goal, ctx.state, climate)
}

async function buildContext(
  prisma: PrismaClient,
  userId: string,
  today: string,
  version: DataVersionKey,
): Promise<AthleteContext> {
  // One round. The driver is synchronous, so the round saves await hops, not time on the file;
  // the saving is that it runs once per change instead of once per request.
  const [
    profile,
    newestFirst,
    wellnessRows,
    reviewRows,
    screening,
    revisions,
    planRow,
    goalRows,
    goal,
  ] = await Promise.all([
    loadProfile(prisma, userId),
    loadActivities(prisma, userId, {
      from: addDays(today, -P.a5.historyWindowDays.value),
      to: today,
    }),
    prisma.wellnessDay.findMany({
      where: { userId, date: { gte: addDays(today, -WELLNESS_DAYS), lte: today } },
      orderBy: { date: 'asc' },
    }),
    prisma.weeklyReview.findMany({
      where: { userId, weekStart: { gte: addDays(mondayOf(today), -7 * REVIEW_WEEKS) } },
      orderBy: { weekStart: 'asc' },
    }),
    prisma.screening.findFirst({
      where: { userId, kind: 'reds' },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { flags: true },
    }),
    prisma.planRevision.findMany({
      where: { plan: { userId }, reason: 'owner', summary: { startsWith: ACCEPTED_PROPOSAL } },
      orderBy: { createdAt: 'asc' },
      select: { changes: true, createdAt: true },
    }),
    prisma.plan.findFirst({
      where: { userId, status: 'active', generatorVersion: { gte: 2 } },
      orderBy: { createdAt: 'desc' },
      include: {
        weeks: { orderBy: { index: 'asc' } },
        sessions: { orderBy: [{ date: 'asc' }, { order: 'asc' }] },
      },
    }),
    prisma.goal.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    currentGoalFor(prisma, userId),
  ])

  const activities = newestFirst.reverse()
  const wellness: EngineInput['wellness'] = wellnessRows.map((row) => ({
    ...toWellnessDay(row),
    fatigue: row.fatigue,
    soreness: row.soreness,
    sleepQuality: row.sleepQuality,
    mood: row.mood,
    stress: row.stress,
    illness: row.illness,
    painScore: row.painScore,
    painArea: row.painArea,
    painFocalBone: row.painFocalBone,
  }))
  const reviews = reviewRows.map(toWeeklyReview)
  const screeningFlags = screening?.flags ?? 0
  const zoneChanges = zoneChangesOf(revisions)
  const existing = deepFreeze(
    planRow
      ? existingFrom(planRow.weeks.map(toPlanWeek), planRow.sessions.map(toPlanSession))
      : null,
  )

  const base: EngineInput = {
    today,
    profile,
    activities,
    wellness,
    reviews,
    goal: neutralGoal(today),
    forecast: null,
    existing: null,
    options: {},
    screeningFlags,
    zoneChanges,
  }
  // The state depends on the data above and on nothing a goal, an option, a forecast or the stored
  // plan adds, so it is the same for every reader. Readiness is the exception: the masters gate
  // reads the sessions already done, so it is computed with the stored plan.
  const state = estimateState(base)
  const zones = buildZones(profile, state, today)
  const readiness = readinessSnapshot({ ...base, existing }, today)

  const counted = activities.filter((activity) => !isDuplicate(activity))
  const inputs: StateInputs = {
    activities: {
      windowDays: P.a5.historyWindowDays.value,
      count: counted.length,
      latest: counted.at(-1)?.date ?? null,
      flaggedDuplicates: activities.length - counted.length,
    },
    wellness: {
      windowDays: WELLNESS_DAYS,
      count: wellness.length,
      latest: wellness.at(-1)?.date ?? null,
    },
    reviews: { windowWeeks: REVIEW_WEEKS, count: reviews.length },
  }

  const goals = goalRows.map(toGoal)
  const predictions = new Map<string, Promise<Prediction | null>>()
  const climates = new Map<string, Promise<RaceClimate | null>>()
  const context: AthleteContext = {
    userId,
    asOf: today,
    builtAt: new Date().toISOString(),
    version: version.key,
    key: athleteKey(version, today),
    profile,
    activities,
    wellness,
    reviews,
    screeningFlags,
    zoneChanges,
    goals,
    goal,
    plan: planRow ? toPlan(planRow) : null,
    state,
    zones,
    readiness,
    inputs,
    existing: () => existing,
    prediction(goalId) {
      const known = predictions.get(goalId)
      if (known) return known
      const pending = goalModelFor(context, goalId, { climate: true }).then((model) =>
        model === null
          ? null
          : deepFreeze(
              predictFromState(state, {
                distanceM: model.distanceM,
                gainM: model.gainM,
                surface: model.surface,
                wbgtC: model.raceWbgtC,
              }),
            ),
      )
      predictions.set(goalId, pending)
      // A failure is not remembered; the next caller tries again.
      void pending.catch(() => predictions.delete(goalId))
      return pending
    },
    climate(goalId) {
      const known = climates.get(goalId)
      if (known) return known
      const goal = goals.find((candidate) => candidate.id === goalId)
      const pending = goal
        ? readClimate(prisma, goal, {
            lat: profile.homeLat,
            lng: profile.homeLng,
            use: profile.useHomeWeather,
          })
        : Promise.resolve(null)
      climates.set(goalId, pending)
      void pending.catch(() => climates.delete(goalId))
      return pending
    },
  }
  return deepFreeze(context)
}

/**
 * The athlete snapshot for a user and a day. Concurrent callers share one build; a second call
 * with no write in between returns the same object; a write, a day change or the TTL builds a
 * new one. Throws only when the database does.
 */
export async function loadAthleteContext(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<AthleteContext> {
  const { prisma } = deps
  const { snapshots, flights } = registryOf(prisma)
  return cachedByVersion(
    prisma,
    snapshots,
    flights,
    (version) => JSON.stringify(['athlete', args.userId, athleteKey(version, args.today)]),
    (version) => buildContext(prisma, args.userId, args.today, version),
  )
}

/**
 * A derived value (statistics, the heart-rate model, a weekly decision, undo availability)
 * computed once per data version. `today` belongs in the key only when the value depends on the
 * day. The result is deep-frozen because every caller shares it; `compute` runs again after any
 * write, and a result computed while a write or a transaction was in flight is returned but not
 * kept.
 */
export async function memoByVersion<T>(
  deps: SnapshotDeps,
  args: { userId: string; name: string; today?: string },
  compute: () => Promise<T> | T,
): Promise<T> {
  const { prisma } = deps
  const { memos, flights } = registryOf(prisma)
  const value = await cachedByVersion<unknown>(
    prisma,
    memos,
    flights,
    (version) => JSON.stringify(['memo', args.userId, args.name, args.today ?? null, version.key]),
    async () => deepFreeze(await compute()),
  )
  return value as T
}

/** The body of `GET /api/state` for a snapshot. */
export async function stateView(context: AthleteContext): Promise<StateView> {
  return {
    version: context.version,
    asOf: context.asOf,
    builtAt: context.builtAt,
    paramsVersion: PARAMS_VERSION,
    state: context.state,
    zones: context.zones,
    readiness: context.readiness,
    goal: context.goal,
    plan: context.plan,
    prediction: context.goal === null ? null : await context.prediction(context.goal.id),
    inputs: context.inputs,
  }
}
