// Rest and limited-running windows on the server (phase 3a design 9.3 and 9.4, rule J9).
//
// A window is engine input that the runner reports: a dated period of rest, easy running or capped
// runs. It is written only by a plan action (`planActions.ts`), because a window is a revision:
// the window row, the past sessions it skips and the re-plan it causes are one transaction and one
// `PlanRevision` with `disruptionId`, so it can be previewed before it is applied and undone after.
//
// - `planWindowAction` decides an action (create, update or remove a window) and writes nothing:
//   it validates the body, builds the hypothetical window set and asks `computeReplan` for the
//   re-plan with it. A preview and a commit both start here, so they cannot disagree.
// - `windowRunner` is the write of the window row inside the commit's transaction.
// - `disruptionViews` and `listDisruptions` say where each window stands, from the engine.
// - `disruptionSlot` and `todayDisruptions` are the Today parts.
import { addDays } from '../../shared/dates.ts'
import { bandWindows } from '../../shared/domain/windowDay.ts'
import {
  describeIssue,
  windowHoldLabel,
  windowRevisionSummary,
  type WindowChangeKind,
} from '../../shared/copy/revision.ts'
import {
  disruptionPlan,
  disruptionWeekCap,
  holdReference,
  validateDisruption,
  windowPhase,
  type DisruptionDraft,
  type DisruptionPlan,
  type WindowPlan,
} from '../../shared/engine/disruption.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { AthleteState, DisruptionWindow, EngineInput } from '../../shared/engine/types.ts'
import type {
  Disruption,
  DisruptionInput,
  DisruptionSlot,
  DisruptionView,
  PlanAction,
  Units,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { Disruption as DisruptionRow } from '../db.ts'
import { notFound, validationError } from '../errors.ts'
import { toDisruption } from '../serialize.ts'
import {
  disruptionHorizonDays,
  loadAthleteContext,
  toEngineWindow,
  type AthleteContext,
} from './athleteState.ts'
import {
  changedColumns,
  computeReplan,
  disruptionHash,
  DISRUPTION_COLUMNS,
  StaleWrite,
  type ApplyOptions,
  type ReplanResult,
  type WindowWrite,
} from './replan.ts'

/**
 * The id the engine gives a window that is not stored yet. A preview and its commit decide with
 * the same id, so the two cannot differ by a tie between windows (the engine breaks a tie on the
 * start day by id); it sorts after every stored id, as the id a new row gets would.
 */
export const NEW_WINDOW_ID = '~new'

export type DisruptionAction = Extract<
  PlanAction,
  { type: 'disruption-create' | 'disruption-update' | 'disruption-remove' }
>

export function isDisruptionAction(action: PlanAction): action is DisruptionAction {
  return action.type.startsWith('disruption-')
}

// ---------------------------------------------------------------------------------------------
// Where each window stands
// ---------------------------------------------------------------------------------------------

/** The weeks the engine counts a runner's volume by, as `holdReference` reads them. */
type StateWeeks = Pick<AthleteState, 'weeks'>

/** The most the return week may hold after this window's hold, or null when no restart applies. */
function returnWeekMin(
  plan: DisruptionPlan,
  window: WindowPlan,
  volumeOf: (weekStart: string) => number | undefined,
): number | null {
  const restart = window.restart
  if (restart === null || restart.fraction >= 1) return null
  const hold = plan.holds.find((run) => run.windowIds.includes(window.id))
  if (hold === undefined) return null
  const reference = holdReference(hold, volumeOf)
  if (!(reference > 0)) return null
  // The week's own minutes are not known here, so the cap is the share of the reference week alone.
  const cap = disruptionWeekCap(plan, restart.returnWeekStart, {
    referenceMin: reference,
    baselineMin: Number.MAX_SAFE_INTEGER,
  })
  return cap?.capMin ?? null
}

/**
 * The windows as the API serves them, with where `date` lies against each (`windowPhase`), the
 * first day running and hard sessions are allowed again, and the cap of the return week. The
 * engine reads every active window together, so overlapping windows are one layoff. A withdrawn
 * window is `done`: it holds nothing.
 */
export function disruptionViews(
  rows: readonly Disruption[],
  args: { date: string; state: StateWeeks },
): DisruptionView[] {
  const active = rows.filter((row) => row.status === 'active')
  const plan = disruptionPlan(active.map(toEngineWindow))
  const volume = new Map(args.state.weeks.map((week) => [week.weekStart, week.runMin]))
  const volumeOf = (weekStart: string) => volume.get(weekStart)
  return rows.map((row): DisruptionView => {
    const window =
      row.status === 'active'
        ? plan.windows.find((candidate) => candidate.id === row.id)
        : undefined
    if (window === undefined) {
      const alone = disruptionPlan([toEngineWindow(row)]).windows[0]
      return {
        ...row,
        phase: 'done',
        runFrom: alone?.runFrom ?? addDays(row.endDate, 1),
        qualityFrom: alone?.qualityFrom ?? addDays(row.endDate, 1),
        returnWeekMin: null,
      }
    }
    return {
      ...row,
      phase: windowPhase(window, args.date),
      runFrom: window.runFrom,
      qualityFrom: window.qualityFrom,
      returnWeekMin: returnWeekMin(plan, window, volumeOf),
    }
  })
}

/**
 * The windows that are not over on `date`, for Today and the plan banner. The snapshot holds the
 * active windows within `disruptionHorizonDays`, so a window that ended long ago is not read.
 */
export function todayDisruptions(context: AthleteContext, date: string): DisruptionView[] {
  return disruptionViews(context.disruptions, { date, state: context.state }).filter(
    (view) => view.phase !== 'done',
  )
}

/**
 * The Today slot of the disruption band (design 9.6): every window open on the viewed day (an
 * illness and an injury are separate windows with their own dates, and the band gives each a line),
 * else the next one ahead; with none, an offer when today's check-in reports illness or pain at or
 * above `pain.flagScore`. The offer creates nothing by itself, and a day ahead has none.
 */
export function disruptionSlot(args: {
  context: AthleteContext
  date: string
  preview: boolean
}): DisruptionSlot | null {
  const { context, date, preview } = args
  const windows = bandWindows(todayDisruptions(context, date))
  const checkin = context.wellness.find((day) => day.date === context.asOf)
  const reports =
    checkin !== undefined &&
    (checkin.illness === true ||
      (checkin.painScore != null && checkin.painScore >= P.pain.flagScore.value))
  const offer = windows.length === 0 && !preview && reports
  return windows.length === 0 && !offer ? null : { windows, offer }
}

/**
 * The user's windows: the ones not over on `date` (a day when omitted is today), or every window
 * ever reported with `includeAll`, oldest first. Phases are for `date`.
 */
export async function listDisruptions(
  deps: Deps,
  args: { userId: string; today: string; date?: string; includeAll?: boolean },
): Promise<DisruptionView[]> {
  const { userId, today } = args
  const date = args.date ?? today
  const rows = await deps.prisma.disruption.findMany({
    where: {
      userId,
      ...(args.includeAll
        ? {}
        : { status: 'active', endDate: { gte: addDays(date, -disruptionHorizonDays()) } }),
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  const { state } = await loadAthleteContext(deps, { userId, today })
  const views = disruptionViews(rows.map(toDisruption), { date, state })
  return args.includeAll ? views : views.filter((view) => view.phase !== 'done')
}

/** One of the user's windows as the API serves it, for the phase of `date`. */
export async function viewDisruption(
  deps: Deps,
  args: { userId: string; id: string; today: string; date?: string },
): Promise<DisruptionView> {
  const rows = await deps.prisma.disruption.findMany({
    where: { userId: args.userId, status: 'active' },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  const own = await deps.prisma.disruption.findFirst({
    where: { id: args.id, userId: args.userId },
  })
  if (own === null) throw notFound('Window not found.')
  const { state } = await loadAthleteContext(deps, { userId: args.userId, today: args.today })
  // The window is read with the active ones, so overlapping windows give its true return week.
  const together = rows.some((row) => row.id === own.id) ? rows : [...rows, own]
  const views = disruptionViews(together.map(toDisruption), {
    date: args.date ?? args.today,
    state,
  })
  return views.find((view) => view.id === own.id)!
}

// ---------------------------------------------------------------------------------------------
// Deciding an action
// ---------------------------------------------------------------------------------------------

/** What an action does to the window table, decided from the stored row. */
export type WindowStep =
  | { kind: 'create'; userId: string; data: NewWindow }
  | { kind: 'update'; userId: string; before: DisruptionRow; data: WindowEnd }
  | { kind: 'remove'; userId: string; before: DisruptionRow }

/** The columns of a new window. */
export interface NewWindow {
  reason: Disruption['reason']
  mode: Disruption['mode']
  startDate: string
  endDate: string
  maxRunMin: number | null
  area: string | null
  pain: number | null
  gaitChange: boolean
  note: string | null
}

/** The columns a window can be changed in: how long it lasts and how far a run may go. */
export interface WindowEnd {
  endDate: string
  maxRunMin: number | null
}

/** A window action decided and not written. */
export interface WindowPlanned {
  planId: string
  step: WindowStep
  result: ReplanResult
}

function trimmed(text: string | null | undefined): string | null {
  const value = text?.trim() ?? ''
  return value === '' ? null : value
}

/** A reported window as it is stored: values that only another reason or mode takes are dropped. */
function newWindow(input: DisruptionInput): NewWindow {
  const niggle = input.reason === 'niggle'
  return {
    reason: input.reason,
    mode: input.mode,
    startDate: input.startDate,
    endDate: input.endDate,
    maxRunMin: input.mode === 'limited' ? (input.maxRunMin ?? null) : null,
    area: niggle ? trimmed(input.area) : null,
    pain: niggle ? (input.pain ?? null) : null,
    gaitChange: niggle ? input.gaitChange === true : false,
    note: trimmed(input.note),
  }
}

function engineWindow(id: string, data: Omit<NewWindow, 'area' | 'note'>): DisruptionWindow {
  return {
    id,
    reason: data.reason,
    mode: data.mode,
    startDate: data.startDate,
    endDate: data.endDate,
    maxRunMin: data.maxRunMin,
    pain: data.pain,
    gaitChange: data.gaitChange,
  }
}

/** Throws the 400 of the window rules, one issue for each refused field, in the runner's units. */
function assertValid(
  draft: DisruptionDraft,
  context: { today: string; goalDate: string | null; units: Units },
  options: { startFixed?: boolean } = {},
): void {
  const issues = validateDisruption(draft, context).filter(
    // the first day of a window that exists is not edited, so its age is not asked again
    (issue) => !(options.startFixed && issue.code === 'start-too-old'),
  )
  if (issues.length === 0) return
  throw validationError(
    'Some fields need attention.',
    issues.map((issue) => ({ path: issue.field, message: describeIssue(issue, context.units) })),
  )
}

function holdOf(
  window: Pick<NewWindow, 'reason' | 'mode' | 'startDate' | 'endDate' | 'maxRunMin'>,
  id: string | null,
) {
  return {
    from: window.startDate,
    to: window.endDate,
    label: windowHoldLabel(window),
    disruptionId: id,
  }
}

/** The windows with `id` replaced by `window` (or left out), as the engine reads them. */
function withWindow(input: EngineInput, id: string, window: DisruptionWindow | null): EngineInput {
  const { disruptions: current, ...rest } = input
  const windows = [
    ...(current ?? []).filter((candidate) => candidate.id !== id),
    ...(window === null ? [] : [window]),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  return windows.length === 0 ? rest : { ...rest, disruptions: windows }
}

/**
 * Decides a window action from the data as it is and writes nothing: validates the body (400 with
 * a path for each refused field), finds the window (404), builds the hypothetical window set and
 * re-plans with it. The re-plan skips the past sessions the windows cover and carries the window in
 * its diff, so the preview shows what the commit will write.
 */
export async function planWindowAction(
  deps: Deps,
  args: { userId: string; action: DisruptionAction; today: string },
): Promise<WindowPlanned> {
  const { prisma } = deps
  const { userId, today, action } = args
  const [plan, user] = await Promise.all([
    prisma.plan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, goal: { select: { targetDate: true } } },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { units: true } }),
  ])
  if (!plan) throw notFound('There is no active plan to re-plan.')
  const units: Units = user?.units === 'km' ? 'km' : 'mi'
  const context = { today, goalDate: plan.goal.targetDate, units }

  let step: WindowStep
  let transform: (input: EngineInput) => EngineInput
  let kind: WindowChangeKind
  let shown: Pick<NewWindow, 'reason' | 'mode' | 'startDate' | 'endDate' | 'maxRunMin'>
  let shownId: string | null

  if (action.type === 'disruption-create') {
    // The body is judged as it was sent: a cap on a rest window or an area on an illness is a
    // refusal, not something to drop quietly.
    assertValid(action, context)
    const data = newWindow(action)
    step = { kind: 'create', userId, data }
    transform = (input) => withWindow(input, NEW_WINDOW_ID, engineWindow(NEW_WINDOW_ID, data))
    kind = 'created'
    shown = data
    shownId = null
  } else {
    const before = await prisma.disruption.findFirst({
      where: { id: action.id, userId, status: 'active' },
    })
    if (before === null) throw notFound('Window not found.')
    shown = before as typeof shown
    shownId = before.id
    if (action.type === 'disruption-update') {
      const data: WindowEnd = {
        endDate: action.endDate ?? before.endDate,
        maxRunMin: action.maxRunMin === undefined ? before.maxRunMin : action.maxRunMin,
      }
      assertValid({ ...toDisruption(before), ...data }, context, { startFixed: true })
      step = { kind: 'update', userId, before, data }
      const changed = { ...toEngineWindow(toDisruption(before)), ...data }
      transform = (input) => withWindow(input, before.id, changed)
      kind = 'updated'
      shown = { ...shown, ...data }
    } else {
      step = { kind: 'remove', userId, before }
      transform = (input) => withWindow(input, before.id, null)
      kind = 'removed'
    }
  }

  const result = await computeReplan(deps, {
    userId,
    reason: 'disruption',
    today,
    transform,
    window: {
      hold: holdOf(shown, shownId),
      summary: windowRevisionSummary(kind, shown),
    },
  })
  return { planId: result.planId, step, result }
}

// ---------------------------------------------------------------------------------------------
// Writing the window
// ---------------------------------------------------------------------------------------------

/**
 * The write of the window row, run first inside the commit's transaction. An update or a removal
 * checks that the row is still as it was decided on (`StaleWrite` otherwise), and every write
 * returns the part of the undo payload that restores it.
 */
export function windowRunner(step: WindowStep): NonNullable<ApplyOptions['window']> {
  return async (tx): Promise<WindowWrite> => {
    if (step.kind === 'create') {
      const row = await tx.disruption.create({ data: { ...step.data, userId: step.userId } })
      return {
        disruptionId: row.id,
        undo: { created: [{ id: row.id, hash: disruptionHash(row) }], updated: [] },
      }
    }
    const now = await tx.disruption.findFirst({
      where: { id: step.before.id, userId: step.userId, status: 'active' },
    })
    if (now === null || disruptionHash(now) !== disruptionHash(step.before)) throw new StaleWrite()
    const after = await tx.disruption.update({
      where: { id: now.id },
      data: step.kind === 'update' ? step.data : { status: 'undone' },
    })
    return {
      disruptionId: after.id,
      undo: {
        created: [],
        updated: [
          {
            id: after.id,
            before: changedColumns(now, after, DISRUPTION_COLUMNS),
            hash: disruptionHash(after),
          },
        ],
      },
    }
  }
}
