// The pure engine's input, as adapters over the athlete snapshot (`athleteState.ts`, ADR 0009).
// The engine is deterministic and does no I/O, so everything it may read is collected before it
// runs: profile, 365 days of activities, 60 days of wellness and check-ins, 16 weeks of reviews,
// the goal, the home forecast, the race-day climate and the plan it is asked to keep (re-plans,
// today's advice, weekly decisions). The athlete's own data comes from the snapshot, built once
// per change; the goal model, the forecast and the options are added per call. The forecast and the
// race climate are read from the weather cache (`weatherCache.ts`): nothing here waits on the
// network, and a cell the weather job has not filled yet gives no forecast and no race heat.
import type { Deps } from '../app.ts'
import { localWallTime } from '../../shared/dates.ts'
import type { EngineInput, EnteredRace, GoalModel, ZoneSet } from '../../shared/engine/types.ts'
import type { AthleteProfile } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { runnerZone } from '../runnerDay.ts'
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
  // The zone the runner's days follow, so the forecast hours and the engine's `today` share one.
  const zone = runnerZone(profile.timezone)
  for (const hour of cached.hours) {
    if (hour.tempC === null || hour.dewPointC === null) continue
    hours.push({
      time: localWallTime(hour.time, zone),
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
 * The engine input for a snapshot already in hand: the athlete's data as it is, the given goal
 * model (a neutral one for reads about the athlete) and the parts a caller asks for. `existing` and
 * the forecast are added only when asked for. Pure; the arrays are the snapshot's frozen ones.
 * `assemble` below is this plus the per-call parts.
 */
export function inputFromContext(
  context: AthleteContext,
  parts: {
    goal?: GoalModel | null
    races?: EnteredRace[]
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
    // Absent without an entered race, so a plan without one is the plan it always was.
    ...(parts.races === undefined || parts.races.length === 0 ? {} : { races: parts.races }),
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

/**
 * The races the runner entered besides `goal`, for a plan of that goal [rules K6, H12, task SR1]:
 * goals with priority B or C and status `target`, with a distance, dated after today and before the
 * goal race. A goal still being considered, done or dropped is not entered; an A-priority goal
 * other than the plan's own is not read (one A goal), and no climate is read for a tune-up.
 */
export async function enteredRacesFor(
  context: Pick<AthleteContext, 'goals' | 'state' | 'climate' | 'asOf'>,
  goal: Pick<GoalModel, 'goalId' | 'date'>,
): Promise<EnteredRace[]> {
  const out: EnteredRace[] = []
  for (const candidate of context.goals) {
    if (
      candidate.id === goal.goalId ||
      candidate.status !== 'target' ||
      (candidate.priority !== 'B' && candidate.priority !== 'C') ||
      candidate.targetDate <= context.asOf ||
      candidate.targetDate >= goal.date
    ) {
      continue
    }
    const model = await goalModelFor(context, candidate.id, { climate: false })
    if (model !== null) out.push({ priority: candidate.priority, goal: model })
  }
  return out
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
    races: goal === null ? [] : await enteredRacesFor(context, goal),
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

/** The current zone set from the athlete's own data. */
export async function currentZones(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<ZoneSet> {
  return (await loadAthleteContext(deps, args)).zones
}
