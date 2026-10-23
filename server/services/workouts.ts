// What goes out of the app as a workout (phase 3a design 6.4 and 6.5): `buildDeliverables` turns
// the stored plan's sessions into workouts, once, for every route that sends one. The FIT file and
// zip are served from here; the intervals.icu publisher (E1-5) and the calendar feed (E1-6) call
// the same builder, so a file, the watch and the calendar cannot disagree about a session.
//
// The builder reads the athlete snapshot once (`loadAthleteContext`) and the cached forecast, and
// asks the fuel seam once. Today, and only today, can be eased or withdrawn by the readiness
// advice (rule J3 is a statement about today); tomorrow's session goes out as planned and is
// eased on its own day. Targets come from `resolveTargets`, with heat steering from the forecast's
// peak (`isHotForSteering`), so every surface shows the figures of the hero.
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { addDays, daysBetween } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { render } from '../../shared/copy/template.ts'
import { WORKOUT_TEMPLATES } from '../../shared/copy/workouts.ts'
import { isHotForSteering, trainingHeatAdvice } from '../../shared/engine/heat.ts'
import { easedSession, todayAdvice } from '../../shared/engine/readiness.ts'
import { resolveTargets } from '../../shared/engine/targets.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanSessionStatus, TodayAdvice, Units } from '../../shared/types.ts'
import { FILE_SLUGS, publishable } from '../../shared/workouts/labels.ts'
import { toWorkoutPlan } from '../../shared/workouts/plan.ts'
import type { WorkoutPlan } from '../../shared/workouts/types.ts'
import type { Deps } from '../app.ts'
import { conflict, notFound } from '../errors.ts'
import { loadAthleteContext } from './athleteState.ts'
import { inputFromContext, loadForecast } from './engineInput.ts'
import { fuelLineFor, loadFuelContext } from './fuelLine.ts'
import { encodeWorkoutFit } from './workoutFit.ts'

// ---------------------------------------------------------------------------------------------
// Deliverables
// ---------------------------------------------------------------------------------------------

interface DeliverableBase {
  /** `PlanSession.id`. */
  sessionId: string
  /** `PlanSession.externalId`: the identity outside the database (design 4.1). */
  externalId: string
  date: string
  order: number
  /** The kind in the stored plan; an eased session goes out as an easy run. */
  plannedKind: SessionKind
}

/** A workout to put on the watch, in a file or in the calendar. */
export interface SendDeliverable extends DeliverableBase {
  action: 'send'
  plan: WorkoutPlan
}

/**
 * A session the readiness advice takes off the day (rest): nothing goes out for it, and a copy
 * already on the watch is withdrawn. A skipped, settled or non-run session is not listed at all.
 */
export interface WithdrawDeliverable extends DeliverableBase {
  action: 'withdraw'
  cause: 'rest-advice'
}

export type Deliverable = SendDeliverable | WithdrawDeliverable

export interface DeliverableRange {
  from: string
  to: string
  /** The local day. */
  today: string
}

/** The workout of every publishable, to-run session from `from` to `to`, by date and order. */
export async function buildDeliverables(
  deps: Deps,
  userId: string,
  range: DeliverableRange,
): Promise<Deliverable[]> {
  const { from, to, today } = range
  const context = await loadAthleteContext(deps, { userId, today })
  const sessions = (context.existing()?.sessions ?? [])
    .filter(
      (s) =>
        s.date >= from &&
        s.date <= to &&
        publishable(s.kind) &&
        isToRun(s.status as PlanSessionStatus),
    )
    .sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
  if (sessions.length === 0) return []

  const [user, forecast] = await Promise.all([
    deps.prisma.user.findUnique({ where: { id: userId }, select: { units: true } }),
    loadForecast(deps.prisma, userId, context.profile),
  ])
  // The fuel context reuses the snapshot and the forecast read above: one read of each per build.
  const fuel = await loadFuelContext(
    deps,
    { userId, today, horizonDays: Math.max(0, daysBetween(today, to)) },
    { athlete: context, forecast },
  )
  const units: Units = user?.units === 'mi' ? 'mi' : 'km'

  const advice = new Map<string, TodayAdvice>()
  const todays = sessions.filter((s) => s.date === today)
  if (todays.length > 0) {
    const input = inputFromContext(context, { existing: true, forecast })
    for (const entry of todayAdvice(input, todays)) advice.set(entry.session.id, entry.advice)
  }

  return sessions.map((planned): Deliverable => {
    const base: DeliverableBase = {
      sessionId: planned.id,
      externalId: externalIdOf(planned),
      date: planned.date,
      order: planned.order,
      plannedKind: planned.kind,
    }
    const verdict = advice.get(planned.id) ?? 'as-planned'
    if (verdict === 'rest') return { ...base, action: 'withdraw', cause: 'rest-advice' }

    const source = verdict === 'downgrade-easy' ? easedSession(planned, context.zones) : planned
    const peak = forecast === null ? null : trainingHeatAdvice(forecast, source).peak
    const targets = resolveTargets(source, context.zones, {
      hot: isHotForSteering(peak, source.flags),
    })
    // An eased run keeps its fuel target (design 10.5): the minutes and the day are the planned
    // ones, and the planned flags carry `fuel-practice`, which `easedSession` drops with the rest.
    const fuelLine = fuelLineFor(fuel, {
      id: planned.id,
      date: planned.date,
      kind: source.kind,
      durationMin: source.durationMin,
      flags: planned.flags,
      status: planned.status as PlanSessionStatus,
    })
    return {
      ...base,
      action: 'send',
      // `easedSession` returns a session it leaves alone as it is, which then is not eased
      plan: toWorkoutPlan(source, targets, { eased: source !== planned, fuelLine, units }),
    }
  })
}

function externalIdOf(session: { id: string; externalId?: string }): string {
  if (session.externalId === undefined) {
    throw new Error(`Session ${session.id} has no externalId in the athlete snapshot`)
  }
  return session.externalId
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export interface WorkoutDownload {
  /** The name for `Content-Disposition`: ASCII, made of a date and the kind of the workout. */
  fileName: string
  bytes: Uint8Array
}

const text = (id: keyof typeof WORKOUT_TEMPLATES): string => render(WORKOUT_TEMPLATES[id], {}, 'km')

/**
 * `2027-03-02-easy-run.fit` for each deliverable: its date and the allowlisted slug of the kind
 * that goes out, never the title. A second file of one kind on one day takes `-2`, a third `-3`.
 */
function fileNames(deliverables: readonly SendDeliverable[]): Map<string, string> {
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const d of deliverables) {
    const stem = `${d.date}-${FILE_SLUGS[d.plan.kind]}`
    const n = (seen.get(stem) ?? 0) + 1
    seen.set(stem, n)
    names.set(d.sessionId, `${stem}${n === 1 ? '' : `-${String(n)}`}.fit`)
  }
  return names
}

/** A number that tells the files of one week apart on a watch (`file_id.serial_number`, never 0). */
function serialOf(externalId: string): number {
  const value = createHash('sha256').update(externalId).digest().readUInt32BE(0)
  return value === 0 ? 1 : value
}

const fitOf = (d: SendDeliverable, now: Date): Uint8Array =>
  encodeWorkoutFit(d.plan, { createdAt: now, serial: serialOf(d.externalId) })

/**
 * The workout file of one session of the user's active plan, as it would go to the watch today
 * (the eased version on a day readiness eased it, the current zones' targets).
 *
 * @throws 404 outside the active plan; 409 for a session that is not a run, is already done or
 *   skipped, or that the readiness advice takes off today.
 */
export async function sessionWorkoutFile(
  deps: Deps,
  args: { userId: string; sessionId: string; today: string; now: Date },
): Promise<WorkoutDownload> {
  const { userId, today, now } = args
  const row = await deps.prisma.planSession.findFirst({
    where: { id: args.sessionId, plan: { userId, status: 'active' } },
    select: { id: true, date: true, kind: true, status: true },
  })
  if (!row) throw notFound(text('workout.file.not-found'))
  if (!publishable(row.kind as SessionKind)) {
    throw conflict(text('workout.file.not-a-run'), { reason: 'not-a-run' })
  }
  if (!isToRun(row.status as PlanSessionStatus)) {
    throw conflict(text('workout.file.settled'), { reason: 'settled' })
  }

  const day = await buildDeliverables(deps, userId, { from: row.date, to: row.date, today })
  const found = day.find((d) => d.sessionId === row.id)
  if (found === undefined) throw notFound(text('workout.file.not-found'))
  if (found.action === 'withdraw') {
    throw conflict(text('workout.file.rest'), { reason: 'rest-advice' })
  }
  const sends = day.filter((d): d is SendDeliverable => d.action === 'send')
  return { fileName: fileNames(sends).get(row.id)!, bytes: fitOf(found, now) }
}

/**
 * A zip of the workout files of one week: every publishable, to-run session of the Monday's week.
 *
 * @throws 409 when the week has none.
 */
export async function weekWorkoutZip(
  deps: Deps,
  args: { userId: string; weekStart: string; today: string; now: Date },
): Promise<WorkoutDownload> {
  const { userId, weekStart, today, now } = args
  const week = await buildDeliverables(deps, userId, {
    from: weekStart,
    to: addDays(weekStart, 6),
    today,
  })
  const sends = week.filter((d): d is SendDeliverable => d.action === 'send')
  if (sends.length === 0) throw conflict(text('workout.file.week-empty'), { reason: 'empty' })
  const names = fileNames(sends)
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {}
  for (const d of sends) entries[names.get(d.sessionId)!] = [fitOf(d, now), { mtime: now }]
  return { fileName: `workouts-${weekStart}.zip`, bytes: zipSync(entries) }
}
