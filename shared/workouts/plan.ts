// A session as a workout [design 6.5, rule O1]: the engine's steps become repeats and steps with a
// target each, and a plain-text outline whose numbers are the numbers of the steps. Pure and
// deterministic. Targets are never derived here: `resolveTargets` (design 4.6) supplies the
// ceiling, band and pace, and this module only chooses which step carries which.
import { formatQuantity, formatRange } from '../copy/quantity.ts'
import { render } from '../copy/template.ts'
import { WORKOUT_TEMPLATES } from '../copy/workouts.ts'
import { P } from '../engine/params/index.ts'
import { isLadderSession } from '../engine/startWeeks.ts'
import type { ResolvedTargets, SessionKind, SessionSpec, Step } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { publicTitle, publishable } from './labels.ts'
import type { StepTarget, WorkoutNode, WorkoutOptions, WorkoutPlan, WorkoutStep } from './types.ts'

/** The part of a session a workout is built from. */
export type WorkoutSource = Pick<SessionSpec, 'kind' | 'durationMin' | 'structure' | 'flags'>

/** Kinds whose work is a block of its own; a session of these with no structure is one work step. */
const WORK_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])

/** The line of an eased day, the same on every surface; the reason is never named. */
export function easedLine(units: Units): string {
  return render(WORKOUT_TEMPLATES['workout.eased'], {}, units)
}

interface Context {
  session: WorkoutSource
  targets: ResolvedTargets
  /** A run-walk ladder session: its breaks and the two framing steps are walks, not runs. */
  walking: boolean
  units: Units
}

const isWalk = (step: Step, ctx: Context): boolean =>
  ctx.walking && (step.kind === 'recover' || step.kind === 'warmup' || step.kind === 'cooldown')

type StepName = Extract<keyof typeof WORKOUT_TEMPLATES, `workout.step.${string}`>

/** The template of a step's name: which word a step takes is decided here, the words in the copy. */
function nameOf(step: Step, kind: SessionKind, walk: boolean): StepName {
  if (walk) return 'workout.step.walk'
  switch (step.kind) {
    case 'warmup':
      return 'workout.step.warm-up'
    case 'cooldown':
      return 'workout.step.cool-down'
    case 'recover':
      return 'workout.step.recover'
    case 'steady':
      return kind === 'hike' ? 'workout.step.hike' : 'workout.step.run'
    case 'work':
      if (step.zone === 'race-pace') return 'workout.step.race-pace'
      if (step.zone === 'strides') return 'workout.step.stride'
      if (kind === 'hills') return 'workout.step.hill'
      if (kind === 'intervals') return 'workout.step.fast'
      if (kind === 'threshold') return 'workout.step.threshold'
      return 'workout.step.run'
  }
}

/** A short name for a step; the same on every surface. */
const labelOf = (step: Step, walk: boolean, ctx: Context): string =>
  render(WORKOUT_TEMPLATES[nameOf(step, ctx.session.kind, walk)], {}, ctx.units)

/**
 * The target of one step, from the resolved targets of the session [rule O1]:
 *
 * - On a day steered by effort (heat) no step carries a figure.
 * - Only a step of the session's own zone and role carries one: the work of a quality session, the
 *   run of an easy one. Warm-ups, cool-downs, recoveries, walks, strides and the fast finish of a
 *   long run stay open; the resolver holds no figure for them.
 * - Quality work takes the pace band of the session; an easy, recovery, long, back-to-back or
 *   hike step takes the one heart-rate ceiling, written from the floor so the watch alerts only
 *   above it; a band stands in where there is no pace.
 * - A heart-rate target needs a step of `o1.hrTargetMinStepSec` or more: wrist heart rate lags a
 *   change of effort, so a short step would alert on a stale reading.
 */
function targetOf(step: Step, durationSec: number, walk: boolean, ctx: Context): StepTarget {
  const t = ctx.targets
  const own = (step.kind === 'work' || step.kind === 'steady') && step.zone === t.zone
  if (t.hot || walk || !own) return { kind: 'open' }
  if (t.mode === 'pace' && t.paceSecPerKm !== null) {
    return { kind: 'pace', slowSecPerKm: t.paceSecPerKm[0], fastSecPerKm: t.paceSecPerKm[1] }
  }
  if (durationSec >= P.o1.hrTargetMinStepSec.value) {
    if (t.hrCeiling !== null) {
      return { kind: 'hr-ceiling', floorBpm: P.o1.hrFloorBpm.value, ceilingBpm: t.hrCeiling }
    }
    if (t.mode === 'hr-band' && t.hrRange !== null) {
      return { kind: 'hr-band', lowBpm: t.hrRange[0], highBpm: t.hrRange[1] }
    }
  }
  return { kind: 'open' }
}

function toStep(step: Step, ctx: Context): WorkoutStep {
  const durationSec = Math.round(step.durationSec ?? 0)
  const walk = isWalk(step, ctx)
  return {
    type: 'step',
    intent: step.kind,
    label: labelOf(step, walk, ctx),
    walk,
    durationSec,
    target: targetOf(step, durationSec, walk, ctx),
  }
}

/** `count` rounds of the steps; a single round is the steps themselves. */
function rounds(count: number, steps: Step[], ctx: Context): WorkoutNode[] {
  const built = steps.map((step) => toStep(step, ctx))
  return count > 1 ? [{ type: 'repeat', count, steps: built }] : built
}

/**
 * The engine's steps as nodes. Work and recovery with equal reps repeat together; a session whose
 * recoveries number one fewer than its bouts (cruise intervals) repeats `bouts - 1` pairs and ends
 * on the last work step. The ladder's equal pairs are already merged by the engine.
 */
function toNodes(steps: Step[], ctx: Context): WorkoutNode[] {
  const list = steps.filter((step) => (step.durationSec ?? 0) > 0 && step.reps > 0)
  const nodes: WorkoutNode[] = []
  for (let i = 0; i < list.length; i += 1) {
    const step = list[i]!
    const next = list[i + 1]
    if (step.kind === 'work' && next?.kind === 'recover') {
      if (step.reps === next.reps) {
        nodes.push(...rounds(step.reps, [step, next], ctx))
        i += 1
        continue
      }
      if (step.reps === next.reps + 1) {
        nodes.push(...rounds(next.reps, [step, next], ctx), toStep({ ...step, reps: 1 }, ctx))
        i += 1
        continue
      }
    }
    nodes.push(...rounds(step.reps, [step], ctx))
  }
  return nodes
}

const stepsOf = (node: WorkoutNode): WorkoutStep[] => (node.type === 'step' ? [node] : node.steps)
const countOf = (node: WorkoutNode): number => (node.type === 'step' ? 1 : node.count)

function totalOf(nodes: WorkoutNode[]): number {
  return nodes.reduce(
    (sum, node) =>
      sum + countOf(node) * stepsOf(node).reduce((inner, step) => inner + step.durationSec, 0),
    0,
  )
}

/**
 * The engine floors the length of a bout or a rep to whole seconds and fits whole reps into the
 * minutes, so its steps can add up to a little less than the session. The rest goes to the end of
 * the last cool-down, so the workout lasts the planned minutes.
 */
function fillToMinutes(nodes: WorkoutNode[], missingSec: number): void {
  const last = nodes[nodes.length - 1]
  if (last?.type === 'step' && last.intent === 'cooldown') {
    last.durationSec += missingSec
    return
  }
  nodes.push({
    type: 'step',
    intent: 'cooldown',
    label: 'Cool down',
    walk: false,
    durationSec: missingSec,
    target: { kind: 'open' },
  })
}

/**
 * The words of a step's figure, "heart rate under 142 bpm" or "pace 4:10 to 4:00 /km"; null for an
 * open step. The description and the intervals.icu header both take it, so a figure is worded once.
 */
export function targetPhrase(target: StepTarget, units: Units): string | null {
  switch (target.kind) {
    case 'hr-ceiling':
      return render(
        WORKOUT_TEMPLATES['workout.target.hr-ceiling'],
        { limit: { kind: 'bpm', bpm: target.ceilingBpm } },
        units,
      )
    case 'hr-band':
      return render(
        WORKOUT_TEMPLATES['workout.target.hr-band'],
        {
          range: formatRange(
            { kind: 'bpm', bpm: target.lowBpm },
            { kind: 'bpm', bpm: target.highBpm },
            units,
          ),
        },
        units,
      )
    case 'pace':
      return render(
        WORKOUT_TEMPLATES['workout.target.pace'],
        {
          range: formatRange(
            { kind: 'pace', secPerKm: target.slowSecPerKm },
            { kind: 'pace', secPerKm: target.fastSecPerKm },
            units,
          ),
        },
        units,
      )
    case 'open':
      return null
  }
}

/** The cue of a step run by effort, "by effort". */
export function effortPhrase(units: Units): string {
  return render(WORKOUT_TEMPLATES['workout.target.effort'], {}, units)
}

/**
 * Whether a step is the running that the session's targets are about: the work of a quality
 * session, the run of an easy one. On a day steered by effort these are the steps run by effort;
 * warm-ups, cool-downs, recoveries and walks are not.
 */
export const isEffortStep = (step: WorkoutStep): boolean =>
  !step.walk && (step.intent === 'work' || step.intent === 'steady')

function targetText(step: WorkoutStep, effortLed: boolean, units: Units): string | null {
  const phrase = targetPhrase(step.target, units)
  if (phrase !== null) return phrase
  return effortLed && isEffortStep(step) ? effortPhrase(units) : null
}

function stepText(step: WorkoutStep, effortLed: boolean, units: Units): string {
  const tail = targetText(step, effortLed, units)
  const head = `${step.label} ${formatQuantity({ kind: 'duration', sec: step.durationSec }, units)}`
  return tail === null ? head : `${head}, ${tail}`
}

function nodeText(node: WorkoutNode, effortLed: boolean, units: Units): string {
  if (node.type === 'step') return stepText(node, effortLed, units)
  const body = node.steps.map((step) => stepText(step, effortLed, units)).join('; ')
  return render(
    WORKOUT_TEMPLATES['workout.repeat'],
    { count: { kind: 'count', n: node.count }, steps: body },
    units,
  )
}

/**
 * The workout of a session [design 6.5]. `targets` is `resolveTargets` for the session as it is to
 * be run (the eased version for an eased day, `hot` from `isHotForSteering`). The description
 * holds the reason for nothing: an eased day says only "Eased for today".
 *
 * @throws when the kind is not `publishable`; the caller checks first.
 */
export function toWorkoutPlan(
  session: WorkoutSource,
  targets: ResolvedTargets,
  options: WorkoutOptions,
): WorkoutPlan {
  if (!publishable(session.kind)) {
    throw new Error(`A ${session.kind} session has no workout`)
  }
  const ctx: Context = {
    session,
    targets,
    walking: isLadderSession(session) || session.flags.includes('run-walk'),
    units: options.units,
  }
  const plannedSec = Math.round(session.durationMin * 60)

  const engineSteps: Step[] =
    session.structure.length > 0
      ? session.structure
      : [
          {
            kind: WORK_KINDS.has(session.kind) ? 'work' : 'steady',
            reps: 1,
            durationSec: plannedSec,
            distanceM: null,
            zone: targets.zone,
          },
        ]
  const nodes = toNodes(engineSteps, ctx)
  // the walks that frame a ladder session sit outside its minutes, so only other sessions fill up
  const missingSec = plannedSec - totalOf(nodes)
  if (missingSec > 0 && !isLadderSession(session)) fillToMinutes(nodes, missingSec)

  const eased = options.eased ?? false
  const fuelLine = options.fuelLine?.trim() ? options.fuelLine.trim() : null
  const effortLed = targets.mode === 'effort'
  const lines = [
    ...(eased ? [easedLine(options.units)] : []),
    ...(targets.hot && targets.hotNote !== null ? [targets.hotNote] : []),
    ...nodes.map((node) => nodeText(node, effortLed, options.units)),
    ...(fuelLine === null ? [] : [fuelLine]),
  ]
  return {
    title: publicTitle(session),
    kind: session.kind,
    nodes,
    totalSec: totalOf(nodes),
    description: lines.join('\n'),
    targets,
    eased,
    fuelLine,
    units: options.units,
  }
}
