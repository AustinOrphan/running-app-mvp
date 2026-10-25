// The Monday brief (phase 3a design 8.3 to 8.5 and 8.7): the facts of one week, stored in
// `WeeklyBrief`. The engine chooses the facts (`shared/engine/brief.ts`); this module reads their
// inputs, keeps the result and is the only code that writes that table. The facts are template ids
// and slots, never prose, and are worded when they are read (`shared/copy/briefRender.ts`).
//
// A brief is written in two places. The weekly job calls `generateBrief` after its re-plan
// returns, in a try/catch of its own (a brief failure never fails the re-plan), and also after a
// re-plan that failed, with a note that says why the plan was not updated. `GET /api/brief` builds
// the current week's brief when it finds none: from the weekly revision if the job wrote one and
// its brief was lost, else provisionally, reading today's plan. A past week is never built on
// demand. The unique key on the user and the week makes concurrent builds resolve to one row, and
// a provisional brief is replaced by the job's.
//
// The inputs are the athlete snapshot (`loadAthleteContext`), the stored revision, the weekly
// decision, the cached home forecast and the two weekly rows of `PredictionLog`; no history or
// plan query runs beside them. `WeeklyBrief` is non-state, so none of these writes moves the data
// version. A brief is seen when the revision it describes is: `PlanRevision.seenAt` is the one
// marker, and stamping it is a state write.
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { BRIEF_VERSION, buildBriefFacts } from '../../shared/engine/brief.ts'
import { isHotForSteering, trainingHeatAdvice } from '../../shared/engine/heat.ts'
import type {
  BriefFacts,
  BriefReplanCode,
  ExplainGroup,
  ExplainView,
} from '../../shared/engine/types.ts'
import type { BriefListItem, BriefView, PlanRevisionView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { WeeklyBrief as WeeklyBriefRow } from '../db.ts'
import { HttpError, notFound } from '../errors.ts'
import { WEEKLY_REASONS } from '../jobs/weeklyUpdate.ts'
import { loadAthleteContext, type AthleteContext } from './athleteState.ts'
import { inputFromContext, loadForecast } from './engineInput.ts'
import { weeklyDecisions } from './planEngine.ts'
import { EMPTY_DIFF_MARK } from './replan.ts'
import { viewRevision, viewRevisions } from './revisions.ts'

/** Revisions listed under "Since this brief". */
const SINCE_LIMIT = 20

// ---------------------------------------------------------------------------------------------
// Reading what is stored
// ---------------------------------------------------------------------------------------------

/**
 * The stored facts, or null when the column cannot be read as a brief. A brief of another version
 * is read as stored: its template ids keep their meaning (ADR 0010).
 */
export function readFacts(text: string): BriefFacts | null {
  try {
    const value = JSON.parse(text) as Partial<BriefFacts> | null
    if (
      value === null ||
      typeof value !== 'object' ||
      typeof value.weekStart !== 'string' ||
      !Array.isArray(value.noticed)
    ) {
      return null
    }
    return value as BriefFacts
  } catch {
    return null
  }
}

/**
 * The facts a reader is shown. A provisional brief of a week that is over never saw its update
 * (the job would have replaced it), so it reads as one that did not run, and no decision is stated.
 */
function presentedFacts(row: WeeklyBriefRow, facts: BriefFacts, today: string): BriefFacts {
  if (!isStale(row, today)) return facts
  return { ...facts, decision: null, replan: facts.replan ?? 'not-run' }
}

function isStale(row: Pick<WeeklyBriefRow, 'provisional' | 'weekStart'>, today: string): boolean {
  return row.provisional && row.weekStart < mondayOf(today)
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

// ---------------------------------------------------------------------------------------------
// Why an update wrote nothing
// ---------------------------------------------------------------------------------------------

/**
 * The note for a re-plan that threw, from what is known without reading the message: no active
 * plan, a goal whose date has passed, a plan that failed its quality checklist (422), or any other
 * error. The message itself is never stored.
 */
export function replanNoteOf(
  error: unknown,
  context: Pick<AthleteContext, 'plan' | 'goal'>,
  today: string,
): BriefReplanCode {
  if (context.plan === null) return 'no-plan'
  if (context.goal !== null && context.goal.targetDate < today) return 'goal-passed'
  if (error instanceof HttpError) {
    if (error.status === 404) return 'no-plan'
    if (error.status === 422) return 'checklist'
  }
  return 'error'
}

// ---------------------------------------------------------------------------------------------
// Building a brief
// ---------------------------------------------------------------------------------------------

interface Composed {
  planId: string | null
  revisionId: string | null
  /** True when the revision it describes changed nothing. */
  quiet: boolean
  facts: BriefFacts
}

interface ComposeArgs {
  userId: string
  today: string
  /** The revision the weekly update wrote. */
  revisionId: string | null
  /** The error that stopped the update, when it did. */
  failure?: unknown
}

/** The weekly decision a brief states: the revision's own, else the one read from the data now. */
async function decisionFor(
  deps: Deps,
  args: { userId: string; today: string; last: string; revision: PlanRevisionView | null },
) {
  if (args.revision?.decision != null) return args.revision.decision
  const decisions = await weeklyDecisions(deps, {
    userId: args.userId,
    today: args.today,
    weekStarts: [args.last],
  })
  return decisions.get(args.last) ?? null
}

/** The weekly prediction of the goal for `weekStart` and the week before, the newest of each. */
async function weeklyPredictions(
  deps: Deps,
  args: { userId: string; goalId: string; weekStart: string },
) {
  const rows = await deps.prisma.predictionLog.findMany({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      weekStart: { in: [args.weekStart, addDays(args.weekStart, -7)] },
    },
    orderBy: [{ loggedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { weekStart: true, predictedSec: true },
  })
  const newest = new Map<string, number>()
  for (const row of rows)
    if (!newest.has(row.weekStart)) newest.set(row.weekStart, row.predictedSec)
  return [...newest].map(([weekStart, predictedSec]) => ({ weekStart, predictedSec }))
}

/** The facts of the brief for `today`'s week, from the snapshot and the revision (if any). */
async function compose(deps: Deps, args: ComposeArgs): Promise<Composed> {
  const { userId, today } = args
  const weekStart = mondayOf(today)
  const last = addDays(weekStart, -7)
  const context = await loadAthleteContext(deps, { userId, today })
  const revision =
    args.revisionId === null
      ? null
      : await viewRevision(deps, { userId, revisionId: args.revisionId })
  const replan = args.failure === undefined ? null : replanNoteOf(args.failure, context, today)
  const decision =
    context.plan === null ? null : await decisionFor(deps, { userId, today, last, revision })
  const forecast = await loadForecast(deps.prisma, userId, context.profile)
  const goal = context.goal
  const predictions =
    goal === null ? [] : await weeklyPredictions(deps, { userId, goalId: goal.id, weekStart })

  const facts = buildBriefFacts({
    weekStart,
    asOf: today,
    input: inputFromContext(context, { existing: true }),
    state: context.state,
    zones: context.zones,
    decision,
    revision: revision === null ? null : { diff: revision.diff, causes: revision.causes },
    replan,
    goal: goal === null ? null : { name: goal.name, date: goal.targetDate },
    predictions,
    // The same test the hero and the watch apply: the cached forecast's peak, and the session's flags.
    isHot: (session) =>
      isHotForSteering(
        forecast === null ? null : trainingHeatAdvice(forecast, session).peak,
        session.flags,
      ),
  })
  return {
    planId: context.plan?.id ?? null,
    revisionId: revision?.id ?? null,
    quiet: revision?.diff?.empty === true,
    facts,
  }
}

function rowData(composed: Composed, provisional: boolean) {
  return {
    planId: composed.planId,
    revisionId: composed.revisionId,
    version: BRIEF_VERSION,
    facts: JSON.stringify(composed.facts),
    provisional,
    generatedAt: new Date(),
  }
}

/**
 * Writes the brief of `today`'s week, replacing a provisional one. Called by the weekly job after
 * its re-plan: with the revision it wrote, or with the error that stopped it, which becomes a note
 * on the brief. A brief that already describes a revision is left alone by one that describes none,
 * so a late failure never replaces the brief of an update that ran. It is also left alone by a
 * second update of the week that changed nothing (the catch-up and the 03:00 slot can both
 * re-plan one plan), which would otherwise say "the plan did not change" over the update that did.
 */
export async function generateBrief(
  deps: Deps,
  args: { userId: string; today: string } & ({ revisionId: string } | { failure: unknown }),
): Promise<void> {
  const { userId, today } = args
  const weekStart = mondayOf(today)
  const composed = await compose(deps, {
    userId,
    today,
    ...('revisionId' in args
      ? { revisionId: args.revisionId }
      : { revisionId: null, failure: args.failure }),
  })
  const key = { userId_weekStart: { userId, weekStart } }
  if (composed.revisionId === null) {
    const existing = await deps.prisma.weeklyBrief.findUnique({
      where: key,
      select: { revisionId: true },
    })
    if (existing?.revisionId != null) return
  } else if (composed.quiet) {
    const kept = await deps.prisma.weeklyBrief.findFirst({
      where: {
        userId,
        weekStart,
        provisional: false,
        revision: {
          is: {
            id: { not: composed.revisionId },
            OR: [{ diff: null }, { NOT: { diff: { contains: EMPTY_DIFF_MARK } } }],
          },
        },
      },
      select: { id: true },
    })
    if (kept !== null) return
  }
  const data = rowData(composed, false)
  try {
    await deps.prisma.weeklyBrief.upsert({
      where: key,
      create: { userId, weekStart, ...data },
      update: data,
    })
  } catch (error) {
    // Two builds met on the unique key; the second one updates what the first created.
    if (!isUniqueViolation(error)) throw error
    await deps.prisma.weeklyBrief.update({ where: key, data })
  }
}

// ---------------------------------------------------------------------------------------------
// The current week, on a request
// ---------------------------------------------------------------------------------------------

/**
 * This week's automatic revision of the plan that no brief describes yet: a job that wrote its
 * revision and lost its brief leaves this behind, and the brief then describes it.
 */
async function unclaimedWeeklyRevision(
  deps: Deps,
  args: { planId: string; weekStart: string },
): Promise<string | null> {
  const row = await deps.prisma.planRevision.findFirst({
    where: {
      planId: args.planId,
      reason: { in: WEEKLY_REASONS },
      // The Monday begins at local midnight (ADR 0003).
      createdAt: { gte: new Date(`${args.weekStart}T00:00:00`) },
      brief: null,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return row?.id ?? null
}

/** Builds this week's brief for a request: from the weekly revision if there is one, else provisionally. */
async function composeCurrent(
  deps: Deps,
  args: { userId: string; today: string; planId: string },
): Promise<{ composed: Composed; provisional: boolean }> {
  const revisionId = await unclaimedWeeklyRevision(deps, {
    planId: args.planId,
    weekStart: mondayOf(args.today),
  })
  const composed = await compose(deps, {
    userId: args.userId,
    today: args.today,
    revisionId,
  })
  return { composed, provisional: revisionId === null }
}

/**
 * The brief of the week that `today` falls in, built when there is none. Null without an active
 * plan. Concurrent callers create one row: the loser of the unique key reads the winner's.
 */
async function ensureCurrent(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<WeeklyBriefRow | null> {
  const { userId, today } = args
  const weekStart = mondayOf(today)
  const context = await loadAthleteContext(deps, { userId, today })
  if (context.plan === null) return null
  const { composed, provisional } = await composeCurrent(deps, {
    userId,
    today,
    planId: context.plan.id,
  })
  try {
    return await deps.prisma.weeklyBrief.create({
      data: { userId, weekStart, ...rowData(composed, provisional) },
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return deps.prisma.weeklyBrief.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    })
  }
}

/**
 * Reads a provisional brief again, since it reads today's plan: it takes the update's revision
 * once there is one, and is written only when something differs. The filter on `provisional` keeps
 * the job's brief if it landed in between.
 */
async function refreshProvisional(
  deps: Deps,
  args: { userId: string; today: string; row: WeeklyBriefRow },
): Promise<WeeklyBriefRow> {
  const { row } = args
  const context = await loadAthleteContext(deps, { userId: args.userId, today: args.today })
  if (context.plan === null) return row
  const { composed, provisional } = await composeCurrent(deps, {
    userId: args.userId,
    today: args.today,
    planId: context.plan.id,
  })
  const facts = JSON.stringify(composed.facts)
  if (
    facts === row.facts &&
    provisional === row.provisional &&
    composed.revisionId === row.revisionId &&
    composed.planId === row.planId
  ) {
    return row
  }
  await deps.prisma.weeklyBrief.updateMany({
    where: { id: row.id, provisional: true },
    data: rowData(composed, provisional),
  })
  return (await deps.prisma.weeklyBrief.findUnique({ where: { id: row.id } })) ?? row
}

/** The stored row for a week; the current week's is built when missing or provisional. */
async function briefRow(
  deps: Deps,
  args: { userId: string; weekStart: string; today: string },
): Promise<WeeklyBriefRow | null> {
  const { userId, weekStart, today } = args
  const row = await deps.prisma.weeklyBrief.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
  })
  if (weekStart !== mondayOf(today)) return row
  if (row === null) return ensureCurrent(deps, { userId, today })
  return row.provisional ? refreshProvisional(deps, { userId, today, row }) : row
}

// ---------------------------------------------------------------------------------------------
// Serving a brief
// ---------------------------------------------------------------------------------------------

/**
 * The revisions of the brief's plan after the one it describes (after the brief itself, when it
 * describes none) and within its week, newest first, without the no-ops. A provisional brief reads
 * today's plan, so nothing happened since it.
 */
async function sinceRows(deps: Deps, userId: string, row: WeeklyBriefRow) {
  if (row.planId === null || row.provisional) return []
  const anchor =
    row.revisionId === null
      ? row.generatedAt
      : ((
          await deps.prisma.planRevision.findFirst({
            where: { id: row.revisionId },
            select: { createdAt: true },
          })
        )?.createdAt ?? row.generatedAt)
  // The week ends at the local midnight that opens the next Monday.
  const weekEnd = new Date(`${addDays(row.weekStart, 7)}T00:00:00`)
  return deps.prisma.planRevision.findMany({
    where: {
      planId: row.planId,
      plan: { userId },
      createdAt: { gt: anchor, lt: weekEnd },
      ...(row.revisionId === null ? {} : { id: { not: row.revisionId } }),
      OR: [{ diff: null }, { NOT: { diff: { contains: EMPTY_DIFF_MARK } } }],
    },
    // The payload is server-only and large; undo availability reads it for the few that can be undone.
    omit: { undo: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: SINCE_LIMIT,
  })
}

async function neighbour(
  deps: Deps,
  userId: string,
  weekStart: string,
  side: 'prev' | 'next',
): Promise<string | null> {
  const found = await deps.prisma.weeklyBrief.findFirst({
    where: { userId, weekStart: side === 'prev' ? { lt: weekStart } : { gt: weekStart } },
    orderBy: { weekStart: side === 'prev' ? 'desc' : 'asc' },
    select: { weekStart: true },
  })
  return found?.weekStart ?? null
}

async function toView(
  deps: Deps,
  args: { userId: string; row: WeeklyBriefRow; today: string },
): Promise<BriefView | null> {
  const { userId, row, today } = args
  const stored = readFacts(row.facts)
  if (stored === null) return null
  const [revision, since, prev, next] = await Promise.all([
    row.revisionId === null ? null : viewRevision(deps, { userId, revisionId: row.revisionId }),
    sinceRows(deps, userId, row).then(async (rows): Promise<PlanRevisionView[]> => {
      if (rows.length === 0 || row.planId === null) return []
      const plan = await deps.prisma.plan.findFirst({
        where: { id: row.planId, userId },
        select: { status: true },
      })
      return viewRevisions(deps, { userId, rows, planActive: plan?.status === 'active' })
    }),
    neighbour(deps, userId, row.weekStart, 'prev'),
    neighbour(deps, userId, row.weekStart, 'next'),
  ])
  const stale = isStale(row, today)
  return {
    weekStart: row.weekStart,
    planId: row.planId,
    version: row.version,
    provisional: row.provisional && !stale,
    seen: revision === null || revision.seenAt !== null,
    generatedAt: row.generatedAt.toISOString(),
    facts: presentedFacts(row, stored, today),
    revision,
    since,
    prev,
    next,
  }
}

/**
 * `GET /api/brief`: the brief of a week, or null. The current week's is built when missing (from
 * its weekly revision, else provisionally); a past or future week's is only read, never built.
 */
export async function briefView(
  deps: Deps,
  args: { userId: string; weekStart?: string; today?: string },
): Promise<BriefView | null> {
  const today = args.today ?? todayIso()
  const weekStart = args.weekStart ?? mondayOf(today)
  const row = await briefRow(deps, { userId: args.userId, weekStart, today })
  return row === null ? null : toView(deps, { userId: args.userId, row, today })
}

/**
 * The slim items of stored rows, in the order of the rows; a row that cannot be read is left out.
 * The revision rows come in one query. A frozen key session is not "next" once its day has passed:
 * `nextKey` is null from the day after it, whichever surface asks, so the brief list and Today's
 * line say the same.
 */
async function listItems(
  deps: Deps,
  rows: readonly WeeklyBriefRow[],
  today: string,
): Promise<BriefListItem[]> {
  const ids = rows.flatMap((row) => (row.revisionId === null ? [] : [row.revisionId]))
  const revisions: Array<{ id: string; seenAt: Date | null; undoneAt: Date | null }> =
    ids.length === 0
      ? []
      : await deps.prisma.planRevision.findMany({
          where: { id: { in: ids } },
          select: { id: true, seenAt: true, undoneAt: true },
        })
  const byId = new Map(revisions.map((revision) => [revision.id, revision]))
  const items: BriefListItem[] = []
  for (const row of rows) {
    const stored = readFacts(row.facts)
    if (stored === null) continue
    const facts = presentedFacts(row, stored, today)
    const revision = row.revisionId === null ? null : (byId.get(row.revisionId) ?? null)
    const key = facts.keySession
    items.push({
      weekStart: row.weekStart,
      provisional: row.provisional && !isStale(row, today),
      seen: revision === null || revision.seenAt !== null,
      generatedAt: row.generatedAt.toISOString(),
      decision: facts.decision?.kind ?? null,
      replan: facts.replan,
      changeCount: facts.changes?.count ?? 0,
      undone: revision?.undoneAt != null,
      nextKey:
        key === null || key.date < today
          ? null
          : { date: key.date, kind: key.kind, distanceEstimate: key.distanceEstimate ?? null },
    })
  }
  return items
}

/**
 * `GET /api/briefs`: the newest briefs, slim, for the brief page's history. Reads only; the
 * revision rows of the page come in one query.
 */
export async function briefList(
  deps: Deps,
  args: { userId: string; limit: number; today?: string },
): Promise<BriefListItem[]> {
  const today = args.today ?? todayIso()
  const rows = await deps.prisma.weeklyBrief.findMany({
    where: { userId: args.userId },
    orderBy: { weekStart: 'desc' },
    take: args.limit,
  })
  return listItems(deps, rows, today)
}

/** The key of the row of the week that `today` falls in. */
const currentWeek = (userId: string, today: string) => ({
  userId_weekStart: { userId, weekStart: mondayOf(today) },
})

/**
 * `GET /api/today` slot `brief` (design 7.6): the stored brief of the server's current week, in the
 * shape `GET /api/briefs` serves it, or null when the week has none. It reads and never composes:
 * the weekly job writes the row on Monday and the brief page's `GET /api/brief` builds a
 * provisional one, so Today never waits for a brief. When the week turns, the slot is null until
 * one of those writes the new week's row. The row is in a table the data version does not cover,
 * so `briefStamp` follows it in the page's tag (`today.ts`).
 */
export async function todayBriefSlot(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<BriefListItem | null> {
  const row = await deps.prisma.weeklyBrief.findUnique({
    where: currentWeek(args.userId, args.today),
  })
  return row === null ? null : ((await listItems(deps, [row], args.today))[0] ?? null)
}

/**
 * What moves the page's tag for the brief slot: the current week's row. Every write sets
 * `generatedAt`, and the job's brief differs from a provisional one in the other two columns, so a
 * rewrite changes the stamp. What the item takes from the revision (seen, undone) is state, which
 * the data version already covers. One indexed row.
 */
export async function briefStamp(args: {
  deps: Deps
  userId: string
  today: string
}): Promise<string> {
  const row = await args.deps.prisma.weeklyBrief.findUnique({
    where: currentWeek(args.userId, args.today),
    select: { id: true, generatedAt: true, provisional: true, revisionId: true },
  })
  if (row === null) return 'brief:none'
  const kind = row.provisional ? 'provisional' : 'weekly'
  return `brief:${row.id}:${String(row.generatedAt.getTime())}:${kind}:${row.revisionId ?? 'none'}`
}

/**
 * `POST /api/briefs/:weekStart/seen`: stamps `seenAt` on the revision the brief describes and on
 * the revisions listed under "Since this brief", so the "New" markers go. Idempotent: a revision
 * already stamped is not written again, and a call with nothing to stamp writes nothing (and so
 * raises no data version). 404 for a week without a brief.
 */
export async function markBriefSeen(
  deps: Deps,
  args: { userId: string; weekStart: string },
): Promise<void> {
  const { prisma } = deps
  const row = await prisma.weeklyBrief.findUnique({
    where: { userId_weekStart: { userId: args.userId, weekStart: args.weekStart } },
  })
  if (row === null) throw notFound('There is no brief for that week.')
  const later = await sinceRows(deps, args.userId, row)
  const ids = [...(row.revisionId === null ? [] : [row.revisionId]), ...later.map((r) => r.id)]
  if (ids.length === 0) return
  const unseen = await prisma.planRevision.findMany({
    where: { id: { in: ids }, plan: { userId: args.userId }, seenAt: null },
    select: { id: true },
  })
  if (unseen.length === 0) return
  // The filter keeps the first stamp when two calls race.
  await prisma.planRevision.updateMany({
    where: { id: { in: unseen.map((revision) => revision.id) }, seenAt: null },
    data: { seenAt: new Date() },
  })
}

// ---------------------------------------------------------------------------------------------
// Why
// ---------------------------------------------------------------------------------------------

/**
 * The figures behind what a brief says the plan noticed, as Explain reads them (`subject=brief`):
 * the facts stored with the brief, grouped by the rule they feed, `frozen` because they are the ones
 * written with it. 404 for a week without a brief or another user's.
 */
export async function explainBrief(
  deps: Deps,
  args: { userId: string; weekStart: string },
): Promise<ExplainView> {
  const row = await deps.prisma.weeklyBrief.findUnique({
    where: { userId_weekStart: { userId: args.userId, weekStart: args.weekStart } },
  })
  const facts = row === null ? null : readFacts(row.facts)
  if (facts === null) throw notFound('There is no brief for that week.')
  const groups: ExplainGroup[] = []
  for (const fact of facts.noticed) {
    const group = groups.find((candidate) => candidate.rule === fact.rule)
    if (group) group.facts.push(fact)
    else groups.push({ rule: fact.rule, facts: [fact] })
  }
  return {
    subject: 'brief',
    asOf: facts.asOf,
    frozen: true,
    rules: groups.map((group) => group.rule),
    groups,
    rest: [],
  }
}
