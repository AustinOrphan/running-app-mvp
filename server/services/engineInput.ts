// The pure engine's input, as adapters over the athlete snapshot (`athleteState.ts`, ADR 0009).
// The engine is deterministic and does no I/O, so everything it may read is collected before it
// runs: profile, 365 days of activities, 60 days of wellness and check-ins, 16 weeks of reviews,
// the goal, the home forecast, the race-day climate and the plan it is asked to keep (re-plans,
// today's advice, weekly decisions). The athlete's own data comes from the snapshot, built once
// per change; the goal model, the forecast and the options are added per call. The forecast and the
// race climate are read from the weather cache (`weatherCache.ts`): nothing here waits on the
// network, and a cell the weather job has not filled yet gives no forecast and no race heat.
import type { Deps } from '../app.ts'
import { todayIso } from '../../shared/dates.ts'
import type { EngineInput, GoalModel, ZoneSet } from '../../shared/engine/types.ts'
import type { AthleteProfile } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import {
  goalModelFor,
  loadAthleteContext,
  neutralGoal,
  toEngineWindow,
  type AthleteContext,
} from './athleteState.ts'
import { cachedForecast } from './weatherCache.ts'

export { existingFrom, neutralGoal, sessionSpec } from './athleteState.ts'

export interface GatherOptions {
  /** Read the cached home forecast (today's heat note). Default false. */
  forecast?: boolean
  /** Read the cached race-day climatology (goal model, prediction). Default true. */
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

/**
 * The cached home forecast in the engine's shape, with hours in the runner's local time. Null
 * without a home, without a filled cell, or when the forecast is older than 24 hours. The home
 * comes from the profile the caller holds, so no extra read of it.
 */
export async function loadForecast(
  prisma: PrismaClient,
  userId: string,
  profile: Pick<AthleteProfile, 'homeLat' | 'homeLng' | 'timezone'>,
  now: Date = new Date(),
): Promise<NonNullable<EngineInput['forecast']> | null> {
  const cached = await cachedForecast(prisma, userId, now, profile)
  if (!cached) return null
  const hours: NonNullable<EngineInput['forecast']> = []
  for (const hour of cached.hours) {
    if (hour.tempC === null || hour.dewPointC === null) continue
    hours.push({
      time: localWallTime(hour.time, profile.timezone),
      tempC: hour.tempC,
      dewPointC: hour.dewPointC,
      humidityPct: hour.humidityPct ?? 50,
      windKph: hour.windKph ?? 0,
      // Without radiation the heat index falls back to the air temperature, which never steers.
      ...(hour.shortwaveWm2 === null ? {} : { shortwaveWm2: hour.shortwaveWm2 }),
    })
  }
  return hours.length > 0 ? hours : null
}

/**
 * The local day of the newest accepted change of each zone boundary, read from the `zones.<boundary>`
 * changes of the accepted-proposal revisions, so zone proposals count fresh observations only.
 */
export async function acceptedZoneChanges(
  deps: Deps,
  userId: string,
): Promise<NonNullable<EngineInput['zoneChanges']>> {
  return (await loadAthleteContext(deps, { userId, today: todayIso() })).zoneChanges
}

/**
 * The engine input for a snapshot already in hand: the athlete's data as it is, the given goal
 * model (a neutral one for reads about the athlete) and the parts a caller asks for. `existing` and
 * the forecast are added only when asked for. Pure; the arrays are the snapshot's frozen ones.
 * `assemble` below is this plus the per-call parts.
 */
export function inputFromContext(
  context: AthleteContext,
  parts: {
    goal?: GoalModel | null
    forecast?: EngineInput['forecast']
    existing?: boolean
    options?: EngineInput['options']
  } = {},
): EngineInput {
  return {
    today: context.asOf,
    profile: context.profile,
    activities: context.activities,
    wellness: context.wellness,
    reviews: context.reviews,
    goal: parts.goal ?? neutralGoal(context.asOf),
    forecast: parts.forecast ?? null,
    existing: parts.existing === true ? context.existing() : null,
    options: parts.options ?? {},
    screeningFlags: context.screeningFlags,
    zoneChanges: context.zoneChanges,
    // Absent without a window, so a plan without windows is the plan it always was.
    ...(context.disruptions.length === 0
      ? {}
      : { disruptions: context.disruptions.map(toEngineWindow) }),
  }
}

async function assemble(
  deps: Deps,
  args: { userId: string; today: string; goalId: string | null; options?: EngineInput['options'] },
  opts: GatherOptions,
): Promise<EngineInput> {
  const { userId, today } = args
  const context = await loadAthleteContext(deps, { userId, today })
  const goal =
    args.goalId === null
      ? null
      : await goalModelFor(context, args.goalId, { climate: opts.climate !== false })

  return inputFromContext(context, {
    goal,
    forecast: opts.forecast ? await loadForecast(deps.prisma, userId, context.profile) : null,
    existing: opts.existing === true,
    ...(args.options === undefined ? {} : { options: args.options }),
  })
}

/**
 * The engine input: profile, 365 days of activities, 60 days of wellness and check-ins, 16 weeks of
 * reviews, the goal model, the forecast and the race climate (the cached archive climatology for
 * the race date and location). The athlete's data is the shared, frozen snapshot: copy an array
 * before sorting or changing it.
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
 * advice). `goalId` null uses a neutral goal; no climate is read unless `opts.climate` asks.
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
 * input as `screeningFlags`, which `estimateState` turns into `risk.redsFlags`.
 */
export async function latestRedsFlags(deps: Deps, userId: string): Promise<number> {
  return (await loadAthleteContext(deps, { userId, today: todayIso() })).screeningFlags
}

/** The current zone set from the athlete's own data. */
export async function currentZones(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<ZoneSet> {
  return (await loadAthleteContext(deps, args)).zones
}
