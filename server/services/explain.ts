// "From your numbers" for the Why drawer (phase 3a design 8.4): the figures the engine read for a
// subject, built from the athlete snapshot. The snapshot (`loadAthleteContext`) is the only source
// of the runner's data; the three values that need more than it (the heart-rate model, the weekly
// decision and the race prediction) are computed once per data version (`memoByVersion`), so two
// requests on one version fit the model once. No other history or plan query runs: the one read
// beyond the snapshot is the stored assessments of the week a decision is about, which sit on the
// session rows and are not part of the snapshot.
import { todayIso } from '../../shared/dates.ts'
import { weeklyDecision } from '../../shared/engine/adapt.ts'
import {
  explainInputs,
  explainNeeds,
  explainRules,
  explainWeeks,
  type ExplainContext,
} from '../../shared/engine/explainInputs.ts'
import { fitHrModel } from '../../shared/engine/execution.ts'
import { weeklyRamp } from '../../shared/engine/limits.ts'
import type { EngineInput, ExplainRequest, ExplainView } from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'
import { notFound } from '../errors.ts'
import {
  loadAthleteContext,
  memoByVersion,
  neutralGoal,
  type AthleteContext,
} from './athleteState.ts'
import { executionRecordsByWeek } from './planEngine.ts'

/** The engine's view of the snapshot: the athlete's own data and the stored plan, with no goal. */
function engineInputOf(context: AthleteContext): EngineInput {
  return {
    today: context.asOf,
    profile: context.profile,
    activities: context.activities,
    wellness: context.wellness,
    reviews: context.reviews,
    goal: neutralGoal(context.asOf),
    forecast: null,
    existing: context.existing(),
    options: {},
    screeningFlags: context.screeningFlags,
    zoneChanges: context.zoneChanges,
  }
}

type Goal = NonNullable<ExplainContext['goal']>

/** The goal the prediction rules are about: the requested one, else the one the runner follows. */
function goalFor(context: AthleteContext, request: ExplainRequest): Goal | null {
  const goal =
    request.subject === 'prediction'
      ? (context.goals.find((candidate) => candidate.id === request.goalId) ?? null)
      : context.goal
  if (request.subject === 'prediction' && goal === null) throw notFound('Goal not found.')
  return goal === null
    ? null
    : { id: goal.id, distanceM: goal.distanceM, gainM: goal.gainM, surface: goal.surface }
}

const NOT_FOUND: Record<ExplainRequest['subject'], string> = {
  session: 'That session is not in your current plan.',
  week: 'That week is not in your current plan.',
  decision: 'That week is not in your current plan.',
  readiness: 'Not found.',
  zone: 'Not found.',
  prediction: 'Goal not found.',
  rules: 'Not found.',
  // Their figures are stored with the brief and with the run's insights (E4-5, E4-7).
  brief: 'Explanations for briefs are not available yet.',
  activity: 'Explanations for runs are not available yet.',
}

/**
 * The figures behind one Explain request. Throws 404 for a session or week outside the user's
 * current plan, a goal that is not theirs, and a subject whose figures are stored with it.
 */
export async function explainView(
  deps: Deps,
  args: { userId: string; request: ExplainRequest; today?: string },
): Promise<ExplainView> {
  const { userId, request } = args
  const today = args.today ?? todayIso()
  const context = await loadAthleteContext(deps, { userId, today })
  const input = engineInputOf(context)
  const goal = goalFor(context, request)
  const shell: ExplainContext = {
    asOf: today,
    input,
    state: context.state,
    zones: context.zones,
    readiness: context.readiness,
    goal,
    prediction: null,
    hrModel: null,
    decision: null,
  }
  const rules = explainRules(request, shell)
  if (rules === null) throw notFound(NOT_FOUND[request.subject])
  const needs = explainNeeds(rules)
  const { last } = explainWeeks(request, shell)
  const memo = { userId, today }

  return memoByVersion(deps, { ...memo, name: `explain:${JSON.stringify(request)}` }, async () => {
    const hrModel = needs.hrModel
      ? await memoByVersion(deps, { ...memo, name: 'explain:hr-model' }, () =>
          fitHrModel(context.activities, today),
        )
      : null

    // A decision exists only for a week the stored plan covers, as `weeklyDecisions` has it.
    const planId = context.plan?.id ?? null
    const covered = input.existing?.weeks.some((week) => week.weekStart === last) ?? false
    const decision =
      needs.decision && planId !== null && covered
        ? await memoByVersion(deps, { ...memo, name: `explain:decision:${last}` }, async () => {
            const executions =
              (await executionRecordsByWeek(deps.prisma, planId, [last])).get(last) ?? []
            return weeklyDecision(input, last, {
              executions,
              redsFlags: input.screeningFlags,
              ramp: weeklyRamp(context.state),
            })
          })
        : null

    // Built once per picture by the snapshot; null without a goal, a distance or a usable source.
    const prediction = needs.prediction && goal !== null ? await context.prediction(goal.id) : null

    return explainInputs(request, { ...shell, hrModel, decision, prediction })
  })
}
