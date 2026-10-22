import { daysBetween, mondayOf } from '../../shared/dates.ts'
import { distanceClassOf, generatePlan, GENERATOR_VERSION } from '../../shared/domain/plan.ts'
import type { PlanWithWeeks } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { notFound, validationError } from '../errors.ts'
import { toPlan, toPlanWeek } from '../serialize.ts'
import { computeBaselineRunMin } from './baseline.ts'

export const MAX_PLAN_WEEKS = 156

export interface GeneratePlanForGoalInput {
  userId: string
  goalId: string
  baselineRunMin?: number
  startDate?: string
  strengthPreference?: 0 | 1 | 2
  today: string
}

/**
 * Builds a plan for one of the caller's goals. The previous active plan is archived and the new
 * one created in a single transaction, so there is never more than one active plan. The reads
 * that decide the inputs (goal, baseline) run before that transaction.
 */
export async function generatePlanForGoal(
  deps: Deps,
  input: GeneratePlanForGoalInput,
): Promise<PlanWithWeeks> {
  const { prisma } = deps
  const goal = await prisma.goal.findFirst({ where: { id: input.goalId, userId: input.userId } })
  if (!goal) throw notFound('Goal not found.')
  if (goal.distanceM === null) {
    throw validationError('Add a distance to this goal before generating a plan.')
  }
  if (goal.status !== 'target' && goal.status !== 'considering') {
    throw validationError(
      'Plans can only be generated for goals that are a target or being considered.',
    )
  }
  if (goal.targetDate < input.today) {
    throw validationError('This goal date has passed. Move the date before generating a plan.')
  }

  const startMonday = mondayOf(input.startDate ?? input.today)
  const raceMonday = mondayOf(goal.targetDate)
  if (raceMonday < startMonday) {
    throw validationError('The plan cannot start after the race week.')
  }
  const weekCount = daysBetween(startMonday, raceMonday) / 7 + 1
  if (weekCount > MAX_PLAN_WEEKS) {
    throw validationError(
      `A plan covers at most ${MAX_PLAN_WEEKS} weeks. Choose a later start date.`,
    )
  }

  const baselineRunMin =
    input.baselineRunMin ?? (await computeBaselineRunMin(prisma, input.userId, input.today))
  if (baselineRunMin === null) {
    throw validationError('Enter a weekly run-minutes baseline: no recent runs were found.')
  }

  const weeks = generatePlan({
    startDate: startMonday,
    raceDate: goal.targetDate,
    distanceClass: distanceClassOf(goal.distanceM),
    baselineRunMin,
    strengthPreference: input.strengthPreference ?? 2,
  })

  const created = await prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({
      where: { userId: input.userId, status: 'active' },
      data: { status: 'archived' },
    })
    return tx.plan.create({
      data: {
        userId: input.userId,
        goalId: goal.id,
        name: goal.name,
        startDate: startMonday,
        raceWeekStart: raceMonday,
        status: 'active',
        generatorVersion: GENERATOR_VERSION,
        weeks: {
          create: weeks.map((week) => ({
            weekStart: week.weekStart,
            index: week.index,
            phase: week.phase,
            focus: week.focus,
            baselineRunMin: week.baselineRunMin,
            targetRunMin: week.baselineRunMin,
            targetSource: 'baseline',
            longRunMin: week.longRunMin,
            day2Min: week.day2Min,
            runDays: week.runDays,
            strengthSessions: week.strengthSessions,
            overrideNote: null,
          })),
        },
      },
      include: { weeks: { orderBy: { index: 'asc' } } },
    })
  })

  return { ...toPlan(created), weeks: created.weeks.map(toPlanWeek) }
}
