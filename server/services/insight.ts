// What stood out on a run, stored (phase 3a design 8.3, 8.4 and 8.7). The engine chooses the facts
// (`shared/engine/standout.ts`); this module reads the inputs, keeps the result in `ActivityInsight`
// and is the only code that writes that table. The facts are template ids and slots, never prose,
// and are rendered when they are read.
//
// An insight is computed in three places: lazily, the first time a run is read; by the pipeline
// when a recent activity is stored, edited or rated (`refreshInsightsQuietly`, called after the
// activity is matched to the plan); and by the nightly sweep over the last 7 days. The inputs are
// the athlete snapshot, the memoised heart-rate model, the stored assessment of the session the
// run fulfils and the pain fields of the check-in of the run's day (one row, read by its key, which
// also tells a stored insight that the check-in changed); no history or plan query runs beside
// them. `ActivityInsight` is non-state, so none of these writes moves the data version.
import { createHash } from 'node:crypto'
import { addDays, todayIso } from '../../shared/dates.ts'
import { rankStandouts, standoutFacts, STANDOUT_VERSION } from '../../shared/engine/standout.ts'
import type { StandoutSession } from '../../shared/engine/standout.ts'
import { P } from '../../shared/engine/params/index.ts'
import { checkinOn } from '../../shared/engine/readiness.ts'
import type {
  ExecutionFindings,
  ExplainGroup,
  ExplainView,
  InputFact,
  SessionKind,
} from '../../shared/engine/types.ts'
import type { StandoutView } from '../../shared/copy/standoutRender.ts'
import type { Deps } from '../app.ts'
import { notFound } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { toActivity } from '../serialize.ts'
import { hrModelOf, loadAthleteContext } from './athleteState.ts'

/** Activities this recent get their insight when stored, edited or rated; older ones on first read. */
export const INSIGHT_EAGER_DAYS = 7

/**
 * What `ActivityInsight.facts` holds. `basis` names the stored assessment and the day's check-in
 * pain fields the facts were computed with, so linking or unlinking a session, a new assessment of
 * it, or an edit of the pain score or the bone flag makes the insight stale.
 */
interface StoredInsight {
  basis: string
  items: InputFact[]
}

/** The facts of a run, every finding in rank order, and the moment they were computed. */
export interface InsightRecord {
  facts: InputFact[]
  computedAt: Date
}

type DepsWithPrisma = Pick<Deps, 'prisma' | 'config'>

function parseAssessment(text: string | null): ExecutionFindings | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as ExecutionFindings
  } catch {
    return null
  }
}

interface Link {
  session: StandoutSession | null
  basis: string
}

/**
 * The session a run fulfils (any plan, any status: a moved or eased session that was run still
 * counts) and the assessment stored for it. A run with no assessed session has the basis `none`.
 */
async function linkOf(deps: DepsWithPrisma, userId: string, activityId: string): Promise<Link> {
  const row = await deps.prisma.planSession.findFirst({
    where: { activityId, plan: { userId } },
    select: { id: true, date: true, kind: true, durationMin: true, execution: true },
  })
  const assessment = row === null ? null : parseAssessment(row.execution)
  if (row === null || row.execution === null || assessment === null) {
    return { session: null, basis: 'none' }
  }
  return {
    session: {
      id: row.id,
      date: row.date,
      kind: row.kind as SessionKind,
      durationMin: row.durationMin,
      assessment,
    },
    basis: createHash('sha1').update(`${row.id}:${row.execution}`).digest('hex'),
  }
}

/**
 * The part of the day's check-in that the findings read: the pain score and the bone flag of the
 * run's date. One row by its unique key, so the freshness test still builds no snapshot. A run
 * whose day has no check-in has the same basis as one whose check-in leaves both empty.
 */
async function checkinBasis(deps: DepsWithPrisma, userId: string, date: string): Promise<string> {
  const row = await deps.prisma.wellnessDay.findUnique({
    where: { userId_date: { userId, date } },
    select: { painScore: true, painFocalBone: true },
  })
  return `pain=${row?.painScore ?? '-'},bone=${row?.painFocalBone === true ? '1' : '0'}`
}

function parseStored(text: string): StoredInsight | null {
  try {
    const value = JSON.parse(text) as Partial<StoredInsight> | null
    if (value === null || typeof value.basis !== 'string' || !Array.isArray(value.items)) {
      return null
    }
    return { basis: value.basis, items: value.items }
  } catch {
    return null
  }
}

/** The kinds of activity that get an insight. */
const isRun = (type: string): boolean => type === 'run' || type === 'race'

/**
 * The insight of a run: the stored one while it is fresh, else computed from the snapshot and
 * stored. Stale when the version differs from `STANDOUT_VERSION`, the activity changed after the
 * insight was computed, or the stored assessment or the day's check-in pain fields are not the
 * ones it was computed with; `force` computes it again whatever the row says. A strength or cross
 * activity and a duplicate have no insight and nothing is stored for them. Null when the user has
 * no such activity.
 */
export async function activityInsight(
  deps: DepsWithPrisma,
  args: { userId: string; activityId: string; today?: string; force?: boolean },
): Promise<InsightRecord | null> {
  const { prisma } = deps
  const { userId, activityId } = args
  // The instant is taken before the activity is read: an edit that lands while the inputs are read
  // has an `updatedAt` after it, so the next read sees the insight as stale.
  const computedAt = new Date()
  const row = await prisma.activity.findFirst({ where: { id: activityId, userId } })
  if (row === null) return null
  if (
    !isRun(row.type) ||
    row.duplicateStatus === 'possible' ||
    row.duplicateStatus === 'confirmed'
  ) {
    return { facts: [], computedAt }
  }

  const link = await linkOf(deps, userId, activityId)
  const basis = `${link.basis}|${await checkinBasis(deps, userId, row.date)}`
  if (args.force !== true) {
    const stored = await prisma.activityInsight.findUnique({ where: { activityId } })
    const parsed = stored === null ? null : parseStored(stored.facts)
    if (
      stored !== null &&
      parsed !== null &&
      stored.version === STANDOUT_VERSION &&
      row.updatedAt.getTime() <= stored.computedAt.getTime() &&
      parsed.basis === basis
    ) {
      return { facts: parsed.items, computedAt: stored.computedAt }
    }
  }

  const context = await loadAthleteContext(deps, {
    userId,
    today: args.today ?? todayIso(computedAt),
  })
  const hrModel = await hrModelOf(deps, context)
  const facts = standoutFacts({
    activity: toActivity(row),
    history: context.activities,
    asOf: context.asOf,
    historyFrom: addDays(context.asOf, -P.a5.historyWindowDays.value),
    hrModel,
    session: link.session,
    checkin: checkinOn({ wellness: context.wellness }, row.date),
  })
  const stored: StoredInsight = { basis, items: facts }
  const data = { version: STANDOUT_VERSION, facts: JSON.stringify(stored), computedAt }
  await prisma.activityInsight.upsert({
    where: { activityId },
    create: { activityId, ...data },
    update: data,
  })
  return { facts, computedAt }
}

/** `GET /api/activities/:id/standout`: the first findings of a run. 404 for another user's run. */
export async function standoutView(
  deps: DepsWithPrisma,
  args: { userId: string; activityId: string },
): Promise<StandoutView> {
  const record = await activityInsight(deps, args)
  if (record === null) throw notFound('Activity not found.')
  return rankStandouts(record.facts)
}

/**
 * The figures behind the findings a run shows, as Explain reads them (`subject=activity`): the
 * facts stored with the insight, grouped by the rule they feed, `frozen` because they are the ones
 * written when the insight was computed. 404 for another user's run.
 */
export async function explainActivity(
  deps: DepsWithPrisma,
  args: { userId: string; activityId: string },
): Promise<ExplainView> {
  const record = await activityInsight(deps, args)
  if (record === null) throw notFound('Activity not found.')
  const groups: ExplainGroup[] = []
  for (const fact of rankStandouts(record.facts).items) {
    const group = groups.find((candidate) => candidate.rule === fact.rule)
    if (group) group.facts.push(fact)
    else groups.push({ rule: fact.rule, facts: [fact] })
  }
  return {
    subject: 'activity',
    asOf: todayIso(record.computedAt),
    frozen: true,
    rules: groups.map((group) => group.rule),
    groups,
    rest: [],
  }
}

/**
 * Computes the insights of the given activities again, for the pipeline that follows a store, an
 * edit or a rating. Only recent runs are refreshed (`INSIGHT_EAGER_DAYS`): an import of old history
 * must not build a snapshot per activity, and an older run is computed on its first read. A
 * failure is logged and never reaches the caller; the next read computes the insight lazily.
 */
export async function refreshInsightsQuietly(
  deps: DepsWithPrisma,
  args: { userId: string; activityIds: readonly string[]; today?: string },
): Promise<void> {
  const today = args.today ?? todayIso()
  const from = addDays(today, -INSIGHT_EAGER_DAYS)
  for (const activityId of new Set(args.activityIds)) {
    try {
      const row = await deps.prisma.activity.findFirst({
        where: { id: activityId, userId: args.userId },
        select: { date: true },
      })
      if (row === null || row.date < from) continue
      await activityInsight(deps, { userId: args.userId, activityId, today, force: true })
    } catch (error) {
      createLogger(deps.config).warn({ err: error }, 'computing what stood out on a run failed')
    }
  }
}

/** The nightly sweep for one user: every run of the last `INSIGHT_EAGER_DAYS` days, computed again. */
export async function refreshRecentInsights(
  deps: DepsWithPrisma,
  args: { userId: string; today: string },
): Promise<void> {
  const from = addDays(args.today, -INSIGHT_EAGER_DAYS)
  let activityIds: string[]
  try {
    const context = await loadAthleteContext(deps, { userId: args.userId, today: args.today })
    activityIds = context.activities
      .filter((activity) => isRun(activity.type) && activity.date >= from)
      .map((activity) => activity.id)
  } catch (error) {
    createLogger(deps.config).warn({ err: error }, 'listing the runs to describe failed')
    return
  }
  await refreshInsightsQuietly(deps, { userId: args.userId, activityIds, today: args.today })
}
