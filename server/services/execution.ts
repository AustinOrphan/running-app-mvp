// Planned versus actual on the server: link stored activities to the sessions they fulfil, assess
// each linked session against expectation, and trim the next quality session after a run that was
// much harder than expected [design 4.1 to 4.3]. The engine decides; this module reads and writes.
import { addDays, daysBetween, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { shouldTrimQuality, trimQuality } from '../../shared/engine/adapt.ts'
import {
  assessExecution,
  fitHrModel,
  hasSubjectivePart,
  matchSessions,
} from '../../shared/engine/execution.ts'
import { P } from '../../shared/engine/params/index.ts'
import { checkinOn, isQualityKind } from '../../shared/engine/readiness.ts'
import type {
  AthleteState,
  EngineInput,
  ExecutionAssessment,
  ZoneSet,
} from '../../shared/engine/types.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type { Activity, PlanSession } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PlanSession as PlanSessionRow } from '../db.ts'
import { notFound } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { isTrimmed, toActivity, toPlanSession } from '../serialize.ts'
import { gatherContextInput, sessionSpec } from './engineInput.ts'
import { refreshInsightsQuietly, refreshRecentInsights } from './insight.ts'

/** How far back the nightly sweep looks, in days. */
const SWEEP_DAYS = 7
/** A session can fulfil an activity one day either side of its date [design 4.1]. */
const MATCH_SPREAD_DAYS = 1

type HrModel = NonNullable<ReturnType<typeof fitHrModel>>

interface Context {
  input: EngineInput
  state: AthleteState
  zones: ZoneSet
  hrModel: HrModel | null
}

async function buildContext(
  deps: Deps,
  args: { userId: string; goalId: string; today: string },
): Promise<Context> {
  const input = await gatherContextInput(deps, args, { existing: true })
  const state = estimateState(input)
  return {
    input,
    state,
    zones: buildZones(input.profile, state, args.today),
    hrModel: fitHrModel(input.activities, args.today),
  }
}

async function activePlan(deps: Deps, userId: string) {
  return deps.prisma.plan.findFirst({
    where: { userId, status: 'active', generatorVersion: { gte: 2 } },
    orderBy: { createdAt: 'desc' },
  })
}

function statusOf(assessment: ExecutionAssessment): 'completed' | 'partial' {
  return assessment.completion === 'partial' ? 'partial' : 'completed'
}

/**
 * After a quality session scored much harder than expected, with no pain, the next quality session
 * is trimmed and marked downgraded with the reason; at most one trim per week [design 4.3].
 */
async function trimNextQuality(
  deps: Deps,
  row: PlanSessionRow,
  assessment: ExecutionAssessment,
): Promise<void> {
  if (!isQualityKind(row.kind as PlanSession['kind'])) return
  if (assessment.flags.includes('pain') || assessment.flags.includes('focal-bone-pain')) return
  // Only this session's own evidence can trigger a trim, never an older score, and only a score
  // that rests on the runner's own rating: heart rate or pace alone is a guess.
  if (assessment.effort.score === null || !hasSubjectivePart(assessment.effort.parts)) return
  const { prisma } = deps
  const done = (
    await prisma.planSession.findMany({
      where: { planId: row.planId, execution: { not: null }, date: { lte: row.date } },
      orderBy: [{ date: 'asc' }, { order: 'asc' }],
    })
  )
    .map(toPlanSession)
    .filter(
      (s) =>
        isQualityKind(s.kind) &&
        s.execution !== null &&
        s.execution.effort.score !== null &&
        hasSubjectivePart(s.execution.effort.parts) &&
        !s.execution.flags.includes('pain') &&
        !s.execution.flags.includes('focal-bone-pain'),
    )
  const scores = done.map((s) => s.execution!.effort.score as number)
  const upcoming = (
    await prisma.planSession.findMany({
      where: { planId: row.planId, date: { gt: row.date }, status: 'planned' },
      orderBy: [{ date: 'asc' }, { order: 'asc' }],
    })
  ).map(toPlanSession)
  const next = upcoming.find((s) => isQualityKind(s.kind))
  if (!next) return
  // A trimmed session keeps its trim flag when it is run and its status becomes completed.
  const trimsThisWeek = await prisma.planSession.count({
    where: { planId: row.planId, weekStart: next.weekStart, trimmed: true },
  })
  if (!shouldTrimQuality(scores, trimsThisWeek)) return
  const trimmed = trimQuality(
    sessionSpec(next),
    'The last quality session felt harder than expected, so this one is shorter.',
  )
  await prisma.planSession.update({
    where: { id: next.id },
    data: {
      status: 'downgraded',
      durationMin: trimmed.durationMin,
      distanceM: trimmed.distanceM,
      gainM: trimmed.gainM,
      structure: JSON.stringify(trimmed.structure),
      target: JSON.stringify(trimmed.target),
      purpose: trimmed.purpose,
      rules: JSON.stringify(trimmed.rules),
      trimmed: isTrimmed(trimmed.rules),
      flags: JSON.stringify(trimmed.flags),
      original: JSON.stringify(sessionSpec(next)),
    },
  })
}

/**
 * How strongly an assessment calls for a trim of the next quality session: 0 for none (no score, no rating
 * from the runner, easier than expected, or pain), 1 for a harder-than-expected session, 2 for much harder.
 */
function trimLevel(assessment: ExecutionAssessment | null): number {
  if (assessment === null || assessment.effort.score === null) return 0
  if (!hasSubjectivePart(assessment.effort.parts)) return 0
  if (assessment.flags.includes('pain') || assessment.flags.includes('focal-bone-pain')) return 0
  return assessment.effort.score >= P.trim.triggerScore.value
    ? 2
    : assessment.effort.score >= P.trim.repeatedScore.value
      ? 1
      : 0
}

/** Assesses a linked session and stores the result; a rating that calls for it trims the next session. */
async function assessRow(
  deps: Deps,
  row: PlanSessionRow,
  activity: Activity,
  ctx: Context,
): Promise<PlanSessionRow> {
  // The spike flag compares the run with the longest run before it, so the state leaves this run
  // out and ends the day before it; the state of today already holds the run itself.
  const before = estimateState({
    ...ctx.input,
    today: addDays(activity.date, -1),
    activities: ctx.input.activities.filter((a) => a.id !== activity.id),
  })
  const assessment = assessExecution(sessionSpec(toPlanSession(row)), activity, {
    zones: ctx.zones,
    state: before,
    hrModel: ctx.hrModel,
    checkin: checkinOn(ctx.input, activity.date),
  })
  const previous =
    row.execution === null ? null : (JSON.parse(row.execution) as ExecutionAssessment)
  const updated = await deps.prisma.planSession.update({
    where: { id: row.id },
    data: { execution: JSON.stringify(assessment), status: statusOf(assessment) },
  })
  // A rating that arrives after the first assessment counts as well, but an assessment that
  // already called for a trim does not trim again when it is repeated.
  const level = trimLevel(assessment)
  if (level > 0 && level > trimLevel(previous)) await trimNextQuality(deps, updated, assessment)
  return updated
}

/** Re-assesses one linked session without the pipeline that follows an assessment. */
async function assessLinked(
  deps: Deps,
  args: { userId: string; sessionId: string },
): Promise<PlanSession> {
  const row = await deps.prisma.planSession.findFirst({
    where: { id: args.sessionId, plan: { userId: args.userId } },
    include: { plan: true },
  })
  if (!row) throw notFound('Session not found.')
  if (row.activityId === null) return toPlanSession(row)
  const today = todayIso()
  const ctx = await buildContext(deps, { userId: args.userId, goalId: row.plan.goalId, today })
  const activity = ctx.input.activities.find((a) => a.id === row.activityId)
  if (!activity) return toPlanSession(row)
  return toPlanSession(await assessRow(deps, row, activity, ctx))
}

/**
 * Re-assesses one linked session, for example after the owner links an activity by hand, then
 * describes the run again, since its completion and effort findings rest on the assessment.
 */
export async function assessSessionById(
  deps: Deps,
  args: { userId: string; sessionId: string },
): Promise<PlanSession> {
  const session = await assessLinked(deps, args)
  if (session.activityId !== null) {
    await refreshInsightsQuietly(deps, { userId: args.userId, activityIds: [session.activityId] })
  }
  return session
}

/**
 * Matches the unlinked activities in `activities` to the plan's unlinked sessions, then assesses
 * every linked session whose activity is in the set. Owner links are never changed. Returns the
 * ids of the activities it assessed.
 */
async function matchAndAssess(
  deps: Deps,
  args: { userId: string; planId: string; goalId: string; today: string },
  select: (activity: Activity) => boolean,
): Promise<string[]> {
  const { prisma } = deps
  const ctx = await buildContext(deps, args)
  const activities = ctx.input.activities.filter(select)
  if (activities.length === 0) return []
  const dates = activities.map((a) => a.date).sort()
  const from = addDays(dates[0]!, -MATCH_SPREAD_DAYS)
  const to = addDays(dates[dates.length - 1]!, MATCH_SPREAD_DAYS)
  const rows = await prisma.planSession.findMany({
    where: { planId: args.planId, date: { gte: from, lte: to } },
  })
  // An activity fulfils one session in all (the link is unique across plans): one already linked
  // to a session outside this window, in an archived plan for example, is not offered again.
  const elsewhere = new Set(
    (
      await prisma.planSession.findMany({
        where: {
          activityId: { in: activities.map((a) => a.id) },
          id: { notIn: rows.map((r) => r.id) },
        },
        select: { activityId: true },
      })
    ).map((r) => r.activityId),
  )
  const matches = matchSessions(
    rows.map((r) => ({
      ...sessionSpec(toPlanSession(r)),
      id: r.id,
      activityId: r.activityId,
      linkSource: r.linkSource,
      status: r.status,
    })),
    activities.filter((a) => !elsewhere.has(a.id)),
  )
  const linked = new Map(rows.map((r) => [r.id, r]))
  for (const match of matches) {
    const row = linked.get(match.sessionId)
    if (!row) continue
    linked.set(
      row.id,
      await prisma.planSession.update({
        where: { id: row.id },
        data: { activityId: match.activityId, linkSource: 'auto' },
      }),
    )
  }
  const byId = new Map(activities.map((a) => [a.id, a]))
  const assessed: string[] = []
  for (const row of linked.values()) {
    const activity = row.activityId === null ? undefined : byId.get(row.activityId)
    if (!activity) continue
    await assessRow(deps, row, activity, ctx)
    assessed.push(activity.id)
  }
  return assessed
}

/** Which edit of a stored activity asks whether its link still fits: its date, or only its type. */
export type Reconsider = 'date' | 'type'

/**
 * Whether a stored activity still fits the session it fulfils: the same test the matcher applies,
 * so the kinds are compatible and the dates are at most a day apart [design 4.1].
 */
function stillFits(row: PlanSessionRow, activity: Activity): boolean {
  const spec = sessionSpec(toPlanSession(row))
  return (
    matchSessions(
      [{ ...spec, id: row.id, activityId: null, linkSource: null, status: 'planned' }],
      [activity],
    ).length === 1
  )
}

/** Clears a link and the assessment resting on it; a finished session goes back to planned. */
async function unlink(deps: Deps, row: PlanSessionRow): Promise<void> {
  await deps.prisma.planSession.update({
    where: { id: row.id },
    data: {
      activityId: null,
      linkSource: null,
      execution: null,
      status: row.status === 'completed' || row.status === 'partial' ? 'planned' : row.status,
    },
  })
}

/**
 * Matches an activity to a planned session and assesses the execution (the body of
 * `runExecutionForActivity`). Returns the ids of the other activities it assessed.
 */
async function matchActivity(
  deps: Deps,
  args: { userId: string; activityId: string; reconsider?: Reconsider | undefined },
): Promise<string[]> {
  const { prisma } = deps
  const today = todayIso()
  const activity = await prisma.activity.findFirst({
    where: { id: args.activityId, userId: args.userId },
  })
  if (!activity) return []
  // An activity that already fulfils a session is assessed again whatever its age: an edit or a
  // new rating changes the assessment. Linked sessions of any plan count.
  const linked = await prisma.planSession.findFirst({
    where: { activityId: activity.id, plan: { userId: args.userId } },
  })
  // Dates around a session freed below, whose neighbours may now fulfil it.
  let freed: string | null = null
  if (linked) {
    const keep =
      args.reconsider === undefined ||
      (args.reconsider === 'type' && linked.linkSource === 'owner') ||
      stillFits(linked, toActivity(activity))
    if (keep) {
      await assessLinked(deps, { userId: args.userId, sessionId: linked.id })
      return []
    }
    await unlink(deps, linked)
    freed = linked.date
  }
  const plan = await activePlan(deps, args.userId)
  if (!plan) return []
  // Imports of old history reach here too; only recent activities can fulfil a session.
  let eligible = activity.date >= addDays(today, -SWEEP_DAYS) && activity.date <= addDays(today, 1)
  if (eligible) {
    const near = await prisma.planSession.count({
      where: {
        planId: plan.id,
        date: {
          gte: addDays(activity.date, -MATCH_SPREAD_DAYS),
          lte: addDays(activity.date, MATCH_SPREAD_DAYS),
        },
      },
    })
    eligible = near > 0
  }
  const freedDate = linked?.planId === plan.id ? freed : null
  if (!eligible && freedDate === null) return []
  return matchAndAssess(
    deps,
    { userId: args.userId, planId: plan.id, goalId: plan.goalId, today },
    (a) =>
      (eligible && a.id === activity.id) ||
      (freedDate !== null && Math.abs(daysBetween(freedDate, a.date)) <= MATCH_SPREAD_DAYS),
  )
}

/**
 * After an activity is stored: match it to a planned session and assess the execution, then
 * describe it (what stood out, `insight.ts`) together with every other run the matching assessed,
 * since their findings rest on the assessment. With `reconsider` (its date or type was edited) a
 * linked activity that no longer fits its session is unlinked and matching runs again over the
 * freed session. An owner link is reconsidered only when the date changed: on the same date it
 * stays whatever the type [design 4.1, plan E18]. The runs are described even when matching
 * throws, and a failure to describe one never reaches the caller.
 */
export async function runExecutionForActivity(
  deps: Deps,
  args: { userId: string; activityId: string; reconsider?: Reconsider | undefined },
): Promise<void> {
  let assessed: string[] = []
  try {
    assessed = await matchActivity(deps, args)
  } finally {
    await refreshInsightsQuietly(deps, {
      userId: args.userId,
      activityIds: [args.activityId, ...assessed],
    })
  }
}

/**
 * Matches and assesses after a manual create, an edit or a rating. The activity is already saved,
 * so a failure is logged and never fails the request; the nightly sweep tries again.
 */
export async function runExecutionQuietly(
  deps: Deps,
  args: { userId: string; activityId: string; reconsider?: Reconsider | undefined },
): Promise<void> {
  try {
    await runExecutionForActivity(deps, args)
  } catch (error) {
    createLogger(deps.config).warn({ err: error }, 'matching an activity to the plan failed')
  }
}

/** Nightly sweep over the last 7 days of activities and sessions, for every user with a plan. */
export async function runNightlyMatching(
  deps: Deps,
  args: { today: string; onError?: (error: unknown, userId: string) => void },
): Promise<void> {
  const plans = await deps.prisma.plan.findMany({
    where: { status: 'active', generatorVersion: { gte: 2 } },
  })
  const from = addDays(args.today, -SWEEP_DAYS)
  for (const plan of plans) {
    try {
      await matchAndAssess(
        deps,
        { userId: plan.userId, planId: plan.id, goalId: plan.goalId, today: args.today },
        (a) => a.date >= from && a.date <= args.today,
      )
    } catch (error) {
      // One user's failure must not stop the sweep for the others.
      args.onError?.(error, plan.userId)
    }
    // The runs of the window are described again, whatever matching did; this never throws.
    await refreshRecentInsights(deps, { userId: plan.userId, today: args.today })
  }
}
