import { describe, expect, test } from 'vitest'
import { STANDOUT_MAX_CARDS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { renderStandouts, standoutKindOf } from '../../../shared/copy/standoutRender.ts'
import {
  STANDOUT_KINDS,
  STANDOUT_SUBJECT_IDS,
  STANDOUT_TEMPLATES,
  type StandoutKind,
} from '../../../shared/copy/standoutTemplates.ts'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import { fitHrModel, hrAgainstModel, type HrModel } from '../../../shared/engine/execution.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  orderStandouts,
  rankStandouts,
  standoutFacts,
  STANDOUT_VERSION,
  type StandoutInput,
  type StandoutSession,
} from '../../../shared/engine/standout.ts'
import type { ExecutionAssessment, InputFact } from '../../../shared/engine/types.ts'
import type { Activity } from '../../../shared/types.ts'
import { makeActivity } from '../../factories.ts'

const ASOF = '2026-10-23'
const HISTORY_FROM = addDays(ASOF, -P.a5.historyWindowDays.value)

let nextId = 1
const id = (prefix: string) => `${prefix}${nextId++}`

/** A run `daysAgo` days before ASOF; dates are the runner's local days. */
function run(daysAgo: number, over: Partial<Activity> = {}): Activity {
  return makeActivity({
    id: id('r'),
    date: addDays(ASOF, -daysAgo),
    durationSec: 2400,
    distanceM: 7000,
    ...over,
  })
}

/** A steady, flat 40-minute run whose heart rate sits in one histogram bin: the HR model reads it. */
function steady(daysAgo: number, speedMps: number, avgHr: number, over: Partial<Activity> = {}) {
  const durationSec = 2400
  return run(daysAgo, {
    durationSec,
    distanceM: Math.round(speedMps * durationSec),
    elevationGainM: 20,
    avgHr,
    hrHistogram: {
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    },
    ...over,
  })
}

/** Heart rate that a runner of this fixture shows at a speed: a straight line, so the model fits it. */
const hrAt = (speedMps: number) => 120 + 15 * (speedMps - 2)

/** Nine steady runs in the last seven weeks, at speeds from 2.4 to 3.2 m/s on the line `hrAt`. */
function modelRuns(): Activity[] {
  return Array.from({ length: 9 }, (_, i) => {
    const speed = 2.4 + i * 0.1
    return steady(4 + i * 5, speed, hrAt(speed))
  })
}

const MODEL_RUNS = modelRuns()
const MODEL = fitHrModel(MODEL_RUNS, ASOF) as HrModel

function assessment(over: Partial<ExecutionAssessment> = {}): ExecutionAssessment {
  return {
    completion: 'completed',
    intensity: 'on',
    effort: {
      score: 0,
      confidence: 'low',
      parts: { rpeDelta: null, feel: null, hrResidualZ: null, paceResidualPct: null },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags: [],
    lines: [],
    ...over,
  }
}

/** An assessment whose effort score rests on the runner's rating (`rated`) or only on heart rate. */
function effort(score: -2 | -1 | 0 | 1 | 2, rated: boolean): ExecutionAssessment['effort'] {
  return {
    score,
    confidence: rated ? 'moderate' : 'low',
    parts: {
      rpeDelta: rated ? score * 2 : null,
      feel: null,
      hrResidualZ: rated ? null : score * 2,
      paceResidualPct: null,
    },
  }
}

function session(over: Partial<StandoutSession> = {}): StandoutSession {
  return {
    id: 's1',
    date: ASOF,
    kind: 'easy',
    durationMin: 40,
    assessment: assessment(),
    ...over,
  }
}

function inputFor(activity: Activity, over: Partial<StandoutInput> = {}): StandoutInput {
  return {
    activity,
    history: [],
    asOf: ASOF,
    historyFrom: HISTORY_FROM,
    hrModel: null,
    session: null,
    checkin: null,
    ...over,
  }
}

function kinds(facts: InputFact[]): string[] {
  return facts.map((fact) => standoutKindOf(fact) ?? 'unknown')
}

function slot(fact: InputFact | undefined, name: string): unknown {
  return fact?.slots[name]
}

function only(facts: InputFact[], kind: StandoutKind): InputFact | undefined {
  return facts.find((fact) => standoutKindOf(fact) === kind)
}

describe('the findings', () => {
  test('are the eleven of the design, each with a template and a name for its Why button', () => {
    expect(STANDOUT_KINDS).toHaveLength(11)
    expect(new Set(STANDOUT_KINDS).size).toBe(11)
    for (const kind of STANDOUT_KINDS) {
      expect(TEMPLATES[STANDOUT_SUBJECT_IDS[kind]], kind).toBeDefined()
    }
    expect(Object.keys(STANDOUT_TEMPLATES).every((key) => key.startsWith('standout.'))).toBe(true)
  })

  test('are described by activities of the run kinds only, never a duplicate', () => {
    const noisy = { pain: 8, elevationGainM: 900, distanceM: 5000 }
    expect(standoutFacts(inputFor(run(1, { ...noisy })))).not.toEqual([])
    expect(standoutFacts(inputFor(run(1, { ...noisy, type: 'strength' })))).toEqual([])
    expect(standoutFacts(inputFor(run(1, { ...noisy, type: 'cross' })))).toEqual([])
    for (const duplicateStatus of ['possible', 'confirmed'] as const) {
      expect(standoutFacts(inputFor(run(1, { ...noisy, duplicateStatus })))).toEqual([])
    }
    // The owner's "not a duplicate" keeps the run counted.
    expect(standoutFacts(inputFor(run(1, { ...noisy, duplicateStatus: 'dismissed' })))).not.toEqual(
      [],
    )
  })

  test('a plain run has none', () => {
    expect(standoutFacts(inputFor(run(1)))).toEqual([])
  })

  test('every fact is a stored record: a registered template, slots, a rule and a dated source', () => {
    const hard = run(0, { pain: 6, elevationGainM: 400, distanceM: 10_000, durationSec: 3600 })
    const facts = standoutFacts(inputFor(hard, { history: [run(5, { durationSec: 1800 })] }))
    expect(facts.length).toBeGreaterThan(2)
    for (const fact of facts) {
      expect(TEMPLATES[fact.template as keyof typeof TEMPLATES], fact.template).toBeDefined()
      expect(fact.state).toBe('used')
      expect(fact.rule).not.toBe('')
      expect(fact.sources[0]).toMatchObject({ kind: 'activity', id: hard.id, date: hard.date })
      // The record survives JSON: that is how it is stored.
      expect(JSON.parse(JSON.stringify(fact))).toEqual(fact)
    }
  })
})

describe('pain (1)', () => {
  const warn = P.pain.flagScore.value

  test('is stated from the score the warning sign uses, from the run or the check-in', () => {
    const own = standoutFacts(inputFor(run(1, { pain: warn })))
    expect(kinds(own)).toEqual(['pain'])
    expect(own[0]).toMatchObject({ template: 'standout.pain', rule: 'design-4.2' })
    expect(slot(own[0], 'pain')).toEqual({ kind: 'count', n: warn })

    expect(standoutFacts(inputFor(run(1, { pain: warn - 1 })))).toEqual([])

    const day = run(1, { pain: 1 })
    const checkin = { painScore: warn + 1, painFocalBone: false }
    const fromCheckin = standoutFacts(inputFor(day, { checkin }))
    expect(fromCheckin[0]).toMatchObject({ template: 'standout.pain-checkin' })
    expect(slot(fromCheckin[0], 'pain')).toEqual({ kind: 'count', n: warn + 1 })
    expect(fromCheckin[0]!.sources.map((s) => s.kind).sort()).toEqual(['activity', 'check-in'])
  })

  test('says where the figure was reported: the run when its rating is the higher or equal, the check-in otherwise', () => {
    const rated = (own: number | null, reported: number | null) =>
      standoutFacts(
        inputFor(run(1, { pain: own }), { checkin: { painScore: reported, painFocalBone: false } }),
      )[0]
    expect(rated(warn + 1, warn)).toMatchObject({ template: 'standout.pain' })
    expect(slot(rated(warn + 1, warn), 'pain')).toEqual({ kind: 'count', n: warn + 1 })
    expect(rated(warn, warn)).toMatchObject({ template: 'standout.pain' })
    expect(rated(null, warn)).toMatchObject({ template: 'standout.pain-checkin' })
    expect(rated(warn - 1, warn + 1)).toMatchObject({ template: 'standout.pain-checkin' })
    // a check-in below the flag score does not take the run's own report from it
    expect(rated(warn, 1)).toMatchObject({ template: 'standout.pain' })
    // the words follow the source, and neither source is called the other
    const own = renderFact(rated(warn, null)!, 'km')
    const checkin = renderFact(rated(null, warn)!, 'km')
    expect(own).toContain('with this run')
    expect(own).not.toContain('check-in')
    expect(checkin).toContain('in the check-in on the day of this run')
    expect(checkin).not.toContain('with this run')
    expect(checkin).toContain(`Pain of ${String(warn)} out of 10`)
  })

  test('focal bone pain is stated at any score, with its own sentence, from the check-in', () => {
    const facts = standoutFacts(
      inputFor(run(1), { checkin: { painScore: null, painFocalBone: true } }),
    )
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ template: 'standout.pain-bone' })
    expect(facts[0]!.sources.map((s) => s.kind).sort()).toEqual(['activity', 'check-in'])
    // no run carries the flag, so the sentence never puts the report on the run, whatever its rating
    const words = renderFact(facts[0]!, 'km')
    expect(words).toContain('in the check-in on the day of this run')
    expect(words).not.toContain('with this run')
    const rated = standoutFacts(
      inputFor(run(1, { pain: 8 }), { checkin: { painScore: 2, painFocalBone: true } }),
    )
    expect(rated[0]).toMatchObject({ template: 'standout.pain-bone' })
  })

  test('comes first whatever else applies', () => {
    const climbing = run(0, { pain: 7, elevationGainM: 500, distanceM: 10_000 })
    const facts = standoutFacts(inputFor(climbing, { history: [run(6, { durationSec: 900 })] }))
    expect(kinds(facts)[0]).toBe('pain')
    expect(kinds(facts)).toContain('grade')
    expect(kinds(rankStandouts(facts).items)[0]).toBe('pain')
  })
})

describe('effort (2 and 3)', () => {
  const [low, high] = P.expectedRpe.easy.value

  test('needs the session the run fulfils', () => {
    expect(standoutFacts(inputFor(run(1, { rpe: 9 })))).toEqual([])
  })

  test('is never printed from heart rate or pace alone', () => {
    const inferred = session({ assessment: assessment({ effort: effort(2, false) }) })
    // The rating is beyond the range too, but the assessment did not lean on it.
    expect(standoutFacts(inputFor(run(1, { rpe: 9 }), { session: inferred }))).toEqual([])
    const noRating = standoutFacts(inputFor(run(1), { session: inferred }))
    expect(kinds(noRating)).not.toContain('effort-harder')
    expect(kinds(noRating)).not.toContain('effort-easier')
  })

  test('harder: the rating lies above the range the plan expects for the kind of session', () => {
    const rated = session({ assessment: assessment({ effort: effort(2, true) }) })
    const facts = standoutFacts(inputFor(run(1, { rpe: high + 3 }), { session: rated }))
    const fact = only(facts, 'effort-harder')
    expect(fact).toMatchObject({ template: 'standout.effort-harder-rpe', rule: 'design-4.2' })
    expect(fact?.slots).toEqual({
      rpe: { kind: 'count', n: high + 3 },
      low: { kind: 'count', n: low },
      high: { kind: 'count', n: high },
    })
    expect(fact?.sources.map((s) => s.kind).sort()).toEqual(['activity', 'session'])
  })

  test('harder, by feel: the runner said it felt harder than expected', () => {
    const rated = session({ assessment: assessment({ effort: effort(1, true) }) })
    const facts = standoutFacts(inputFor(run(1, { feel: 2, rpe: high }), { session: rated }))
    expect(only(facts, 'effort-harder')).toMatchObject({ template: 'standout.effort-harder-feel' })
  })

  test('easier: a rating below the range, or a feel below zero', () => {
    const rated = session({ assessment: assessment({ effort: effort(-1, true) }) })
    const byRpe = standoutFacts(inputFor(run(1, { rpe: low - 1 }), { session: rated }))
    expect(only(byRpe, 'effort-easier')).toMatchObject({ template: 'standout.effort-easier-rpe' })
    const byFeel = standoutFacts(inputFor(run(1, { feel: -2, rpe: low }), { session: rated }))
    expect(only(byFeel, 'effort-easier')).toMatchObject({
      template: 'standout.effort-easier-feel',
    })
  })

  test('says nothing when the rating itself does not point the way of the score', () => {
    // The score leans on the rating overall, but this rating is inside the range and the feel is neutral.
    const rated = session({ assessment: assessment({ effort: effort(1, true) }) })
    expect(standoutFacts(inputFor(run(1, { rpe: high, feel: 0 }), { session: rated }))).toEqual([])
    // A feel of the other sign does not count for a harder verdict.
    expect(standoutFacts(inputFor(run(1, { rpe: high, feel: -1 }), { session: rated }))).toEqual([])
  })

  test('says nothing about a run that matched expectation', () => {
    const matched = session({ assessment: assessment({ effort: effort(0, true) }) })
    expect(standoutFacts(inputFor(run(1, { rpe: high + 3 }), { session: matched }))).toEqual([])
  })
})

describe('heart rate (4 and 5)', () => {
  const minGap = P.standout.hrDeltaMinBpm.value
  // A run at 2.8 m/s on the fixture line.
  const base = (hr: number, over: Partial<Activity> = {}) => steady(0, 2.8, hr, over)
  const expected = hrAt(2.8)

  test('the fixture model is the straight line it was built from', () => {
    expect(MODEL.runs).toBe(9)
    expect(MODEL.interceptBpm + MODEL.slopeBpmPerMps * 2.8).toBeCloseTo(expected, 3)
  })

  test('higher and lower than the runner’s usual at the pace, in beats', () => {
    const higher = standoutFacts(
      inputFor(base(expected + 8), { history: MODEL_RUNS, hrModel: MODEL }),
    )
    expect(only(higher, 'hr-higher')).toMatchObject({ template: 'standout.hr-higher', rule: 'A8' })
    expect(slot(only(higher, 'hr-higher'), 'bpm')).toEqual({ kind: 'bpm', bpm: 8 })
    const lower = standoutFacts(
      inputFor(base(expected - 8), { history: MODEL_RUNS, hrModel: MODEL }),
    )
    expect(only(lower, 'hr-lower')).toMatchObject({ template: 'standout.hr-lower' })
    expect(slot(only(lower, 'hr-lower'), 'bpm')).toEqual({ kind: 'bpm', bpm: 8 })
  })

  test('stays silent inside wrist-sensor error (standout.hrDeltaMinBpm), speaks just beyond it', () => {
    const inside = standoutFacts(inputFor(base(expected + minGap - 0.5), { hrModel: MODEL }))
    expect(kinds(inside)).toEqual([])
    const insideBelow = standoutFacts(inputFor(base(expected - minGap + 0.5), { hrModel: MODEL }))
    expect(kinds(insideBelow)).toEqual([])
    const over = standoutFacts(inputFor(base(expected + minGap + 0.6), { hrModel: MODEL }))
    expect(kinds(over)).toContain('hr-higher')
  })

  test('stays silent inside the scatter of the runner’s own runs', () => {
    const scattered: HrModel = { ...MODEL, residualSdBpm: 9 }
    const facts = standoutFacts(inputFor(base(expected + 6), { hrModel: scattered }))
    expect(kinds(facts)).not.toContain('hr-higher')
  })

  test('allows for the heat, and says so', () => {
    const weather = { tempC: 33, humidityPct: 60 }
    const against = hrAgainstModel(MODEL, base(130, weather))!
    // The expectation rises with the heat; the gap is measured from the raised expectation.
    expect(against.heatExcessC).toBeGreaterThan(0)
    expect(against.expectedBpm).toBeGreaterThan(expected + 3)
    const hot = base(against.expectedBpm + 9, weather)
    const higher = only(standoutFacts(inputFor(hot, { hrModel: MODEL })), 'hr-higher')
    expect(higher).toMatchObject({ template: 'standout.hr-higher-heat' })
    expect(slot(higher, 'bpm')).toEqual({ kind: 'bpm', bpm: 9 })
    const cool = base(against.expectedBpm - 12, weather)
    expect(only(standoutFacts(inputFor(cool, { hrModel: MODEL })), 'hr-lower')).toMatchObject({
      template: 'standout.hr-lower-heat',
    })
    // The same heart rate on a cool day is judged against the cool expectation.
    const cooler = base(against.expectedBpm + 9)
    expect(only(standoutFacts(inputFor(cooler, { hrModel: MODEL })), 'hr-higher')).toMatchObject({
      template: 'standout.hr-higher',
    })
  })

  test('needs the model, a run the model describes and a run inside the model’s window', () => {
    const run8 = base(expected + 9)
    expect(standoutFacts(inputFor(run8, { hrModel: null }))).toEqual([])
    // A race, a hilly run and a short run are not what the model describes.
    for (const over of [{ type: 'race' as const }, { elevationGainM: 900 }, { durationSec: 600 }]) {
      expect(
        kinds(standoutFacts(inputFor(base(expected + 9, over), { hrModel: MODEL }))),
      ).not.toContain('hr-higher')
    }
    const old = steady(P.hrModel.windowWeeks.value * 7 + 2, 2.8, expected + 9)
    expect(kinds(standoutFacts(inputFor(old, { hrModel: MODEL })))).not.toContain('hr-higher')
  })

  test('is left out when the assessment found heart rate unusable for the session', () => {
    const unusable = session({ assessment: assessment({ flags: ['hr-unqualified'] }) })
    const facts = standoutFacts(inputFor(base(expected + 9), { hrModel: MODEL, session: unusable }))
    expect(kinds(facts)).not.toContain('hr-higher')
  })
})

describe('drift (6 and 7)', () => {
  const min = P.a7.thresholdDropAfterMin.value * 60
  const long = (daysAgo: number, drift: number, over: Partial<Activity> = {}) =>
    run(daysAgo, { durationSec: min + 600, tempC: 12, decouplingPct: drift, ...over })
  const comparable = [long(10, 3), long(20, 3.2), long(30, 2.8), long(40, 3)]

  test('more than on comparable long runs, by the difference in percentage points', () => {
    const subject = long(0, 8)
    const facts = standoutFacts(inputFor(subject, { history: comparable }))
    const fact = only(facts, 'drift-more')
    expect(fact).toMatchObject({ template: 'standout.drift-more', rule: 'A7' })
    expect(fact?.slots).toEqual({
      delta: { kind: 'count', n: 5 },
      n: { kind: 'count', n: 4 },
    })
    // The run and the runs it was compared with are the sources.
    expect(fact?.sources.map((s) => s.id).sort()).toEqual(
      [subject.id, ...comparable.map((r) => r.id)].sort(),
    )
  })

  test('less than usual', () => {
    const fact = only(standoutFacts(inputFor(long(0, 0.5), { history: comparable })), 'drift-less')
    expect(fact).toMatchObject({ template: 'standout.drift-less' })
    expect(slot(fact, 'delta')).toEqual({ kind: 'count', n: 2.5 })
  })

  test('needs a difference of standout.driftDeltaPp', () => {
    const delta = P.standout.driftDeltaPp.value
    const typical = 3 // the median of the comparable runs
    expect(
      kinds(standoutFacts(inputFor(long(0, typical + delta - 0.1), { history: comparable }))),
    ).toEqual([])
    expect(
      kinds(standoutFacts(inputFor(long(0, typical + delta), { history: comparable }))),
    ).toEqual(['drift-more'])
  })

  test('only from 90 minutes and below 25 C', () => {
    expect(
      kinds(
        standoutFacts(inputFor(long(0, 9, { durationSec: min - 60 }), { history: comparable })),
      ),
    ).toEqual([])
    expect(
      kinds(
        standoutFacts(
          inputFor(long(0, 9, { tempC: P.a7.heatExcludeC.value }), { history: comparable }),
        ),
      ),
    ).toEqual([])
    expect(
      kinds(standoutFacts(inputFor(long(0, 9, { tempC: null }), { history: comparable }))),
    ).toEqual([])
    expect(
      kinds(standoutFacts(inputFor(long(0, 9, { decouplingPct: null }), { history: comparable }))),
    ).toEqual([])
  })

  test('needs enough comparable runs, and runs that are not comparable do not count', () => {
    const few = comparable.slice(0, P.a7.minComparableRuns.value - 1)
    expect(kinds(standoutFacts(inputFor(long(0, 9), { history: few })))).toEqual([])
    const unlike = [
      long(10, 3, { durationSec: min * 3 - 600 }),
      long(20, 3, { tempC: 24 }),
      long(30, 3, { type: 'race' }),
      ...comparable.slice(0, 2),
    ]
    expect(kinds(standoutFacts(inputFor(long(0, 9), { history: unlike })))).toEqual([])
  })
})

describe('grade (8)', () => {
  const grade = P.standout.gradeNoteMinPct.value
  const climbing = (pct: number) => run(1, { distanceM: 10_000, elevationGainM: pct * 100 })

  test('states the climb, the distance and the average grade', () => {
    const fact = standoutFacts(inputFor(climbing(4.5)))[0]
    expect(fact).toMatchObject({ template: 'standout.grade', rule: 'design-explain' })
    expect(fact?.slots).toEqual({
      gain: { kind: 'climb', m: 450 },
      distance: { kind: 'distance', m: 10_000 },
      grade: { kind: 'percent', pct: 4.5 },
    })
  })

  test('starts at standout.gradeNoteMinPct', () => {
    expect(standoutFacts(inputFor(climbing(grade)))).toHaveLength(1)
    expect(standoutFacts(inputFor(climbing(grade - 0.1)))).toEqual([])
    expect(standoutFacts(inputFor(run(1, { distanceM: null, elevationGainM: 500 })))).toEqual([])
    expect(standoutFacts(inputFor(run(1, { distanceM: 8000, elevationGainM: null })))).toEqual([])
  })
})

describe('efficiency (9)', () => {
  // Five steady runs in the last four weeks, all at 2.8 m/s and 132 bpm.
  const usual = Array.from({ length: 5 }, (_, i) => steady(3 + i * 5, 2.8, 132))
  // Faster runs, further from the subject's pace, that must not be what it is compared with.
  const faster = [steady(6, 3.4, 150), steady(12, 3.4, 150)]

  test('distance per heartbeat against the recent steady runs at a similar pace', () => {
    const better = steady(0, 2.8, 124)
    const fact = only(standoutFacts(inputFor(better, { history: usual })), 'efficiency')
    expect(fact).toMatchObject({ template: 'standout.efficiency-up', rule: 'A8' })
    // 132 / 124 - 1 = 6.5 %.
    expect(slot(fact, 'pct')).toEqual({ kind: 'percent', pct: 6.5 })
    const worse = steady(0, 2.8, 140)
    const down = only(standoutFacts(inputFor(worse, { history: usual })), 'efficiency')
    expect(down).toMatchObject({ template: 'standout.efficiency-down' })
    expect(slot(down, 'pct')).toEqual({ kind: 'percent', pct: 5.7 })
  })

  test('is set against the runs closest in speed, so a faster run is not compared with slower ones', () => {
    const history = [...usual.slice(0, 3), ...faster]
    const better = steady(0, 3.4, 150 - 8)
    const fact = only(standoutFacts(inputFor(better, { history })), 'efficiency')
    // The baseline is the two runs at 3.4 m/s and one slower run (the median is a faster run's):
    // 150 against 142 beats at the same pace is 5.6 % better. Set against all five runs the
    // gap would be a different, speed-driven number.
    expect(slot(fact, 'pct')).toEqual({ kind: 'percent', pct: 5.6 })
    expect(fact?.sources).toHaveLength(1 + P.a8.minRunsPerWindow.value)
    expect(fact?.sources.map((s) => s.id)).toContain(faster[0]!.id)
    expect(fact?.sources.map((s) => s.id)).toContain(faster[1]!.id)
  })

  test('is left out beside a heart-rate finding, which says the same against the model', () => {
    const better = steady(0, 2.8, hrAt(2.8) - 8)
    const facts = standoutFacts(inputFor(better, { history: MODEL_RUNS, hrModel: MODEL }))
    expect(kinds(facts)).toEqual(['hr-lower'])
  })

  test('needs the steady runs of the recent weeks and a gap bigger than a heart-rate gap would be', () => {
    const better = steady(0, 2.8, 124)
    expect(kinds(standoutFacts(inputFor(better, { history: usual.slice(0, 2) })))).toEqual([])
    // One beat at 132 is 0.8 %; hrDeltaMinBpm over the heart rate is 2.3 %.
    const same = steady(0, 2.8, 131)
    expect(kinds(standoutFacts(inputFor(same, { history: usual })))).toEqual([])
    // Runs of the prior window do not count as recent.
    const old = Array.from({ length: 5 }, (_, i) => steady(30 + i * 3, 2.8, 132))
    expect(kinds(standoutFacts(inputFor(better, { history: old })))).toEqual([])
  })

  test('is not made when the look-back reaches before the loaded history', () => {
    const better = steady(0, 2.8, 124)
    const input = inputFor(better, { history: usual, historyFrom: addDays(ASOF, -10) })
    expect(kinds(standoutFacts(input))).toEqual([])
  })
})

describe('longest (10)', () => {
  const weeks = P.standout.longestLookbackWeeks.value

  test('beats every run of the look-back by distance', () => {
    const history = [run(5, { distanceM: 12_000 }), run(20, { distanceM: 18_000 })]
    const fact = standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history }))[0]
    expect(fact).toMatchObject({ template: 'standout.longest-distance', rule: 'design-explain' })
    expect(fact?.slots).toEqual({
      distance: { kind: 'distance', m: 21_000 },
      weeks: { kind: 'count', n: weeks },
    })
    // The run it beat is a source, so the Why can show it.
    expect(fact?.sources.map((s) => s.id)).toContain(history[1]!.id)
    expect(fact?.window).toEqual({ from: addDays(ASOF, -weeks * 7), to: ASOF })
  })

  test('the sentence restates the Param, not a number of its own', () => {
    const history = [run(5, { distanceM: 12_000 })]
    const fact = standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history }))[0]!
    expect(renderFact(fact, 'km')).toBe(
      `At 21 km, this is your longest run in the last ${String(weeks)} weeks.`,
    )
    expect(renderFact(fact, 'mi')).toBe(
      `At 13 mi, this is your longest run in the last ${String(weeks)} weeks.`,
    )
  })

  test('is not the longest when a run of the look-back is longer or equal; older runs do not count', () => {
    const longer = [run(30, { distanceM: 25_000 })]
    expect(standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history: longer }))).toEqual([])
    const equal = [run(30, { distanceM: 21_000 })]
    expect(standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history: equal }))).toEqual([])
    const outside = [run(weeks * 7 + 1, { distanceM: 40_000 }), run(10, { distanceM: 8000 })]
    expect(
      kinds(standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history: outside }))),
    ).toEqual(['longest'])
  })

  test('by time when no distance beats it', () => {
    const history = [run(5, { distanceM: 12_000, durationSec: 3000 })]
    const slow = run(0, { distanceM: 9000, durationSec: 5400 })
    const fact = standoutFacts(inputFor(slow, { history }))[0]
    expect(fact).toMatchObject({ template: 'standout.longest-duration' })
    expect(slot(fact, 'duration')).toEqual({ kind: 'duration', sec: 5400 })
    const noDistance = run(0, { distanceM: null, durationSec: 5400 })
    expect(standoutFacts(inputFor(noDistance, { history }))[0]).toMatchObject({
      template: 'standout.longest-duration',
    })
  })

  test('needs a run to beat and a look-back inside the loaded history', () => {
    expect(standoutFacts(inputFor(run(0, { distanceM: 21_000 })))).toEqual([])
    const history = [run(5, { distanceM: 12_000 })]
    const clipped = inputFor(run(0, { distanceM: 21_000 }), {
      history,
      historyFrom: addDays(ASOF, -(weeks * 7 - 1)),
    })
    expect(standoutFacts(clipped)).toEqual([])
  })

  test('counts neither a duplicate nor a run after the day', () => {
    const history = [
      run(5, { distanceM: 30_000, duplicateStatus: 'confirmed' }),
      run(-3, { distanceM: 30_000 }),
      run(8, { distanceM: 12_000 }),
    ]
    expect(kinds(standoutFacts(inputFor(run(0, { distanceM: 21_000 }), { history })))).toEqual([
      'longest',
    ])
  })
})

describe('completion (11)', () => {
  const planned = 40

  test('much less, and much more, time than the session planned', () => {
    const partial = session({
      durationMin: planned,
      assessment: assessment({ completion: 'partial' }),
    })
    const less = standoutFacts(inputFor(run(0, { durationSec: 20 * 60 }), { session: partial }))
    expect(less[0]).toMatchObject({ template: 'standout.ran-less', rule: 'design-4.2' })
    expect(less[0]?.slots).toEqual({
      actual: { kind: 'minutes', min: 20 },
      planned: { kind: 'minutes', min: planned },
    })
    const extended = session({
      durationMin: planned,
      assessment: assessment({ completion: 'extended' }),
    })
    const more = standoutFacts(inputFor(run(0, { durationSec: 60 * 60 }), { session: extended }))
    expect(more[0]).toMatchObject({ template: 'standout.ran-more' })
  })

  test('nothing for a session done as planned or a different kind of activity', () => {
    for (const completion of ['completed', 'modified'] as const) {
      const done = session({ assessment: assessment({ completion }) })
      expect(standoutFacts(inputFor(run(0), { session: done }))).toEqual([])
    }
  })
})

describe('ranking', () => {
  function fact(kind: StandoutKind): InputFact {
    return {
      id: `a8.${kind}`,
      template: 'standout.pain-bone',
      slots: {},
      rule: 'A8',
      sources: [],
      moreSources: 0,
      state: 'used',
    }
  }

  test('puts the eleven in the order of the design, whatever order they arrive in', () => {
    const shuffled = [...STANDOUT_KINDS].reverse().map(fact)
    expect(kinds(orderStandouts(shuffled))).toEqual([...STANDOUT_KINDS])
  })

  test('keeps the first STANDOUT_MAX_CARDS and counts the rest', () => {
    const all = STANDOUT_KINDS.map(fact)
    const ranked = rankStandouts(all)
    expect(ranked.items).toHaveLength(STANDOUT_MAX_CARDS)
    expect(STANDOUT_MAX_CARDS).toBe(3)
    expect(ranked.more).toBe(STANDOUT_KINDS.length - STANDOUT_MAX_CARDS)
    expect(kinds(ranked.items)).toEqual(['pain', 'effort-harder', 'effort-easier'])
    expect(rankStandouts(all.slice(0, 2))).toMatchObject({ more: 0 })
    expect(rankStandouts([])).toEqual({ items: [], more: 0 })
  })

  test('a fact of an unknown kind goes last', () => {
    const odd = { ...fact('pain'), id: 'a8.something-new' }
    expect(kinds(orderStandouts([odd, fact('longest')]))).toEqual(['longest', 'unknown'])
  })

  test('does not reorder or mutate its input', () => {
    const input = [fact('longest'), fact('pain')]
    const copy = JSON.parse(JSON.stringify(input)) as InputFact[]
    orderStandouts(input)
    rankStandouts(input)
    expect(input).toEqual(copy)
  })
})

describe('a run with several findings', () => {
  /** Pain, heart rate, the longest run of the look-back and a longer session than planned. */
  function busyRun(): StandoutInput {
    const subject = steady(0, 3, hrAt(3) + 9, { pain: 6, durationSec: 3000, distanceM: 9000 })
    return inputFor(subject, {
      history: MODEL_RUNS,
      hrModel: MODEL,
      session: session({
        durationMin: 40,
        assessment: assessment({ completion: 'extended' }),
      }),
    })
  }

  test('keeps three of them in rank order and counts the others', () => {
    const facts = standoutFacts(busyRun())
    expect(kinds(facts)).toEqual(['pain', 'hr-higher', 'longest', 'completion'])
    const ranked = rankStandouts(facts)
    expect(kinds(ranked.items)).toEqual(['pain', 'hr-higher', 'longest'])
    expect(ranked.more).toBe(1)
  })
})

describe('purity', () => {
  function frozen<T>(value: T): T {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) frozen(child)
    return Object.freeze(value)
  }

  test('the same input gives the same facts and nothing is changed', () => {
    const subject = steady(0, 2.8, hrAt(2.8) + 9, {
      pain: 5,
      elevationGainM: 700,
      distanceM: 20_000,
    })
    const input = frozen(
      inputFor(subject, {
        history: [...MODEL_RUNS, run(3, { distanceM: 9000 })],
        hrModel: MODEL,
        session: session({
          assessment: assessment({ completion: 'partial', effort: effort(1, true) }),
        }),
        checkin: { painScore: 2, painFocalBone: false },
      }),
    )
    const first = standoutFacts(input)
    expect(first.length).toBeGreaterThan(2)
    expect(standoutFacts(input)).toEqual(first)
  })

  test('the version is a positive whole number', () => {
    expect(Number.isInteger(STANDOUT_VERSION)).toBe(true)
    expect(STANDOUT_VERSION).toBeGreaterThan(0)
  })
})

describe('the sentences', () => {
  /** A small seeded generator, so a failure reproduces. */
  function lcg(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
      return state / 4_294_967_296
    }
  }

  function randomInput(next: () => number, n: number): StandoutInput {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
    const between = (lo: number, hi: number) => lo + next() * (hi - lo)
    const history = [
      ...MODEL_RUNS,
      ...Array.from({ length: 6 }, (_, i) =>
        run(2 + i * 9, {
          distanceM: Math.round(between(3000, 30_000)),
          durationSec: Math.round(between(1500, 9000)),
          decouplingPct: between(-2, 9),
          tempC: between(2, 28),
        }),
      ),
    ]
    const durationSec = Math.round(between(1200, 11_000))
    const speed = between(2.2, 3.6)
    const subject = steady(0, speed, hrAt(speed) + between(-14, 14), {
      id: `fuzz${n}`,
      durationSec,
      distanceM: Math.round(speed * durationSec),
      elevationGainM: Math.round(between(0, 1400)),
      pain: next() < 0.3 ? Math.round(between(0, 10)) : null,
      rpe: next() < 0.6 ? Math.round(between(1, 10)) : null,
      feel: next() < 0.5 ? pick([-2, -1, 0, 1, 2] as const) : null,
      decouplingPct: between(-3, 12),
      tempC: next() < 0.7 ? between(0, 36) : null,
      humidityPct: next() < 0.5 ? Math.round(between(20, 95)) : null,
    })
    const score = pick([-2, -1, 0, 1, 2] as const)
    return inputFor(subject, {
      history,
      hrModel: next() < 0.8 ? MODEL : null,
      session:
        next() < 0.7
          ? session({
              kind: pick(['easy', 'long', 'threshold', 'recovery'] as const),
              durationMin: Math.round(between(20, 150)),
              assessment: assessment({
                completion: pick(['completed', 'partial', 'extended', 'modified'] as const),
                effort: effort(score, next() < 0.7),
                flags: next() < 0.2 ? ['hr-unqualified'] : [],
              }),
            })
          : null,
      checkin:
        next() < 0.3 ? { painScore: Math.round(between(0, 9)), painFocalBone: next() < 0.2 } : null,
    })
  }

  test('50 fuzzed runs render in both unit systems, short, clean and with no placeholder left', () => {
    const next = lcg(20_261_023)
    let rendered = 0
    const seen = new Set<string>()
    for (let n = 0; n < 50; n += 1) {
      const facts = standoutFacts(randomInput(next, n))
      for (const fact of facts) {
        seen.add(fact.template)
        for (const units of ['km', 'mi'] as const) {
          const text = renderFact(fact, units)
          expect(lintText(text), text).toEqual([])
          expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS)
          expect(text, text).not.toMatch(/undefined|NaN|\{|\}|\d{4}-\d{2}-\d{2}/)
          expect(text.endsWith('.'), text).toBe(true)
          rendered += 1
        }
      }
    }
    expect(rendered).toBeGreaterThan(100)
    // The fuzz reaches many of the sentences, not one or two.
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })

  test('the card renders each fact with the name and rules of its Why button', () => {
    const subject = steady(0, 3, hrAt(3) + 9, { pain: 6, durationSec: 3000, distanceM: 9000 })
    const view = rankStandouts(
      standoutFacts(inputFor(subject, { history: MODEL_RUNS, hrModel: MODEL })),
    )
    const cards = renderStandouts(view, 'mi')
    expect(cards.map((card) => card.subject)).toEqual(['pain', 'heart rate', 'longest run'])
    expect(cards[1]!.rules).toEqual(['A8', 'design-explain'])
    expect(cards[2]!.rules).toEqual(['design-explain'])
    expect(cards[2]!.text).toMatch(/At 5\.6 mi,/)
    expect(renderStandouts(view, 'km')[2]!.text).toMatch(/At 9 km,/)
    for (const card of cards) expect(lintText(`${card.text} ${card.subject}`)).toEqual([])
  })
})
