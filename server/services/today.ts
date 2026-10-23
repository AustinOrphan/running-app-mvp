// Today as one coach payload (phase 3a design 7.4, ADR 0009). `todayView` composes everything the
// page shows from the athlete snapshot (`loadAthleteContext`), memoised values (`memoByVersion`)
// and the cached home forecast; it reads no table of the history window or of the stored plan
// itself and never the network. The pieces that decide are pure and live in `shared/`
// (`readinessSignals`, `readinessVerdict`, `easedSession`, `resolveTargets`, `weekStrip`,
// `rangeLabel`); this module gathers their inputs and assembles the answer.
//
// The payload keeps the fields the page read before the rebuild (`sessions`, `heat`, `checkin`,
// `readiness`, `unrated`) and adds `tz` and `coach`. Later epics add fields under `TodayCoach`
// only: slots in `todaySlots.ts`, health notes in `todayHealth.ts`.
import { addDays, daysBetween, isIsoDate, mondayOf } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { weekStrip as buildWeekStrip } from '../../shared/domain/weekStrip.ts'
import {
  isHotForSteering,
  NO_HEAT_NOTE_KINDS,
  trainingHeatAdvice,
  type TrainingHeatAdvice,
} from '../../shared/engine/heat.ts'
import { P } from '../../shared/engine/params/index.ts'
import { rangeLabel } from '../../shared/engine/predict.ts'
import {
  easedSession,
  readinessSignals,
  readinessVerdict,
  strongestAdvice,
  todayAdvice,
} from '../../shared/engine/readiness.ts'
import { climbNote, resolveTargets } from '../../shared/engine/targets.ts'
import type { EngineInput } from '../../shared/engine/types.ts'
import type {
  ChangeLine,
  PlanSession,
  TodayCoach,
  TodayHero,
  TodayHeat,
  TodayRace,
  TodayView,
  WeekStrip,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { validationError } from '../errors.ts'
import { toChangeLine } from '../serialize.ts'
import {
  athleteKey,
  loadAthleteContext,
  memoByVersion,
  type AthleteContext,
} from './athleteState.ts'
import { inputFromContext, loadForecast, sessionSpec } from './engineInput.ts'
import { EMPTY_DIFF_MARK } from './replan.ts'
import { jobNotesStamp, todayHealth } from './todayHealth.ts'
import { buildSlots } from './todaySlots.ts'
import { forecastStamp } from './weatherCache.ts'

/** The message of the 400 for a `?date=` outside today and the days ahead the page may preview. */
export const TODAY_RANGE_MESSAGE = 'Use today or one of the next two days.'
/** How many days ahead the page may preview (tomorrow's session is cached the evening before). */
export const PREVIEW_DAYS = 2
/** The change line shows an update of this many days at most, today included. */
export const CHANGE_LINE_DAYS = 7
/** The revision reasons the change line reports; owner edits and undos are not "what changed". */
const CHANGE_LINE_REASONS = ['weekly', 'break', 'review']

const UNRATED_DAYS = 7
const UNRATED_LIMIT = 5
/** Kinds that sit beside the day's main session, not in place of it. */
const SUPPORTING_KINDS: ReadonlySet<PlanSession['kind']> = new Set<PlanSession['kind']>([
  'strength',
  'mobility',
])

/** The server's IANA zone: the zone whose calendar day is "today" for every client. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Throws the 400 of the route unless `date` is `today` or at most `PREVIEW_DAYS` days after it. A
 * malformed date gets the same message: the page only ever asks for one of three days.
 */
export function assertViewable(date: string, today: string): void {
  if (!isIsoDate(date) || date < today || date > addDays(today, PREVIEW_DAYS)) {
    throw validationError(TODAY_RANGE_MESSAGE)
  }
}

// ---------------------------------------------------------------------------------------------
// The validator of the payload
// ---------------------------------------------------------------------------------------------

type ChangeStamp = (args: { deps: Deps; userId: string }) => Promise<string> | string

const stamps: ChangeStamp[] = []

/**
 * Adds a part to the key that `GET /api/today` tags its answer with. The tag follows the data
 * version, the day, the viewed date and the home forecast; a slot or a health-note producer that
 * reads a table outside the data version (`SyncRun`, `WristPublication`, ...) registers the value
 * that changes when that table does (as `forecastStamp` does for `ForecastCache`), or a client
 * holding the old tag would be told nothing changed. Returns the function that removes it.
 */
export function registerTodayStamp(stamp: ChangeStamp): () => void {
  stamps.push(stamp)
  return () => {
    const at = stamps.indexOf(stamp)
    if (at >= 0) stamps.splice(at, 1)
  }
}

// The sync-paused and weekly-update notes read `SyncRun`, which the data version does not cover.
registerTodayStamp(jobNotesStamp)

/**
 * What the payload for a user, a day and a viewed date is valid for. Reads the data version, the
 * forecast stamp and the registered stamps, never the snapshot, so a request that already holds
 * the current tag is answered before anything is built.
 */
export async function todayKey(
  deps: Deps,
  args: { userId: string; today: string; date: string },
): Promise<string> {
  const { prisma } = deps
  const [version, forecast, others] = await Promise.all([
    dataVersionKey(prisma),
    forecastStamp(prisma, args.userId),
    Promise.all(stamps.map(async (stamp) => stamp({ deps, userId: args.userId }))),
  ])
  return [athleteKey(version, args.today), args.date, forecast, ...others].join('~')
}

// ---------------------------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------------------------

/** The session the hero is about: the first that is not strength or mobility, else the first. */
function mainSession<S extends { kind: PlanSession['kind'] }>(sessions: readonly S[]): S | null {
  return sessions.find((s) => !SUPPORTING_KINDS.has(s.kind)) ?? sessions[0] ?? null
}

/** The next day after `date` with a session still to run (not a rest day), as its main session. */
function nextSession(sessions: readonly PlanSession[], date: string): PlanSession | null {
  const ahead = sessions.filter((s) => s.date > date && s.kind !== 'rest' && isToRun(s.status))
  const first = ahead[0]
  return first === undefined ? null : mainSession(ahead.filter((s) => s.date === first.date))
}

/**
 * The newest weekly, break or review update of the last `CHANGE_LINE_DAYS` days that changed
 * something and was not undone, as the plan stored it. Memoised: it moves with the data version
 * (every revision is a state write) and the day.
 */
async function changeLine(deps: Deps, context: AthleteContext): Promise<ChangeLine | null> {
  const plan = context.plan
  if (plan === null) return null
  const today = context.asOf
  return memoByVersion(
    deps,
    { userId: context.userId, name: 'today.change-line', today },
    async () => {
      // Local midnight of the first day of the window; a date-time without an offset is local time.
      const since = new Date(`${addDays(today, 1 - CHANGE_LINE_DAYS)}T00:00:00`)
      const row = await deps.prisma.planRevision.findFirst({
        where: {
          planId: plan.id,
          reason: { in: CHANGE_LINE_REASONS },
          createdAt: { gte: since },
          undoneAt: null,
          // The plan page leaves out an update that changed nothing, and so does this line.
          OR: [{ diff: null }, { NOT: { diff: { contains: EMPTY_DIFF_MARK } } }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, createdAt: true, reason: true, summary: true },
      })
      return row === null ? null : toChangeLine(row)
    },
  )
}

/**
 * The countdown to the plan's goal (else the active goal, `currentGoalFor`) with the prediction
 * range and how wide that range has to be (`rangeLabel`). Null without a goal or once the race
 * has passed.
 */
async function raceBlock(context: AthleteContext, date: string): Promise<TodayRace | null> {
  const goal = context.goal
  if (goal === null) return null
  const daysToRace = daysBetween(date, goal.targetDate)
  if (daysToRace < 0) return null
  const prediction = await context.prediction(goal.id)
  return {
    goalId: goal.id,
    name: goal.name,
    targetDate: goal.targetDate,
    dateProvisional: goal.dateProvisional,
    daysToRace,
    prediction:
      prediction === null
        ? null
        : {
            method: prediction.method,
            predictedSec: prediction.predictedSec,
            lowSec: prediction.lowSec,
            highSec: prediction.highSec,
          },
    range: goal.distanceM === null ? null : rangeLabel({ distanceM: goal.distanceM }),
  }
}

/** The week strip of the viewed day's week, against the plan week's run target. */
function stripFor(context: AthleteContext, date: string): WeekStrip {
  const weekStart = mondayOf(date)
  const planWeek = context.existing()?.weeks.find((week) => week.weekStart === weekStart)
  return buildWeekStrip({
    today: date,
    sessions: context.planSessions,
    activities: context.activities,
    targetRunMin: planWeek?.targetRunMin ?? null,
  })
}

/** Runs of the last week that the runner has not rated yet, newest first. */
function unratedRuns(context: AthleteContext): TodayView['unrated'] {
  const since = addDays(context.asOf, -UNRATED_DAYS)
  return context.activities
    .filter(
      (a) =>
        (a.type === 'run' || a.type === 'race') &&
        a.feel === null &&
        (a.duplicateStatus === 'none' || a.duplicateStatus === 'dismissed') &&
        a.date >= since,
    )
    .reverse()
    .slice(0, UNRATED_LIMIT)
}

/** The snapshot's readiness with the screening note, on a copy (the snapshot is frozen). */
function readinessWithScreening(context: AthleteContext): TodayView['readiness'] {
  const readiness: TodayView['readiness'] = {
    ...context.readiness,
    redFlags: [...context.readiness.redFlags],
  }
  const reds = context.screeningFlags
  if (reds >= P.j5.redsHoldFlags.value) {
    readiness.redFlags.push({
      code: 'reds-screen',
      message: `The energy-availability screen showed ${reds} signs. Progression is on hold; a clinician or sports dietitian can help.`,
      rules: ['n-4', 'J5'],
    })
  }
  return readiness
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

/**
 * The Today payload for `date` (today when omitted, else up to `PREVIEW_DAYS` days ahead; anything
 * else is the route's 400 here too). `today` is the server's day and the day of the snapshot. A
 * day ahead is a read-only preview: its sessions as planned, with no readiness read, no verdict,
 * no signals and no easing, because readiness is never run for a day that has not begun. The week
 * strip, the race countdown and the hero's heat read follow the viewed date, so a preview cached
 * the evening before reads as that day when it is opened offline.
 */
export async function todayView(
  deps: Deps,
  args: { userId: string; today: string; date?: string },
): Promise<TodayView> {
  const { userId, today } = args
  const date = args.date ?? today
  assertViewable(date, today)
  const preview = date > today

  const context = await loadAthleteContext(deps, { userId, today })
  const input = inputFromContext(context, { goal: null, forecast: null, existing: true })
  const sessions = context.planSessions.filter((s) => s.date === date)
  const readiness = readinessWithScreening(context)

  // The advice of the day, downgrade-only (J3). A preview has none: every session is as planned.
  const advice: TodayView['sessions'] = preview
    ? sessions.map((session) => ({ session, advice: 'as-planned', reasons: [] }))
    : todayAdvice(
        input,
        sessions.map((s) => ({ ...sessionSpec(s), id: s.id })),
      ).map((entry, i) => ({ ...entry, session: sessions[i]! }))

  // Heat: the cached forecast only. One read per session, shared by the hero and the heat block.
  const forecast: EngineInput['forecast'] = await loadForecast(deps.prisma, userId, context.profile)
  const heatCache = new Map<string, TrainingHeatAdvice>()
  const heatOf = (session: PlanSession): TrainingHeatAdvice | null => {
    if (forecast === null) return null
    let heat = heatCache.get(session.id)
    if (heat === undefined) {
      heat = trainingHeatAdvice(forecast, sessionSpec(session))
      heatCache.set(session.id, heat)
    }
    return heat
  }

  // The heat block describes the main run of the day; a day with no run has none.
  const heatSession = sessions.find((s) => !NO_HEAT_NOTE_KINDS.has(s.kind)) ?? null
  const heatAdvice = heatSession === null ? null : heatOf(heatSession)
  const peak = heatAdvice?.peak ?? null
  const heat: TodayHeat = {
    wbgtC: peak?.index === 'wbgt' ? peak.value : null,
    note: heatAdvice?.note ?? null,
    coolerHour: heatAdvice?.coolerHour ?? null,
    peakHour: peak?.hour ?? null,
    coolerValue: heatAdvice?.coolerValue ?? null,
    index: peak?.index ?? null,
    hotForSteering: heatSession === null ? false : isHotForSteering(peak, heatSession.flags),
  }

  // The hero: the main session, eased when readiness says so, with the targets it will be run by.
  let hero: TodayHero | null = null
  const main = mainSession(sessions)
  if (main !== null) {
    const row = advice.find((entry) => entry.session.id === main.id)
    const mainAdvice = row?.advice ?? 'as-planned'
    const easedRun = mainAdvice === 'downgrade-easy' ? easedSession(main, context.zones) : null
    const eased = easedRun === main ? null : easedRun
    const runAs = eased ?? main
    const hot = isHotForSteering(heatOf(runAs)?.peak ?? null, runAs.flags)
    hero = {
      session: main,
      advice: mainAdvice,
      reasons: row?.reasons ?? [],
      eased,
      target:
        mainAdvice === 'rest' || main.kind === 'rest'
          ? null
          : { ...resolveTargets(runAs, context.zones, { hot }), climbNote: climbNote(runAs) },
      linkedRun:
        main.activityId === null
          ? null
          : (context.activities.find((a) => a.id === main.activityId) ?? null),
      others: sessions.filter((s) => s.id !== main.id),
    }
  }

  // Readiness is read for today only. The verdict needs the day's session kinds, and none when
  // nothing is planned.
  const signals = preview ? [] : readinessSignals(input, date)
  const verdict = preview
    ? null
    : readinessVerdict({
        advice: strongestAdvice(advice.map((entry) => entry.advice)),
        state: context.readiness.state,
        signalCount: signals.length,
        sessionKinds: sessions.map((s) => s.kind),
      })

  const [change, race, health, slots] = await Promise.all([
    changeLine(deps, context),
    raceBlock(context, date),
    todayHealth({ deps, userId, date, context }),
    buildSlots({ deps, userId, date, today, preview, context }),
  ])

  const coach: TodayCoach = {
    generatedAt: new Date().toISOString(),
    preview,
    verdict,
    signals,
    hero,
    next: nextSession(context.planSessions, date),
    weekStrip: stripFor(context, date),
    race,
    change,
    health,
    slots,
  }

  return {
    date,
    tz: serverTimeZone(),
    sessions: advice,
    heat,
    checkin: preview ? null : readiness.checkin,
    readiness,
    unrated: unratedRuns(context),
    coach,
  }
}
