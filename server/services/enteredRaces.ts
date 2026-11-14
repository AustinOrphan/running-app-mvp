// The re-plan that follows a change to a race the runner entered before the goal race [rules K6,
// H12, task SR1]. A goal write that adds, moves, changes or removes such a race re-plans the active
// plan through `computeReplan` and `applyReplan` (ADR 0007), as one revision with reason
// `races-changed`, so the plan holds the race session, the easing and the recovery, or gives them
// back. The goal write stands whether or not the re-plan does: a plan that cannot be re-planned now
// (a checklist it fails, a goal that has passed) stays as it is and the weekly update draws it again.
import type { RaceChangeLine } from '../../shared/copy/revision.ts'
import type { Goal } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { replanActivePlan } from './replan.ts'
import { safeMessage } from './syncLog.ts'

/**
 * The fields of a goal the plan reads for an entered race: its date, priority and status, the
 * distance, climb and target that set its length, and the name its session carries.
 */
const PLAN_FIELDS = [
  'name',
  'priority',
  'status',
  'targetDate',
  'distanceM',
  'gainM',
  'lossM',
  'goalType',
  'targetTimeSec',
  'surface',
  'startTime',
] as const satisfies ReadonlyArray<keyof Goal>

/**
 * True when the plan of `planGoal` is drawn around `goal`: priority B or C, status `target`, a
 * distance, and a date after today and before the plan's goal race. An A-priority goal other than
 * the plan's own is not read (one A goal).
 */
export function isEnteredRace(
  goal: Goal,
  planGoal: { id: string; targetDate: string },
  today: string,
): boolean {
  return (
    goal.id !== planGoal.id &&
    goal.status === 'target' &&
    (goal.priority === 'B' || goal.priority === 'C') &&
    goal.distanceM !== null &&
    goal.targetDate > today &&
    goal.targetDate < planGoal.targetDate
  )
}

/** How the change reads in the revision's summary; null when the plan has no reason to move. */
export function raceChange(
  before: Goal | null,
  after: Goal | null,
  planGoal: { id: string; targetDate: string },
  today: string,
): RaceChangeLine | null {
  const was = before !== null && isEnteredRace(before, planGoal, today)
  const is = after !== null && isEnteredRace(after, planGoal, today)
  if (!was && !is) return null
  if (was && !is) return { kind: 'removed', name: before.name }
  if (!was && is) return { kind: 'added', name: after.name, date: after.targetDate }
  if (PLAN_FIELDS.every((field) => before![field] === after![field])) return null
  return {
    kind: before!.targetDate === after!.targetDate ? 'changed' : 'moved',
    name: after!.name,
    date: after!.targetDate,
  }
}

/**
 * Re-plans the user's active plan after a goal write, when the write changed a race the plan is
 * drawn around. `before` is the goal as it was (null for a new goal) and `after` as it is (null for
 * a deleted one). Does nothing without an active plan or when the change does not touch an entered
 * race. Returns whether a revision was written.
 */
export async function replanAfterGoalWrite(
  deps: Deps,
  args: { userId: string; today: string; before: Goal | null; after: Goal | null },
): Promise<boolean> {
  const { userId, today } = args
  const plan = await deps.prisma.plan.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    select: { generatorVersion: true, goal: { select: { id: true, targetDate: true } } },
  })
  if (plan === null || plan.generatorVersion < 2) return false
  const race = raceChange(args.before, args.after, plan.goal, today)
  if (race === null) return false
  try {
    await replanActivePlan(deps, { userId, reason: 'races-changed', today, race })
    return true
  } catch (error) {
    createLogger(deps.config).warn(
      { reason: safeMessage(error), userId },
      'the re-plan after a change to an entered race failed',
    )
    return false
  }
}
