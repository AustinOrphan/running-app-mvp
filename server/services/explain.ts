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
import { weeklyRamp } from '../../shared/engine/limits.ts'
import { rebuildZone } from '../../shared/engine/loadSetting.ts'
import type {
  EngineInput,
  ExplainRequest,
  ExplainView,
  StrengthContext,
} from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'
import { notFound } from '../errors.ts'
import {
  goalModelFor,
  hrModelOf,
  loadAthleteContext,
  memoByVersion,
  type AthleteContext,
} from './athleteState.ts'
import { explainBrief } from './brief.ts'
import { inputFromContext } from './engineInput.ts'
import { explainActivity } from './insight.ts'
import { executionRecordsByWeek } from './planEngine.ts'
import { loadStrengthContext } from './strength.ts'

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
  // A brief is answered from the figures stored with it, before this table is read.
  brief: 'There is no brief for that week.',
  // A run is answered from its stored insight, before this table is read.
  activity: 'Activity not found.',
  strength: 'That strength session or exercise is not in your current plan.',
}

/**
 * The figures behind one Explain request. Throws 404 for a session or week outside the user's
 * current plan, a goal that is not theirs, a run that is not theirs, and a week without a brief.
 */
export async function explainView(
  deps: Deps,
  args: { userId: string; request: ExplainRequest; today?: string },
): Promise<ExplainView> {
  const { userId, request } = args
  // A run's figures are the ones stored with its insight (E4-7), not read again from the snapshot.
  if (request.subject === 'activity') {
    return explainActivity(deps, { userId, activityId: request.id })
  }
  // A brief's figures are the ones stored with it (E4-5): read from its row, never memoised by the
  // data version, since a brief is a non-state table and a stored fact does not change.
  if (request.subject === 'brief') {
    return explainBrief(deps, { userId, weekStart: request.weekStart })
  }
  const today = args.today ?? todayIso()
  const context = await loadAthleteContext(deps, { userId, today })
  // The athlete's data and the stored plan, rest windows included, with the neutral goal the
  // reads about the athlete use. The weekly decision is made from the plan's own goal below.
  const input = inputFromContext(context, { existing: true, options: context.planOptions })
  const goal = goalFor(context, request)
  // A strength request is checked against the session's lifts, so the strength input comes first;
  // any other request that reads it (the session of a strength session) takes it below.
  const requested: StrengthContext | null =
    request.subject === 'strength' ? await loadStrengthContext(deps, { userId, today }) : null
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
    race: null,
    strength: requested,
  }
  const rules = explainRules(request, shell)
  if (rules === null) throw notFound(NOT_FOUND[request.subject])
  const needs = explainNeeds(rules)
  const { last } = explainWeeks(request, shell)
  const memo = { userId, today }

  return memoByVersion(deps, { ...memo, name: `explain:${JSON.stringify(request)}` }, async () => {
    const hrModel = needs.hrModel ? await hrModelOf(deps, context) : null

    // A decision exists only for a week the stored plan covers, as `weeklyDecisions` has it.
    const plan = context.plan
    const covered = input.existing?.weeks.some((week) => week.weekStart === last) ?? false
    // The input with the plan's own goal, which the weekly decision and the load setting read: the
    // goal race's own post-race window sets the weeks after it and decides whether a past race
    // holds the setting at steady, so a read about the athlete would use the neutral goal and
    // could differ from the Plan page (`loadPlanWithSessions`) and the stored plan.
    const planInputFor = async (goalId: string): Promise<EngineInput> =>
      inputFromContext(context, {
        goal: await goalModelFor(context, goalId, { climate: false }),
        existing: true,
        options: context.planOptions,
      })
    const planInput = needs.planInput && plan !== null ? await planInputFor(plan.goalId) : null
    const decision =
      needs.decision && plan !== null && covered
        ? await memoByVersion(deps, { ...memo, name: `explain:decision:${last}` }, async () => {
            const executions =
              (await executionRecordsByWeek(deps.prisma, plan.id, [last])).get(last) ?? []
            const decisionInput = planInput ?? (await planInputFor(plan.goalId))
            return weeklyDecision(decisionInput, last, {
              executions,
              redsFlags: input.screeningFlags,
              ramp: weeklyRamp(context.state),
              rebuild: rebuildZone(decisionInput, context.state),
            })
          })
        : null

    // Built once per picture by the snapshot; null without a goal, a distance or a usable source.
    const prediction = needs.prediction && goal !== null ? await context.prediction(goal.id) : null

    // The goal as the engine models it, race-day climate included: read from the snapshot's goal
    // and the cached climate (never fetched), as the prediction above is.
    const race =
      needs.race && goal !== null ? await goalModelFor(context, goal.id, { climate: true }) : null

    // The state of the logs, the setup and the plan's weeks, with the readiness read of today.
    const strength =
      requested ?? (needs.strength ? await loadStrengthContext(deps, { userId, today }) : null)

    return explainInputs(request, {
      ...shell,
      hrModel,
      decision,
      prediction,
      race,
      planInput,
      strength,
    })
  })
}
