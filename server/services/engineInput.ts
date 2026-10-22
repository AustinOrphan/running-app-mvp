// Gathers the pure engine's input from the database. The engine is deterministic and does no I/O,
// so everything it may read is collected here: profile, 365 days of activities, 60 days of
// wellness and check-ins, 16 weeks of reviews, the goal, the home forecast, the race-day climate
// and the plan it is asked to keep (re-plans, today's advice, weekly decisions).
import type { Deps } from '../app.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { goalModel } from '../../shared/engine/goal.ts'
import { weatherIndex } from '../../shared/engine/heat.ts'
import { isQualityKind } from '../../shared/engine/readiness.ts'
import type {
  EngineInput,
  GoalModel,
  PlanChange,
  SessionSpec,
  WeekDraft,
  ZoneProposal,
  ZoneSet,
} from '../../shared/engine/types.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type { PlanPhase, PlanSession, PlanWeek } from '../../shared/types.ts'
import {
  loadActivities,
  loadProfile,
  toGoal,
  toPlanSession,
  toPlanWeek,
  toWeeklyReview,
  toWellnessDay,
} from '../serialize.ts'
import { getForecast } from './weather.ts'

const ACTIVITY_DAYS = 365
const WELLNESS_DAYS = 60
const REVIEW_WEEKS = 16
const FORECAST_TTL_MS = 24 * 3_600_000
const CLIMATE_YEARS = 3
/** Days around the race date that the climatology averages over. */
const CLIMATE_SPREAD_DAYS = 1
/** The archive trails real time by a few days. */
const ARCHIVE_LAG_DAYS = 6
const DEFAULT_START_HOUR = 8
const MAX_WINDOW_HOURS = 12
/** A rough 6 min/km, used only to size the climatology window when the goal has no time target. */
const ROUGH_SEC_PER_M = 0.36
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

export interface GatherOptions {
  /** Fetch the home forecast (today's heat note). Default false. */
  forecast?: boolean
  /** Fetch the race-day climatology (goal model, prediction). Default true. */
  climate?: boolean
  /** Load the active plan as `existing` (re-plans, advice, weekly decisions). Default false. */
  existing?: boolean
}

export type GatherArgs = {
  userId: string
  goalId: string
  today: string
  options?: EngineInput['options']
}

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

/** The wall-clock time `YYYY-MM-DDTHH:00:00` of an instant in an IANA time zone (UTC if unknown). */
export function localWallTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const parts = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    }).formatToParts(ms)
  let list: Intl.DateTimeFormatPart[]
  try {
    list = parts(timeZone)
  } catch {
    list = parts('UTC')
  }
  const get = (type: string) => list.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:00:00`
}

async function loadForecast(deps: Deps, userId: string, timeZone: string) {
  try {
    const forecast = await getForecast(deps, userId, (input, init) => fetch(input, init))
    if (!forecast) return null
    const hours: NonNullable<EngineInput['forecast']> = []
    for (const hour of forecast.hours) {
      if (hour.tempC === null || hour.dewPointC === null) continue
      hours.push({
        time: localWallTime(hour.time, timeZone),
        tempC: hour.tempC,
        dewPointC: hour.dewPointC,
        humidityPct: hour.humidityPct ?? 50,
        windKph: hour.windKph ?? 0,
      })
    }
    return hours.length > 0 ? hours : null
  } catch {
    // A forecast outage only costs the heat note.
    return null
  }
}

const climateCache = new Map<string, { at: number; wbgtC: number | null }>()

/** Empties the climatology cache; tests use it. */
export function resetClimateCache(): void {
  climateCache.clear()
}

interface ArchiveBody {
  hourly?: {
    time?: unknown
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    wind_speed_10m?: unknown
    shortwave_radiation?: unknown
  }
}

function numbers(value: unknown): Array<number | null> {
  return Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    : []
}

/** Mean race-window WBGT of one archive day range, in local time; null without usable hours. */
async function archiveWbgt(
  place: { lat: number; lng: number },
  range: { start: string; end: string },
  window: { startHour: number; hours: number },
): Promise<number[]> {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lng),
    start_date: range.start,
    end_date: range.end,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  })
  const response = await fetch(`${ARCHIVE_URL}?${params.toString()}`)
  if (!response.ok) throw new Error(`Open-Meteo answered HTTP ${response.status}.`)
  const body = (await response.json()) as ArchiveBody
  const times = Array.isArray(body.hourly?.time) ? (body.hourly.time as unknown[]) : []
  const temp = numbers(body.hourly?.temperature_2m)
  const humidity = numbers(body.hourly?.relative_humidity_2m)
  const wind = numbers(body.hourly?.wind_speed_10m)
  const sun = numbers(body.hourly?.shortwave_radiation)
  const out: number[] = []
  times.forEach((time, i) => {
    if (typeof time !== 'string') return
    const hour = Number(time.slice(11, 13))
    if (hour < window.startHour || hour >= window.startHour + window.hours) return
    const t = temp[i]
    if (t === null || t === undefined) return
    const index = weatherIndex({
      tempC: t,
      humidityPct: humidity[i] ?? null,
      windKph: wind[i] ?? null,
      shortwaveWm2: sun[i] ?? null,
    })
    out.push(index.value)
  })
  return out
}

/**
 * Race-day climate from Open-Meteo's archive: the mean WBGT over the race window on the race date
 * (and a day either side) in each of the last three years. Null when the race has no location
 * (race coordinates, else home) or no year could be read; a failed request never fails a plan.
 */
async function raceClimate(
  goal: {
    targetDate: string
    startTime: string | null
    targetTimeSec: number | null
    distanceM: number | null
    raceLat: number | null
    raceLng: number | null
  },
  home: { lat: number | null; lng: number | null; use: boolean },
  today: string,
): Promise<{ wbgtC: number; source: 'climatology' } | null> {
  const lat = goal.raceLat ?? (home.use ? home.lat : null)
  const lng = goal.raceLng ?? (home.use ? home.lng : null)
  if (lat === null || lng === null) return null
  const place = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 }
  const startMatch = goal.startTime === null ? null : /^(\d{2}):\d{2}$/.exec(goal.startTime)
  const startHour = startMatch ? Number(startMatch[1]) : DEFAULT_START_HOUR
  const durationSec = goal.targetTimeSec ?? (goal.distanceM ?? 0) * ROUGH_SEC_PER_M
  const hours = Math.min(MAX_WINDOW_HOURS, Math.max(1, Math.ceil(durationSec / 3600)))
  const key = `${place.lat},${place.lng} ${goal.targetDate.slice(5)} ${startHour}+${hours}`
  const cached = climateCache.get(key)
  if (cached && Date.now() - cached.at < FORECAST_TTL_MS) {
    return cached.wbgtC === null ? null : { wbgtC: cached.wbgtC, source: 'climatology' }
  }

  const goalYear = Number(goal.targetDate.slice(0, 4))
  const samples: number[] = []
  let failed = false
  for (let back = 1; back <= CLIMATE_YEARS; back++) {
    const date = `${goalYear - back}${goal.targetDate.slice(4)}`
    if (date > addDays(today, -ARCHIVE_LAG_DAYS - CLIMATE_SPREAD_DAYS)) continue
    try {
      samples.push(
        ...(await archiveWbgt(
          place,
          { start: addDays(date, -CLIMATE_SPREAD_DAYS), end: addDays(date, CLIMATE_SPREAD_DAYS) },
          { startHour, hours },
        )),
      )
    } catch {
      // Keep the years that did answer.
      failed = true
    }
  }
  const wbgtC =
    samples.length === 0
      ? null
      : Math.round((samples.reduce((sum, v) => sum + v, 0) / samples.length) * 10) / 10
  // A partial or failed read is not cached, so the next plan asks the archive again.
  if (!failed) climateCache.set(key, { at: Date.now(), wbgtC })
  return wbgtC === null ? null : { wbgtC, source: 'climatology' }
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

async function loadExisting(deps: Deps, userId: string): Promise<EngineInput['existing']> {
  const plan = await deps.prisma.plan.findFirst({
    where: { userId, status: 'active', generatorVersion: { gte: 2 } },
    orderBy: { createdAt: 'desc' },
    include: {
      weeks: { orderBy: { index: 'asc' } },
      sessions: { orderBy: [{ date: 'asc' }, { order: 'asc' }] },
    },
  })
  if (!plan) return null
  return existingFrom(plan.weeks.map(toPlanWeek), plan.sessions.map(toPlanSession))
}

/** Summary prefix of the owner revision `decideZoneProposal` writes when a proposal is accepted. */
const ACCEPTED_PROPOSAL = 'Accepted zone proposal '
const ZONE_FIELD = /^zones\.(\w+)$/

/**
 * The local day of the newest accepted change of each zone boundary, read from the `zones.<boundary>`
 * changes of the accepted-proposal revisions, so zone proposals count fresh observations only.
 */
export async function acceptedZoneChanges(
  deps: Deps,
  userId: string,
): Promise<NonNullable<EngineInput['zoneChanges']>> {
  const revisions = await deps.prisma.planRevision.findMany({
    where: { plan: { userId }, reason: 'owner', summary: { startsWith: ACCEPTED_PROPOSAL } },
    orderBy: { createdAt: 'asc' },
    select: { changes: true, createdAt: true },
  })
  const changes: NonNullable<EngineInput['zoneChanges']> = {}
  for (const revision of revisions) {
    for (const change of JSON.parse(revision.changes) as PlanChange[]) {
      const boundary = ZONE_FIELD.exec(change.field)?.[1] as ZoneProposal['boundary'] | undefined
      if (boundary !== undefined) changes[boundary] = todayIso(revision.createdAt)
    }
  }
  return changes
}

async function assemble(
  deps: Deps,
  args: { userId: string; today: string; goalId: string | null; options?: EngineInput['options'] },
  opts: GatherOptions,
): Promise<EngineInput> {
  const { prisma } = deps
  const { userId, today } = args
  const profile = await loadProfile(prisma, userId)

  const activities = (
    await loadActivities(prisma, userId, { from: addDays(today, -ACTIVITY_DAYS), to: today })
  ).reverse()
  const wellnessRows = await prisma.wellnessDay.findMany({
    where: { userId, date: { gte: addDays(today, -WELLNESS_DAYS), lte: today } },
    orderBy: { date: 'asc' },
  })
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
  const reviews = (
    await prisma.weeklyReview.findMany({
      where: { userId, weekStart: { gte: addDays(mondayOf(today), -7 * REVIEW_WEEKS) } },
      orderBy: { weekStart: 'asc' },
    })
  ).map(toWeeklyReview)

  const base: EngineInput = {
    today,
    profile,
    activities,
    wellness,
    reviews,
    goal: neutralGoal(today),
    forecast: null,
    existing: null,
    options: args.options ?? {},
    screeningFlags: await latestRedsFlags(deps, userId),
    zoneChanges: await acceptedZoneChanges(deps, userId),
  }

  const goalRow =
    args.goalId === null
      ? null
      : await prisma.goal.findFirst({ where: { id: args.goalId, userId } })
  let goal = base.goal
  if (goalRow && goalRow.distanceM !== null) {
    const climate =
      opts.climate === false
        ? null
        : await raceClimate(
            goalRow,
            { lat: profile.homeLat, lng: profile.homeLng, use: profile.useHomeWeather },
            today,
          )
    goal = goalModel(toGoal(goalRow), estimateState(base), climate)
  }

  return {
    ...base,
    goal,
    forecast: opts.forecast ? await loadForecast(deps, userId, profile.timezone) : null,
    existing: opts.existing ? await loadExisting(deps, userId) : null,
  }
}

/**
 * Gathers the engine input from the database: profile, 365 days of activities, 60 days of
 * wellness and check-ins, 16 weeks of reviews, the goal model inputs, the forecast and the race
 * climate (Open-Meteo archive climatology for the race date and location).
 */
export async function gatherEngineInput(
  deps: Deps,
  args: GatherArgs,
  opts: GatherOptions = {},
): Promise<EngineInput> {
  return assemble(deps, args, opts)
}

/**
 * The same input for reads that are about the athlete rather than one race (zones, readiness,
 * advice). `goalId` null uses a neutral goal; no climate is fetched unless `opts.climate` asks.
 */
export async function gatherContextInput(
  deps: Deps,
  args: { userId: string; today: string; goalId: string | null; options?: EngineInput['options'] },
  opts: GatherOptions = {},
): Promise<EngineInput> {
  return assemble(deps, args, { climate: false, ...opts })
}

/**
 * The REDs flag count of the latest screening, 0 without one. `assemble` puts it on the engine
 * input as `screeningFlags`, which `estimateState` turns into `risk.redsFlags`; the Today view
 * reads it here directly to add its note.
 */
export async function latestRedsFlags(deps: Deps, userId: string): Promise<number> {
  const row = await deps.prisma.screening.findFirst({
    where: { userId, kind: 'reds' },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  return row?.flags ?? 0
}

/** The current zone set from the athlete's own data. */
export async function currentZones(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<ZoneSet> {
  const input = await gatherContextInput(deps, { ...args, goalId: null })
  return buildZones(input.profile, estimateState(input), args.today)
}
