// The scenario simulator (evaluation harness, proposal
// `docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md` section 5.3, task H2):
// the seeded athlete is deterministic, each level has the shape it is named for, the scorer's figures
// are right on a small chain worked by hand, and the two metamorphic relations [Segura 2016] are
// asserted on the real re-plan over the twelve matrix athletes.
//
// What stays in `npm run check` is this file; the figures of a chain are read by hand at each
// `PARAMS_VERSION` bump (decision 11), never asserted against a threshold (G5). The chain time of
// every level and athlete, and of the two relations, is printed at the end of the run.
//
// Two relations, each asserted where it holds and recorded as `test.fails` where it does not (the case
// list is the failure message, and the test goes red when an engine change fixes a case):
// - "a re-plan with no new data is a fixed point": re-running a step with the same input gives the
//   same plan at every step of every ragged chain, and feeding the step's plan back as the stored plan
//   gives it back at every compliant and ragged step, after a hold and in the race week included. It
//   does not in the first week of a start path or in a held week a window touches (RF1, not fixed).
// - "a closed day never raises a week": holds for the compliant level at every step and for the ragged
//   level at every step that carries no start-path week and where the day does not empty the week,
//   after a hold included. It does not hold in a start-path plan, or when the day empties the week
//   (RF1, not fixed).
import { isDeepStrictEqual } from 'node:util'
import { afterAll, describe, expect, it, test, vi } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import {
  dayRulesIn,
  disruptionPlan,
  isDisruptedWeek,
  validateDisruption,
} from '../../../shared/engine/disruption.ts'
import { loadPosition, responseBasis } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  ChecklistResult,
  DisruptionWindow,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import { mulberry32, planMinutes } from './disruption-fixtures.ts'
import { goal, spec } from './e8-fixtures.ts'
import { weekFixture, zoneSetFixture } from './fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'
import {
  EXACT_RATES,
  LEVEL_RATES,
  MIN_OPEN_DAYS,
  NIGGLE_CAP_MIN,
  SIM_LEVELS,
  SimAthlete,
  WEEK_ABOVE_PLAN_RATIO,
  WINDOW_SPACING_DAYS,
  replanMonday,
  scoreChain,
  simulateChain,
  withStoredPlan,
  type ScorableChain,
  type SimChain,
  type SimLevel,
  type SimOptions,
  type SimStep,
  type SimWeek,
} from './sim-athlete.ts'

const SEED = 20_261_031
// The two relations together should run in under a minute (decision 11); the test timeout is twice
// that, so a slow machine fails the assertion with the elapsed time and not a bare timeout.
const BUDGET_MS = 60_000
vi.setConfig({ testTimeout: 2 * BUDGET_MS })

const all = athletes()
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const weekdayOf = (date: string) => WEEKDAYS[daysBetween(mondayOf(date), date)]!

/** A value made on first use, so a relation that two tests read is worked out once. */
function lazy<T>(make: () => T): () => T {
  let made: { value: T } | undefined
  return () => (made ??= { value: make() }).value
}

/** One seed per athlete, so the twelve chains of a level do not share their stops. */
const seedOf = (index: number): number => SEED + index

// ---------------------------------------------------------------------------------------------
// Chains, built once and timed
// ---------------------------------------------------------------------------------------------

const timings: Array<{ level: SimLevel; athlete: string; steps: number; ms: number }> = []
const chains = new Map<string, SimChain>()

function chainOf(level: SimLevel, index: number, options: SimOptions = {}): SimChain {
  const key = `${level}/${String(index)}/${options.loadAppetite ?? 'steady'}`
  let chain = chains.get(key)
  if (chain === undefined) {
    const started = performance.now()
    chain = simulateChain(new SimAthlete(seedOf(index), level), all[index]!.input, options)
    timings.push({
      level,
      athlete: `${all[index]!.id}${options.loadAppetite === undefined ? '' : ` (${options.loadAppetite})`}`,
      steps: chain.steps.length,
      ms: performance.now() - started,
    })
    chains.set(key, chain)
  }
  return chain
}

const levelChains = (level: SimLevel, options: SimOptions = {}) =>
  all.map((athlete, index) => ({ athlete, chain: chainOf(level, index, options) }))

/** Milliseconds each relation took, for the summary. */
const relationMs: Record<string, number> = {}
function timed<T>(name: string, run: () => T): T {
  const started = performance.now()
  const result = run()
  relationMs[name] = performance.now() - started
  return result
}

afterAll(() => {
  const lines = ['', 'sim-athlete: chain time (ms) by level and athlete']
  for (const level of SIM_LEVELS) {
    const rows = timings.filter((t) => t.level === level)
    if (rows.length === 0) continue
    const total = rows.reduce((sum, r) => sum + r.ms, 0)
    lines.push(`  ${level}: ${String(rows.length)} chains, ${total.toFixed(0)} ms in all`)
    for (const r of rows) {
      lines.push(
        `    ${r.athlete.padEnd(34)} ${String(r.steps).padStart(3)} steps ${r.ms.toFixed(0).padStart(6)} ms`,
      )
    }
  }
  lines.push('  the relations (their re-plans, the chains apart)')
  for (const [name, ms] of Object.entries(relationMs)) {
    lines.push(`    ${name.padEnd(44)} ${ms.toFixed(0).padStart(6)} ms`)
  }
  const relations = Object.values(relationMs).reduce((sum, ms) => sum + ms, 0)
  const built = timings
    .filter((t) => t.level === 'ragged' || t.level === 'compliant')
    .reduce((sum, t) => sum + t.ms, 0)
  lines.push(
    `  the relations together: ${(relations + built).toFixed(0)} ms (the ragged and compliant chains included)`,
  )
  console.log(lines.join('\n'))
})

// ---------------------------------------------------------------------------------------------
// The athlete
// ---------------------------------------------------------------------------------------------

describe('SimAthlete', () => {
  const half = all.findIndex((a) => a.id === 'half')

  it.each(SIM_LEVELS)('builds the same chain from the same seed at the %s level', (level) => {
    const first = all[half]!.input
    const a = simulateChain(new SimAthlete(SEED, level), first)
    const b = simulateChain(new SimAthlete(SEED, level), first)
    expect(b).toEqual(a)
  })

  it('builds another chain from another seed', () => {
    const first = all[half]!.input
    const a = simulateChain(new SimAthlete(SEED, 'ragged'), first)
    const b = simulateChain(new SimAthlete(SEED + 1, 'ragged'), first)
    expect(b.calendar.stops).not.toEqual(a.calendar.stops)
    expect(b.steps.map((s) => s.draft)).not.toEqual(a.steps.map((s) => s.draft))
  })

  it('draws a session by its day and order, whatever else the plan holds', () => {
    const athlete = new SimAthlete(SEED, 'ragged')
    const calendar = athlete.calendar(all[half]!.input)
    const session = { date: '2026-11-17', order: 0, durationMin: 50 }
    const alone = athlete.minutesRun(session, calendar)
    athlete.minutesRun({ date: '2026-11-18', order: 0, durationMin: 30 }, calendar)
    expect(athlete.minutesRun(session, calendar)).toBe(alone)
  })

  it('keeps the rates of each level where the rules put its words', () => {
    const { partialBelow, extendedAbove } = P.completion
    const compliant = LEVEL_RATES.compliant.asPlanned
    expect(compliant[0]).toBeGreaterThan(partialBelow.value)
    expect(compliant[1]).toBeLessThan(extendedAbove.value)
    // a short session is partial, an overshooting week is above the extended ratio
    expect(LEVEL_RATES.ragged.shortRatio[1]).toBeLessThan(partialBelow.value)
    expect(LEVEL_RATES.overshooting.overshootRatio[0]).toBeGreaterThan(extendedAbove.value)
    expect(LEVEL_RATES.overshooting.overshootRatio[0]).toBeGreaterThan(WEEK_ABOVE_PLAN_RATIO)
    // a stop is shorter than the layoff that restarts a plan (Feely's "up to 6 days")
    expect(LEVEL_RATES.ragged.stopMaxDays).toBeLessThan(P.j7.tier1Days.value)
    // the exact stand-in runs every session as planned and nothing else
    expect(EXACT_RATES.asPlanned).toEqual([1, 1])
    expect(EXACT_RATES.skipDayShare + EXACT_RATES.stopWeekShare + EXACT_RATES.windowWeekShare).toBe(
      0,
    )
  })

  it('makes a calendar of valid windows, bounded stops and closed days that leave days open', () => {
    let windows = 0
    for (const athlete of all) {
      for (let k = 0; k < 40; k += 1) {
        const calendar = new SimAthlete(SEED + k, 'ragged').calendar(athlete.input)
        const raceMonday = mondayOf(athlete.input.goal.date)
        for (const stop of calendar.stops) {
          expect(stop.days).toBeGreaterThanOrEqual(1)
          expect(stop.days).toBeLessThanOrEqual(LEVEL_RATES.ragged.stopMaxDays)
          expect(stop.from >= athlete.input.today).toBe(true)
        }
        let previous: DisruptionWindow | null = null
        for (const w of calendar.windows) {
          windows += 1
          const reportedOn =
            mondayOf(w.startDate) === w.startDate ? w.startDate : addDays(mondayOf(w.startDate), 7)
          expect(
            validateDisruption(w, { today: reportedOn, goalDate: athlete.input.goal.date }),
          ).toEqual([])
          expect(w.startDate >= athlete.input.today && w.startDate < raceMonday).toBe(true)
          if (w.mode === 'limited') expect(w.maxRunMin).toBe(NIGGLE_CAP_MIN)
          if (previous !== null) {
            expect(w.startDate > addDays(previous.endDate, WINDOW_SPACING_DAYS)).toBe(true)
          }
          previous = w
        }
        for (const c of calendar.closures) {
          const base = athlete.input.profile.availability
          const open = Object.values(base).filter((d) => d.available).length
          expect(base[c.weekday].available).toBe(true)
          expect(c.weekday).not.toBe(athlete.input.profile.longRunDay)
          expect(open - 1).toBeGreaterThanOrEqual(MIN_OPEN_DAYS)
        }
      }
    }
    // the sample holds windows at all, so the checks above ran
    expect(windows).toBeGreaterThan(50)
  })

  it('is replanChain when every session is run exactly as planned', () => {
    // Without a REDs screening no weekly decision holds or reduces a week of such a chain, so the
    // simulator's re-plan (which adds the decision of the week that ended) is the plain re-plan.
    for (const athlete of all.filter((a) => a.input.screeningFlags === undefined)) {
      const sim = simulateChain(new SimAthlete(SEED, 'compliant', EXACT_RATES), athlete.input)
      const plain = replanChain(athlete.input)
      expect(sim.steps.map((s) => s.draft)).toEqual(plain.map((s) => s.draft))
      expect(
        sim.steps.every((s) => s.decision === null || s.decision.decision === 'progress'),
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The levels
// ---------------------------------------------------------------------------------------------

const ratioOf = (w: SimWeek): number => w.ranMin / w.plannedMin
const weeksOf = (chain: SimChain): SimWeek[] =>
  chain.steps.flatMap((s) => (s.week === null ? [] : [s.week])).filter((w) => w.plannedMin > 0)

describe('the compliant level', () => {
  it('runs every session as planned and every week inside the band of the completion rules', () => {
    for (const { athlete, chain } of levelChains('compliant')) {
      expect(chain.calendar.stops, athlete.id).toEqual([])
      expect(chain.calendar.windows, athlete.id).toEqual([])
      expect(chain.calendar.closures, athlete.id).toEqual([])
      const weeks = weeksOf(chain)
      expect(weeks.length, athlete.id).toBeGreaterThan(8)
      for (const w of weeks) {
        expect(w.sessions.short + w.sessions.skipped + w.sessions.extended, athlete.id).toBe(0)
        expect(ratioOf(w), `${athlete.id} ${w.weekStart}`).toBeGreaterThanOrEqual(
          P.completion.partialBelow.value,
        )
        expect(ratioOf(w), `${athlete.id} ${w.weekStart}`).toBeLessThanOrEqual(
          P.completion.extendedAbove.value,
        )
      }
      const score = scoreChain(chain)
      expect(score.atHoldShare.value.weeks, athlete.id).toBe(score.atHoldShare.value.of)
      expect(score.aboveWeeks.value.weeks, athlete.id).toBe(0)
    }
  })

  it('is held only where the plan is held for another reason', () => {
    // a compliant week never holds the volume (j5.completionHoldShare); the REDs screening does
    for (const { athlete, chain } of levelChains('compliant')) {
      const holds = chain.steps.filter(
        (s) => s.decision !== null && s.decision.decision !== 'progress',
      )
      const screened = athlete.input.screeningFlags !== undefined
      expect(holds.length > 0, athlete.id).toBe(screened)
      for (const s of holds) {
        expect(s.decision!.signals.map((x) => x.code)).toEqual(['reds'])
      }
    }
  })
})

describe('the ragged level', () => {
  const ragged = levelChains('ragged')

  it('skips days, cuts sessions short and stops for up to six days', () => {
    let skipped = 0
    let short = 0
    let stops = 0
    for (const { athlete, chain } of ragged) {
      stops += chain.calendar.stops.length
      for (const w of weeksOf(chain)) {
        skipped += w.sessions.skipped
        short += w.sessions.short
      }
      for (const stop of chain.calendar.stops) {
        expect(stop.days, athlete.id).toBeLessThanOrEqual(LEVEL_RATES.ragged.stopMaxDays)
      }
    }
    expect(stops).toBeGreaterThan(0)
    expect(skipped).toBeGreaterThan(0)
    expect(short).toBeGreaterThan(0)
  })

  it('has weeks under the share of planned minutes that holds the volume, in every chain', () => {
    for (const { athlete, chain } of ragged) {
      const { weeks, of } = scoreChain(chain).atHoldShare.value
      expect(of, athlete.id).toBeGreaterThan(8)
      expect(weeks, athlete.id).toBeLessThan(of)
    }
  })

  // Found by H2 (2026-10-31) and fixed by RF1: a week with no running gave a cap of 0 minutes on the
  // week after it, which a hold or a reduce applies (rule G-6 steps from the minutes run). The break
  // rules size the restart (J7, E6), so a week planned at the start floor or more is not capped at 0.
  it('does not cap the week after a week with no running at 0 minutes, where the plan held the floor', () => {
    let after = 0
    for (const { athlete, chain } of ragged) {
      for (const step of chain.steps) {
        const { week, decision } = step
        if (week === null || decision === null || decision.postRace !== undefined) continue
        if (week.ranMin > 0 || week.plannedMin < P.macroDesign.startFloorWeekMin.value) continue
        if (decision.decision === 'progress') continue
        after += 1
        expect(decision.nextWeekTargetMin, `${athlete.id} ${step.settled.today}`).toBeGreaterThan(0)
      }
    }
    expect(after).toBeGreaterThan(0)
  })

  it('reports its windows through the real disruption path and the plan answers them', () => {
    let reported = 0
    for (const { athlete, chain } of ragged) {
      for (const window of chain.calendar.windows) {
        reported += 1
        const step = chain.steps.find((s) => s.settled.today >= window.startDate)
        // the Monday on or after the first day gets the window in its input, as the form would send it
        expect(
          step?.settled.disruptions?.map((w) => w.id),
          athlete.id,
        ).toContain(window.id)
        // and the plan carries the window: a week it touches is flagged
        const flagged = step!.draft.weeks.some((w) => isDisruptedWeek(w.flags))
        expect(flagged, `${athlete.id} ${window.id}`).toBe(true)
      }
      // the windows given to a step are those that began by its Monday
      for (const step of chain.steps) {
        const given = (step.settled.disruptions ?? []).map((w) => w.id)
        const due = chain.calendar.windows
          .filter((w) => w.startDate <= step.settled.today)
          .map((w) => w.id)
        expect(given, athlete.id).toEqual(due)
      }
    }
    expect(reported).toBeGreaterThan(0)
  })

  it('closes a weekday for some weeks, and the plan leaves that day free', () => {
    let closedSteps = 0
    for (const { athlete, chain } of ragged) {
      for (const step of chain.steps) {
        for (const day of step.closedDays) {
          closedSteps += 1
          expect(step.settled.profile.availability[day].available).toBe(false)
          const today = step.settled.today
          const sessions = step.draft.sessions.filter(
            (s: SessionSpec) =>
              s.date >= today &&
              weekdayOf(s.date) === day &&
              s.durationMin > 0 &&
              s.kind !== 'rest' &&
              s.kind !== 'race',
          )
          expect(sessions, `${athlete.id} ${today} ${day}`).toEqual([])
        }
      }
    }
    expect(closedSteps).toBeGreaterThan(0)
  })

  it('moves the plan: the first plan is not the plan that is run', () => {
    for (const { athlete, chain } of ragged) {
      const score = scoreChain(chain)
      expect(score.churn.value.minutesMoved, athlete.id).toBeGreaterThan(0)
      expect(score.delivered.value.share, athlete.id).not.toBeNull()
      expect(score.delivered.value.share!, athlete.id).toBeLessThan(1)
    }
  })
})

describe('the overshooting level', () => {
  const steady = levelChains('overshooting')
  const standard = levelChains('overshooting', { loadAppetite: 'standard' })

  it('runs weeks above plan, at about the stated share', () => {
    let above = 0
    let weeks = 0
    for (const { athlete, chain } of steady) {
      const score = scoreChain(chain)
      expect(score.aboveWeeks.value.weeks, athlete.id).toBeGreaterThan(0)
      above += score.aboveWeeks.value.weeks
      weeks += score.aboveWeeks.value.of
      for (const w of weeksOf(chain)) {
        // never under plan: sessions are run at 100% to 110%, weeks above plan at 125% and more
        expect(ratioOf(w), `${athlete.id} ${w.weekStart}`).toBeGreaterThanOrEqual(0.95)
      }
    }
    const share = above / weeks
    expect(share).toBeGreaterThan(LEVEL_RATES.overshooting.overshootWeekShare - 0.15)
    expect(share).toBeLessThan(LEVEL_RATES.overshooting.overshootWeekShare + 0.15)
  })

  it('has no response of rule G-8 at steady', () => {
    for (const { athlete, chain } of steady) {
      for (const step of chain.steps.slice(1)) {
        const basis = responseBasis(step.settled, estimateState(step.settled))
        expect(basis, `${athlete.id} ${step.settled.today}`).toBeNull()
      }
    }
  })

  it('has a response at standard where the setting is not held, and none where it is held', () => {
    let heldAthletes = 0
    let responding = 0
    for (const { athlete, chain } of standard) {
      const second = chain.steps[1]!.settled
      const held = loadPosition(second, estimateState(second)).held
      const steps = chain.steps.slice(1).filter((s) => {
        const basis = responseBasis(s.settled, estimateState(s.settled))
        return basis !== null && basis.meanMin !== null
      })
      if (held === null) {
        responding += 1
        expect(steps.length, athlete.id).toBeGreaterThan(0)
      } else {
        heldAthletes += 1
        expect(steps.length, `${athlete.id} (held: ${held})`).toBe(0)
      }
    }
    // the sample holds both kinds, so neither branch above is vacuous
    expect(heldAthletes).toBeGreaterThan(0)
    expect(responding).toBeGreaterThan(8)
  })

  it('plans no week below the steady plan where the response applies, and some above it', () => {
    let steps = 0
    let higher = 0
    for (const { athlete, chain } of standard) {
      for (const step of chain.steps.slice(1)) {
        const basis = responseBasis(step.settled, estimateState(step.settled))
        if (basis === null || basis.meanMin === null) continue
        steps += 1
        const atSteady = replanMonday({
          ...step.settled,
          options: { ...step.settled.options, loadAppetite: 'steady' },
        }).draft
        let raised = false
        for (const week of step.draft.weeks) {
          if (week.weekStart < step.settled.today) continue
          const other = atSteady.weeks.find((w) => w.weekStart === week.weekStart)
          if (other === undefined) continue
          expect(
            week.targetRunMin,
            `${athlete.id} ${step.settled.today} ${week.weekStart}`,
          ).toBeGreaterThanOrEqual(other.targetRunMin)
          if (week.targetRunMin > other.targetRunMin) raised = true
        }
        if (raised) higher += 1
      }
    }
    expect(steps).toBeGreaterThan(100)
    expect(higher).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The scorer, on a chain worked by hand
// ---------------------------------------------------------------------------------------------

/** The Monday of week `n`: week 1 is 2026-11-02, the race week 6 is 2026-12-07. */
const W = (n: number): string => addDays('2026-11-02', 7 * (n - 1))

/** Four runs a week, three easy ones (Tuesday, Thursday, Saturday) and a long one on Sunday. */
function runsOf(n: number, easy: number, long: number): SessionSpec[] {
  const run = (day: number, kind: SessionKind, minutes: number) =>
    spec(addDays(W(n), day), kind, { durationMin: minutes })
  return [run(1, 'easy', easy), run(3, 'easy', easy), run(5, 'easy', easy), run(6, 'long', long)]
}

const weekOf = (n: number, target: number, over: Partial<WeekDraft> = {}): WeekDraft =>
  weekFixture({
    weekStart: W(n),
    index: n - 1,
    runDays: 4,
    phase: 'base',
    targetRunMin: target,
    ...over,
  })

/**
 * A draft of five weeks and a race week. `minutes[n - 1]` is `[easy, long]` of week n; the targets
 * are the sums (3 x easy + long) except in the recovery week.
 */
function draftOf(minutes: Array<[number, number]>, checklist: ChecklistResult[] = []): PlanDraft {
  const sums = minutes.map(([easy, long]) => 3 * easy + long)
  return {
    weeks: [
      ...sums.map((target, i) => weekOf(i + 1, target, i === 3 ? { isRecovery: true } : {})),
      weekOf(6, 40, { phase: 'race', isTaper: true, targetRunMin: 40 }),
    ],
    sessions: minutes.flatMap(([easy, long], i) => runsOf(i + 1, easy, long)),
    feasibility: { label: 'comfortable', weeksNeeded: 6, weeksAvailable: 6, notes: [] },
    warnings: [],
    checklist,
    prediction: null,
    zones: zoneSetFixture(),
    paramsVersion: 'test',
  }
}

const check = (id: string, ok: boolean): ChecklistResult => ({ id, ok, detail: '', rules: [] })
const weekRun = (n: number, planned: number, ran: number): SimWeek => ({
  weekStart: W(n),
  targetMin: planned,
  plannedMin: planned,
  ranMin: ran,
  sessions: { 'as-planned': 0, short: 0, extended: 0, skipped: 0 },
})
const raceDay = addDays(W(6), 6)
const context = (today: string) => ({
  today,
  goal: { ...goal(), date: raceDay },
  options: {},
})

describe('scoreChain', () => {
  //   plan             wk1  wk2  wk3  wk4(rec)  wk5   sessions: 3 x easy + long
  //   first (Mon W1)   100  110  120   90       130   20/40 22/44 24/48 18/36 26/52
  //   re-plan 1 (W2)   100  105  115   86       125   21/42 23/46 17/35 25/50
  //   re-plan 2 (W3)   100  105   90   70       100   18/36 14/28 20/40
  //   re-plan 3 (W4)   100  105   90   70        80   16/32
  //   week as run      wk1 100 -> 60   wk2 105 -> 130   wk3 90 -> 45
  const first = draftOf([
    [20, 40],
    [22, 44],
    [24, 48],
    [18, 36],
    [26, 52],
  ])
  const replan1 = draftOf(
    [
      [20, 40],
      [21, 42],
      [23, 46],
      [17, 35],
      [25, 50],
    ],
    [check('ramp', false), check('taper', true)],
  )
  const replan2 = draftOf(
    [
      [20, 40],
      [21, 42],
      [18, 36],
      [14, 28],
      [20, 40],
    ],
    [check('ramp', false), check('taper', false)],
  )
  const replan3 = draftOf([
    [20, 40],
    [21, 42],
    [18, 36],
    [14, 28],
    [16, 32],
  ])
  const chain: ScorableChain = {
    steps: [
      { draft: first, input: context(W(1)), decision: null, week: null },
      {
        draft: replan1,
        input: context(W(2)),
        decision: { decision: 'hold' },
        week: weekRun(1, 100, 60),
      },
      {
        draft: replan2,
        input: context(W(3)),
        decision: { decision: 'progress' },
        week: weekRun(2, 105, 130),
      },
      {
        draft: replan3,
        input: context(W(4)),
        decision: { decision: 'hold' },
        week: weekRun(3, 90, 45),
      },
    ],
  }
  const score = scoreChain(chain)

  it('counts the weeks at the share of planned minutes that holds the volume, with its label', () => {
    // 60 / 100 = 0.60 and 45 / 90 = 0.50 are under 0.8; 130 / 105 = 1.24 is over it
    expect(score.atHoldShare.value).toEqual({ weeks: 1, of: 3 })
    expect(score.atHoldShare.grade).toBe(P.j5.completionHoldShare.grade)
    expect(score.atHoldShare.rule).toBe(P.j5.completionHoldShare.rule)
  })

  it('counts the weeks above the weekly ratio, with no label because no rule supports it', () => {
    // only 130 / 105 = 1.238 is over 1.2
    expect(score.aboveWeeks.value).toEqual({ weeks: 1, of: 3 })
    expect(score.aboveWeeks.grade).toBeNull()
    expect(score.aboveWeeks.rule).toBeNull()
  })

  it('reads the edges: 80% counts at the share, 120% is not above, 121% is', () => {
    const edge = (...ratios: Array<[number, number]>): ScorableChain => ({
      steps: [
        { draft: first, input: context(W(1)), decision: null, week: null },
        ...ratios.map(([planned, ran], i) => ({
          draft: first,
          input: context(W(2 + i)),
          decision: null,
          week: weekRun(1 + i, planned, ran),
        })),
      ],
    })
    const scored = scoreChain(edge([100, 80], [100, 79], [100, 120], [100, 121]))
    expect(scored.atHoldShare.value).toEqual({ weeks: 3, of: 4 })
    expect(scored.aboveWeeks.value).toEqual({ weeks: 1, of: 4 })
    // a week with nothing planned is not a week to read
    expect(scoreChain(edge([0, 0], [100, 100])).atHoldShare.value).toEqual({ weeks: 1, of: 1 })
  })

  it('moves minutes per re-plan from the re-plan day on, through the churn of the metrics', () => {
    // re-plan 1 from W2: 21 vs 22 (x3) and 42 vs 44 in week 2 (5), 23 vs 24 and 46 vs 48 (5), 17 vs 18
    // and 35 vs 36 (4), 25 vs 26 and 50 vs 52 (5): 19. Re-plan 2 from W3: 25, 16 and 25: 66.
    // Re-plan 3 from W4: week 4 is as it was, week 5 loses 4 x 3 + 8 = 20.
    expect(score.churn.value.steps.map((s) => s.minutesMoved)).toEqual([19, 66, 20])
    expect(score.churn.value.steps.map((s) => s.resized)).toEqual([16, 12, 4])
    expect(score.churn.value.steps.map((s) => s.unchanged)).toEqual([0, 0, 4])
    expect(score.churn.value.minutesMoved).toBe(105)
    expect(score.churn.grade).toBeNull()
  })

  it('counts hold, progress, hold as one flip, and labels it with the J5 hold', () => {
    expect(score.holdFlips.value.sequence).toEqual(['hold', 'progress', 'hold'])
    expect(score.holdFlips.value.flips).toBe(1)
    expect(score.holdFlips.value.counts).toEqual({ progress: 1, hold: 2, reduce: 0 })
    expect(score.holdFlips.rule).toBe(P.j5.completionHoldShare.rule)
    const quiet = scoreChain({
      steps: [
        ...chain.steps.slice(0, 1),
        { ...chain.steps[1]!, decision: { decision: 'hold' } },
        { ...chain.steps[2]!, decision: { decision: 'hold' } },
        { ...chain.steps[3]!, decision: { decision: 'progress' } },
        // a post-race window's decision is no hold, and is left out
        {
          ...chain.steps[3]!,
          decision: {
            decision: 'hold',
            postRace: {
              label: 'After the race, step 1 of 3',
              phase: 'step',
              step: 1,
              steps: 3,
              holdUntil: W(1),
              quietUntil: W(1),
              extensionDays: 0,
            },
          },
        },
      ],
    })
    expect(quiet.holdFlips.value.sequence).toEqual(['hold', 'hold', 'progress'])
    expect(quiet.holdFlips.value.flips).toBe(0)
  })

  it('follows the peak week across the chain', () => {
    // loading weeks only: 100 110 120 130 (peak week 5), then 100 105 115 125 (week 5), then
    // 100 105 90 100 and 100 105 90 80 (week 2, the first of the highest)
    const rows = score.peakDrift.value.rows
    expect(rows.map((r) => r.peak?.targetMin)).toEqual([130, 125, 105, 105])
    expect(rows.map((r) => r.peak?.weekStart)).toEqual([W(5), W(5), W(2), W(2)])
    expect(rows.map((r) => r.peak?.position)).toEqual([5, 5, 2, 2])
    expect(score.peakDrift.value.targetChangeMin).toBe(-25)
    expect(score.peakDrift.value.positionChange).toBe(-3)
    expect(score.peakDrift.value.maxTargetDistanceMin).toBe(25)
    expect(score.peakDrift.value.weekMoves).toBe(1)
  })

  it('counts the failed items of the checklist at each step', () => {
    expect(score.conformance.value.failedItems).toEqual([0, 1, 2, 0])
    expect(score.conformance.value.stepsWithFailure).toBe(2)
  })

  it('compares the minutes run with the first plan over the weeks that were run', () => {
    // run: 60 + 130 + 45 = 235; the first plan held 100 + 110 + 120 = 330 in those weeks
    expect(score.delivered.value.ranMin).toBe(235)
    expect(score.delivered.value.firstPlanMin).toBe(330)
    expect(score.delivered.value.share).toBeCloseTo(235 / 330, 10)
  })

  it('gives figures only: no overall score, and no word of the rules G5 keeps out', () => {
    expect(Object.keys(score).sort()).toEqual([
      'aboveWeeks',
      'atHoldShare',
      'churn',
      'conformance',
      'delivered',
      'holdFlips',
      'peakDrift',
    ])
    expect(JSON.stringify(score)).not.toMatch(/\b(safe|behind|missed|injury risk)\b/i)
  })

  it('scores a simulated chain without error, one of each level', () => {
    for (const level of SIM_LEVELS) {
      const scored = scoreChain(
        chainOf(
          level,
          all.findIndex((a) => a.id === 'half'),
        ),
      )
      expect(scored.delivered.value.firstPlanMin).toBeGreaterThan(0)
      expect(scored.conformance.value.failedItems.length).toBeGreaterThan(10)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// A held plan under the weekly decision
// ---------------------------------------------------------------------------------------------

describe('a held plan under the weekly decision [rules n-4, J5]', () => {
  // Found by H2 (2026-10-31) and fixed by RF1: the REDs athlete holds every week, and the cap of the
  // weekly decision lowers the week it covers under the level the macrocycle holds, so the weeks that
  // climb back by the ramp read as growth to the checklist's hold item: it failed at 10 of the 20
  // steps of the compliant chain, 5 of the ragged and 11 of the overshooting one (one run of the
  // chains, RF1, 2026-10-31). The item reads the runner's level beside the first week.
  it.each(SIM_LEVELS)(
    'keeps the hold item of the checklist at every step of the chain at the %s level',
    (level) => {
      const chain = chainOf(
        level,
        all.findIndex((a) => a.id === 'reds-hold'),
      )
      const failed = chain.steps.flatMap((step, k) =>
        step.draft.checklist
          .filter((c) => c.id === 'reds-hold' && !c.ok)
          .map((c) => `step ${String(k)}: ${c.detail}`),
      )
      expect(failed).toEqual([])
      // every week is held, so the chain is the case the item is for
      expect(chain.steps.filter((s) => s.decision?.decision === 'hold').length).toBeGreaterThan(10)
    },
  )
})

// ---------------------------------------------------------------------------------------------
// The figures of the chains, printed by hand
// ---------------------------------------------------------------------------------------------

// By hand, at each `PARAMS_VERSION` bump (decision 11): the figures of every level and athlete, read
// and never asserted. Run with
//   SIM_FIGURES=1 npx vitest run tests/unit/engine/sim-athlete.test.ts -t "printed by hand"
// Each line is one chain: weeks at `j5.completionHoldShare` of the planned minutes (of the weeks
// read) and weeks above the weekly ratio; minutes the re-plans moved; weekly decisions (progress,
// hold, reduce) and hold-progress-hold flips; the peak week's target and position in the first plan
// and the last; steps with a failed item of the checklist; minutes run over the first plan's.
describe.skipIf(process.env.SIM_FIGURES === undefined)(
  'the figures of the chains, printed by hand',
  () => {
    const line = (id: string, chain: SimChain): string => {
      const score = scoreChain(chain)
      const peak = score.peakDrift.value
      const at = (p: typeof peak.first) =>
        p === null ? '-' : `${String(p.targetMin)}@${String(p.position)}`
      const counts = score.holdFlips.value.counts
      const share = score.delivered.value.share
      return [
        id.padEnd(34),
        `at share ${String(score.atHoldShare.value.weeks)}/${String(score.atHoldShare.value.of)}`.padEnd(
          16,
        ),
        `above ${String(score.aboveWeeks.value.weeks)}`.padEnd(9),
        `moved ${String(score.churn.value.minutesMoved)}`.padEnd(13),
        `P${String(counts.progress)} H${String(counts.hold)} R${String(counts.reduce)} flips ${String(score.holdFlips.value.flips)}`.padEnd(
          24,
        ),
        `peak ${at(peak.first)} -> ${at(peak.last)}`.padEnd(26),
        `checklist ${String(score.conformance.value.stepsWithFailure)}/${String(chain.steps.length)}`.padEnd(
          17,
        ),
        `run ${share === null ? '-' : share.toFixed(2)} of the first plan`,
      ].join('  ')
    }

    it.each(SIM_LEVELS)('prints the %s level', (level) => {
      const settings: SimOptions[] =
        level === 'overshooting' ? [{}, { loadAppetite: 'standard' }] : [{}]
      const lines = [`sim-athlete figures, ${level}, seed ${String(SEED)} + the athlete's index:`]
      for (const options of settings) {
        for (const { athlete, chain } of levelChains(level, options)) {
          lines.push(
            '  ' +
              line(
                `${athlete.id}${options.loadAppetite === undefined ? '' : ` (${options.loadAppetite})`}`,
                chain,
              ),
          )
        }
      }
      console.log(lines.join('\n'))
      expect(lines.length).toBeGreaterThan(all.length)
    })
  },
)

// ---------------------------------------------------------------------------------------------
// The metamorphic relations [Segura 2016]
// ---------------------------------------------------------------------------------------------

/** The weeks of a start path are set by their programme (the pattern of `disruption-fixtures.ts`). */
const PROGRAMME_FLAGS = /ladder-|injury-return|restart-floor/

interface Case {
  athlete: string
  step: number
  today: string
  /** The step follows a weekly decision that holds or reduces. */
  decided: boolean
  /** The plan has a start-path week from today on. */
  programme: boolean
  /** The week of the step's Monday is a week of a start path. */
  opens: boolean
  /** A window touches the week of the step's Monday. */
  windowed: boolean
  /** Closing the day left the week of the step's Monday with no running that it had without it. */
  emptied: boolean
  /** The step is the race week's Monday, the last of the chain. */
  raceWeek: boolean
  detail: string
}

function caseOf(athlete: string, chain: SimChain, k: number, detail: string): Case {
  const step = chain.steps[k]!
  const today = step.settled.today
  return {
    athlete,
    step: k,
    today,
    decided: Object.keys(step.decisions).length > 0,
    programme: step.draft.weeks.some(
      (w) => w.weekStart >= today && PROGRAMME_FLAGS.test(w.flags.join(' ')),
    ),
    opens: step.draft.weeks.some(
      (w) => w.weekStart === mondayOf(today) && PROGRAMME_FLAGS.test(w.flags.join(' ')),
    ),
    windowed:
      dayRulesIn(disruptionPlan(step.settled.disruptions ?? []), {
        from: mondayOf(today),
        to: addDays(mondayOf(today), 6),
      }).length > 0,
    emptied: false,
    raceWeek: k === chain.steps.length - 1,
    detail,
  }
}

const label = (c: Case): string =>
  `${c.athlete} step ${String(c.step)} (${c.today})${c.decided ? ' after a hold' : ''}${c.programme ? ' in a start path' : ''}${c.opens ? ' opening one' : ''}${c.windowed ? ' in a week a window touches' : ''}${c.emptied ? ' emptying it' : ''}${c.raceWeek ? ' in the race week' : ''}: ${c.detail}`

/** What differs between two drafts of one Monday, in a line. */
function difference(a: PlanDraft, b: PlanDraft): string {
  const weeks = b.weeks.filter((w, i) => !isDeepStrictEqual(w, a.weeks[i])).map((w) => w.weekStart)
  const sessions = b.sessions.filter((s, i) => !isDeepStrictEqual(s, a.sessions[i]))
  return `weeks ${weeks.slice(0, 3).join(',') || 'none'}, ${String(sessions.length)} sessions (${sessions
    .slice(0, 2)
    .map((s) => `${s.date} ${s.kind} ${String(s.durationMin)}`)
    .join('; ')})`
}

describe('metamorphic relations on the real re-plan [Segura 2016]', () => {
  describe('a re-plan with no new data is a fixed point', () => {
    it('gives the same plan when a step is run again with the same input (ragged, every step)', () => {
      const different = timed('same input again (ragged)', () => {
        const out: Case[] = []
        for (const { athlete, chain } of levelChains('ragged')) {
          chain.steps.forEach((step, k) => {
            if (k === 0) return
            const again = replanMonday(step.settled).draft
            if (!isDeepStrictEqual(again, step.draft)) {
              out.push(caseOf(athlete.id, chain, k, difference(step.draft, again)))
            }
          })
        }
        return out
      })
      expect(different.map(label)).toEqual([])
    })

    /** Steps whose plan, stored and re-planned with nothing new, comes back changed. */
    const drifts = (level: SimLevel, name: string) =>
      lazy((): { cases: Case[]; steps: number } =>
        timed(name, () => {
          const cases: Case[] = []
          let steps = 0
          for (const { athlete, chain } of levelChains(level)) {
            chain.steps.forEach((step, k) => {
              if (k === 0) return
              steps += 1
              const back = replanMonday(withStoredPlan(step)).draft
              if (!isDeepStrictEqual(back, step.draft)) {
                cases.push(caseOf(athlete.id, chain, k, difference(step.draft, back)))
              }
            })
          }
          return { cases, steps }
        }),
      )
    const compliantDrifts = drifts('compliant', 'plan stored again (compliant)')
    const raggedDrifts = drifts('ragged', 'plan stored again (ragged)')

    /**
     * The steps the relation holds in. Two classes are left out, both observed and not fixed (see the
     * last test of the group): the first week of a start path, whose minutes are its programme's, and
     * a held week a window touches.
     */
    const covered = (c: Case) => !c.opens && !(c.decided && c.windowed)

    // Found by H2 (2026-10-31) and fixed by RF1: after a hold, a plan stored as it came out of the
    // re-plan and re-planned with no new activity, window or check-in was not the same plan. 35 of the 96
    // ragged steps that follow a hold came back changed, and 14 of the 19 steps of the compliant REDs-hold
    // athlete, whose every week is held; the weeks ahead mostly fell (by up to 116 minutes in a week and
    // 377 over a plan). Two causes: the loading sequence of the weeks ahead carried on from the week as
    // the cap held it at the second pass and from the plan before the cap at the first, and the minutes
    // of the trim entered the bound of the week again. A hold now carries the sequence on from its cap,
    // and the trim of the decision is drawn again from the decision.
    it('gives the plan back when it is stored and re-planned, at every compliant and ragged step', () => {
      for (const drifted of [compliantDrifts(), raggedDrifts()]) {
        expect(drifted.cases.filter(covered).map(label)).toEqual([])
        // the check ran over many steps, after a hold among them
        expect(drifted.steps).toBeGreaterThan(200)
      }
    })

    // Found by H2 (2026-10-31) and fixed by RF1: in the race week, the last step of a chain, the plan
    // stored and re-planned with nothing new moved an easy session to another day, at 8 of the 11
    // compliant race-week steps that follow no hold. The week holds a run on the day of the race, which
    // the race replaces, and the re-plan held the week to the minutes the sessions placed, so each pass
    // shed a share of the week. A week the replaced plan has not started is held to its figure.
    it('gives the plan back at the race-week step of the compliant chains', () => {
      expect(
        compliantDrifts()
          .cases.filter((c) => c.raceWeek && !c.decided)
          .map(label),
      ).toEqual([])
    })

    // KNOWN LIMITS, observed by RF1 (2026-10-31) and not fixed. The relation does not hold (1) in the
    // first week of a start path: the ladder and the 3 x N floor weeks are sized by their programme,
    // and a stored plan that flips into one mid-season, or opens a hold at a cap under the floor, is
    // held to the minutes its short sessions placed; (2) in a held week a window touches: the bound of
    // such a week is the minutes placed, which the window's cap charges the held days against, and the
    // trim of the hold takes its minutes from that bound again. The case list is the failure message;
    // this passes when the first of them is fixed.
    test.fails(
      'gives the plan back in the first week of a start path and in a held week a window touches',
      () => {
        const cases = [...compliantDrifts().cases, ...raggedDrifts().cases]
        expect(cases.filter((c) => !covered(c)).map(label)).toEqual([])
      },
    )
  })

  describe('a closed day never raises a week', () => {
    /** Days after the step's Monday on which a one-day rest window is tried, per step. */
    const OFFSETS_PER_STEP = 3
    const HORIZON_DAYS = 14

    /** A day the runner cannot run, reported through the real disruption path. */
    const closedDay = (date: string): DisruptionWindow => ({
      id: 'sim-closed',
      reason: 'travel',
      mode: 'rest',
      startDate: date,
      endDate: date,
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    })

    /** Cases where closing one day raised a week's target or its planned run minutes. */
    const raises = (level: SimLevel, name: string) =>
      lazy((): { cases: Case[]; checks: number } =>
        timed(name, () => {
          const cases: Case[] = []
          let checks = 0
          all.forEach((athlete, index) => {
            const chain = chainOf(level, index)
            const draw = mulberry32(seedOf(index) ^ 0x5eed)
            chain.steps.forEach((step: SimStep, k) => {
              if (k === 0) return
              const base = planMinutes(step.draft)
              const days = new Set<string>()
              while (days.size < OFFSETS_PER_STEP) {
                days.add(addDays(step.settled.today, Math.floor(draw() * HORIZON_DAYS)))
              }
              for (const day of days) {
                if (day >= athlete.input.goal.date) continue
                checks += 1
                const window = closedDay(day)
                expect(
                  validateDisruption(window, {
                    today: step.settled.today,
                    goalDate: athlete.input.goal.date,
                  }),
                ).toEqual([])
                const variant = replanMonday({
                  ...step.settled,
                  disruptions: [...(step.settled.disruptions ?? []), window],
                }).draft
                const found: string[] = []
                for (const week of variant.weeks) {
                  const before = step.draft.weeks.find((w) => w.weekStart === week.weekStart)
                  if (before !== undefined && week.targetRunMin > before.targetRunMin) {
                    found.push(
                      `target ${week.weekStart} ${String(before.targetRunMin)} -> ${String(week.targetRunMin)}`,
                    )
                  }
                }
                for (const [week, minutes] of planMinutes(variant)) {
                  const before = base.get(week) ?? 0
                  if (minutes > before)
                    found.push(`minutes ${week} ${String(before)} -> ${String(minutes)}`)
                }
                if (found.length > 0) {
                  const monday = mondayOf(step.settled.today)
                  cases.push({
                    ...caseOf(
                      athlete.id,
                      chain,
                      k,
                      `closing ${day}: ${found.slice(0, 2).join('; ')}`,
                    ),
                    emptied:
                      (base.get(monday) ?? 0) > 0 && (planMinutes(variant).get(monday) ?? 0) === 0,
                  })
                }
              }
            })
          })
          return { cases, checks }
        }),
      )
    const compliantRaises = raises('compliant', 'a closed day (compliant)')
    const raggedRaises = raises('ragged', 'a closed day (ragged)')

    it('holds at every step of the compliant chains', () => {
      expect(compliantRaises().checks).toBeGreaterThan(500)
      expect(compliantRaises().cases.map(label)).toEqual([])
    })

    /** The steps the relation holds in: not the plans of a start path, and not a week the day empties. */
    const held = (c: Case) => !c.programme && !c.emptied

    // Found by H2 (2026-10-31) and fixed in part by RF1: at ragged steps that follow a hold, a one-day
    // rest window raised a week. Closing a day moved a week a window touches from the plan's figure to
    // the minutes the plan placed as its bound, and where the plan had placed more than its figure
    // (a session raised to the shortest run) the week rose; the bound of such a week is now the lesser
    // of the two.
    it('holds at the ragged steps, after a progress decision or a hold, that carry no start-path week and keep a run in the week', () => {
      expect(raggedRaises().checks).toBeGreaterThan(500)
      expect(raggedRaises().cases.filter(held).map(label)).toEqual([])
    })

    // KNOWN LIMITS, observed by H2 and RF1 (2026-10-31) and not fixed. (1) A day that empties the
    // week: on the hot-race chain at 2026-11-30 (after a hold, a window active), closing the last day
    // of the current week leaves it with no minutes, and the weeks after it go from 106, 116 and 127
    // minutes to 223, 245 and 269. A week with nothing placed has no baseline for the ramp of G-2, and
    // the ramp starts from the typical week, as it does for a layoff of the runner's (J7). The plan
    // with the day open anchors on the 97 minutes placed, so no baseline can serve both without
    // planning the weeks after an emptied week at nothing: that is a rule to choose (J9 or the
    // relation), not a defect to patch. (2) The plans of a start path, whose first-week minutes are
    // the programme's and shift with the day closed. (3) Other seeds also found tiny weeks (a target
    // of 12 to 14 minutes) placed above their target once a window touches them. The case list is the
    // failure message; this passes when none is left.
    test.fails('holds when the day empties the week, and in the plans of a start path', () => {
      expect(
        raggedRaises()
          .cases.filter((c) => !held(c))
          .map(label),
      ).toEqual([])
    })
  })
})
