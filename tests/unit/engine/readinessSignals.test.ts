import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS, SIGNAL_LIMIT } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  poorSubjective,
  readinessSignals,
  readinessSnapshot,
  readinessVerdict,
  strongestAdvice,
  todayAdvice,
} from '../../../shared/engine/readiness.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import type { ReadinessSignal, TodayAdvice, Units } from '../../../shared/types.ts'
import { activity, hrvSeries, input, spec, STEADY_HRV, TODAY, wellnessDay } from './e8-fixtures.ts'

const YESTERDAY = addDays(TODAY, -1)
const NORMAL = { fatigue: 3, soreness: 3, sleepQuality: 3, mood: 3, stress: 3 }
const POOR = { fatigue: 5, soreness: 4, sleepQuality: 2, mood: 2, stress: 4 }

/** Ten steady HRV readings ending two days before today, so today and yesterday are free. */
const baseline = () => hrvSeries(addDays(TODAY, -1), STEADY_HRV)

/** Ten resting heart rates of 50 ending yesterday. */
const restingBase = () =>
  Array.from({ length: 10 }, (_, n) => wellnessDay(addDays(TODAY, -(10 - n)), { restingHr: 50 }))

/** One row per date: the non-null fields of every row given for that date. */
function merge(...rows: Array<ReturnType<typeof wellnessDay>>) {
  const byDate = new Map<string, ReturnType<typeof wellnessDay>>()
  for (const row of rows) {
    const kept = byDate.get(row.date) ?? row
    const fields = Object.entries(row).filter(([, value]) => value !== null && value !== undefined)
    byDate.set(row.date, { ...kept, ...Object.fromEntries(fields) })
  }
  return [...byDate.values()]
}

/** Seven nights of the same length ending today. */
const nights = (hours: number, count = 7) =>
  Array.from({ length: count }, (_, n) =>
    wellnessDay(addDays(TODAY, -n), { sleepSec: hours * 3600 }),
  )

const signals = (i: EngineInput) => readinessSignals(i, TODAY)
const codes = (list: ReadinessSignal[]) => list.map((s) => s.code)
const text = (signal: ReadinessSignal, units: Units = 'km') => renderFact(signal, units)
const only = (i: EngineInput): ReadinessSignal => {
  const list = signals(i)
  expect(list).toHaveLength(1)
  return list[0]!
}

/** The usual HRV range as the rule words it, worked out here from the raw series. */
function usualHrvRange(values: number[]): [number, number] {
  const logs = values.map(Math.log)
  const mean = logs.reduce((sum, v) => sum + v, 0) / logs.length
  const sd = Math.sqrt(logs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (logs.length - 1))
  const band = P.j4.sdBelowMean.value * sd
  return [Math.round(Math.exp(mean - band)), Math.round(Math.exp(mean + band))]
}

describe('readinessSignals', () => {
  it('gives nothing without data, and nothing for a day with only a weight or notes', () => {
    expect(signals(input())).toEqual([])
    expect(signals(input({ wellness: [wellnessDay(TODAY, { weightKg: 70 })] }))).toEqual([])
  })

  it('keeps the limit the page shows at three', () => {
    expect(SIGNAL_LIMIT).toBe(3)
  })

  describe('HRV', () => {
    it('shows a low reading in ms against the usual range, as noted', () => {
      const [low, high] = usualHrvRange(STEADY_HRV)
      const signal = only(
        input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40 })] }),
      )
      expect(signal).toMatchObject({
        code: 'hrv',
        noted: true,
        template: 'today.signal.hrv-low',
        slots: {
          latest: { kind: 'count', n: 40 },
          low: { kind: 'count', n: low },
          high: { kind: 'count', n: high },
        },
      })
      expect(text(signal)).toBe(
        `HRV has dropped to 40 ms. Your usual range is ${String(low)} to ${String(high)} ms.`,
      )
    })

    it('takes the range from exp(mean ± sdBelowMean × sd), not from a hand-picked band', () => {
      const [low, high] = usualHrvRange(STEADY_HRV)
      expect(low).toBeLessThan(60)
      expect(high).toBeGreaterThan(60)
      const signal = only(
        input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 61 })] }),
      )
      expect(signal.slots).toMatchObject({ low: { n: low }, high: { n: high } })
    })

    it('shows an ordinary reading as not noted', () => {
      const signal = only(
        input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 61 })] }),
      )
      expect(signal).toMatchObject({ code: 'hrv', noted: false, template: 'today.signal.hrv' })
      expect(text(signal)).toMatch(/^HRV is 61 ms\. Your usual range is \d+ to \d+ ms\.$/)
    })

    it('says the range is still being built below the minimum number of readings', () => {
      const wellness = [
        ...hrvSeries(addDays(TODAY, -1), STEADY_HRV.slice(0, 6)),
        wellnessDay(TODAY, { hrvRmssd: 55 }),
      ]
      const signal = only(input({ wellness }))
      expect(signal).toMatchObject({
        code: 'hrv',
        noted: false,
        template: 'today.signal.hrv-building',
        slots: { readings: { n: 7 }, needed: { n: P.j4.minReadings.value } },
      })
      expect(text(signal)).toBe('Building your usual HRV range (7 of 10 readings).')
    })

    it('gives no HRV signal for a day without a reading once the range exists', () => {
      expect(signals(input({ wellness: baseline() }))).toEqual([])
    })

    it('never uses SDNN', () => {
      const wellness = baseline().map((w) => ({ ...w, hrvRmssd: null, hrvSdnn: w.hrvRmssd }))
      expect(signals(input({ wellness }))).toEqual([])
    })
  })

  describe('resting heart rate', () => {
    it('names a high reading with how far above the usual it is, as noted', () => {
      const signal = only(
        input({ wellness: [...restingBase(), wellnessDay(TODAY, { restingHr: 58 })] }),
      )
      expect(signal).toMatchObject({
        code: 'resting-hr',
        noted: true,
        template: 'today.signal.resting-hr-high',
        slots: {
          latest: { kind: 'bpm', bpm: 58 },
          usual: { kind: 'bpm', bpm: 50 },
          above: { kind: 'bpm', bpm: 8 },
        },
      })
      expect(text(signal)).toBe('Resting heart rate is 58 bpm, 8 bpm above your usual 50 bpm.')
    })

    it('shows an ordinary reading against the usual, not noted', () => {
      const signal = only(
        input({ wellness: [...restingBase(), wellnessDay(TODAY, { restingHr: 51 })] }),
      )
      expect(signal).toMatchObject({ noted: false, template: 'today.signal.resting-hr' })
      expect(text(signal)).toBe('Resting heart rate is 51 bpm. Your usual is about 50 bpm.')
    })

    it('shows the reading alone while the baseline is too short', () => {
      const signal = only(input({ wellness: [wellnessDay(TODAY, { restingHr: 52 })] }))
      expect(signal).toMatchObject({ noted: false, template: 'today.signal.resting-hr-only' })
      expect(text(signal)).toBe('Resting heart rate is 52 bpm.')
    })

    it('gives the difference between the rounded figures, so the sentence adds up', () => {
      const base = Array.from({ length: 10 }, (_, n) =>
        wellnessDay(addDays(TODAY, -(10 - n)), { restingHr: n % 2 === 0 ? 50 : 51 }),
      )
      const signal = only(input({ wellness: [...base, wellnessDay(TODAY, { restingHr: 56 })] }))
      // Baseline mean 50.5 rounds to 51; 56 is 5.5 above it and 5 above the rounded figure.
      expect(signal.slots).toMatchObject({
        latest: { bpm: 56 },
        usual: { bpm: 51 },
        above: { bpm: 5 },
      })
    })
  })

  describe('sleep', () => {
    it('names a short average with the floor, as noted', () => {
      const signal = only(input({ wellness: nights(6) }))
      expect(signal).toMatchObject({
        code: 'sleep',
        noted: true,
        template: 'today.signal.sleep-low',
        slots: {
          hours: { kind: 'duration', sec: 6 * 3600 },
          nights: { n: 7 },
          floor: { kind: 'duration', sec: P.j5.sleepWarnHours.value * 3600 },
        },
      })
      expect(text(signal)).toBe('Sleep averaged 6 h across 7 recent nights, under 7 h.')
    })

    it('shows enough sleep as not noted', () => {
      const signal = only(input({ wellness: nights(7.5) }))
      expect(signal).toMatchObject({ noted: false, template: 'today.signal.sleep' })
      expect(text(signal)).toBe('Sleep averaged 7 h 30 min across 7 recent nights.')
    })

    it('counts the nights that were recorded, not the nights asked for', () => {
      const signal = only(input({ wellness: nights(6, 5) }))
      expect(signal.slots).toMatchObject({ nights: { n: 5 } })
    })

    it('gives no signal with too few recorded nights', () => {
      expect(signals(input({ wellness: nights(5, P.j5.sleepMinNights.value - 1) }))).toEqual([])
    })
  })

  describe('check-in', () => {
    it.each([
      [1, 'fresh'],
      [2, 'good'],
      [3, 'normal'],
      [4, 'tired'],
      [5, 'drained'],
    ])('reads fatigue %i as %s', (fatigue, word) => {
      const signal = only(input({ wellness: [wellnessDay(TODAY, { fatigue })] }))
      expect(signal).toMatchObject({ code: 'checkin', template: `today.signal.checkin-${word}` })
      expect(text(signal)).toBe(`Check-in: feeling ${word}.`)
    })

    it('notes a poor check-in and leaves an ordinary one', () => {
      const poor = only(input({ wellness: [wellnessDay(TODAY, POOR)] }))
      expect(poor).toMatchObject({ noted: true, template: 'today.signal.checkin-drained' })
      const normal = only(input({ wellness: [wellnessDay(TODAY, NORMAL)] }))
      expect(normal.noted).toBe(false)
    })

    it('notes exactly what the readiness rules call a poor subjective score', () => {
      for (const answers of [NORMAL, POOR, { fatigue: 4 }, { fatigue: 5 }, { mood: 1 }]) {
        const i = input({ wellness: [wellnessDay(TODAY, answers)] })
        const checkin = readinessSnapshot(i, TODAY).checkin
        expect(signals(i)[0]!.noted, JSON.stringify(answers)).toBe(poorSubjective(checkin))
      }
    })

    it('summarises a check-in that skipped the fatigue answer', () => {
      const ordinary = only(input({ wellness: [wellnessDay(TODAY, { mood: 3 })] }))
      expect(ordinary).toMatchObject({ noted: false, template: 'today.signal.checkin-items' })
      const low = only(input({ wellness: [wellnessDay(TODAY, { mood: 1, sleepQuality: 1 })] }))
      expect(low).toMatchObject({ noted: true, template: 'today.signal.checkin-items-low' })
    })

    it('leaves a check-in that only reports pain or illness to the pain and illness signals', () => {
      const pain = signals(input({ wellness: [wellnessDay(TODAY, { painScore: 5 })] }))
      expect(codes(pain)).toEqual(['pain'])
      const ill = signals(input({ wellness: [wellnessDay(TODAY, { illness: true })] }))
      expect(codes(ill)).toEqual(['illness'])
    })

    it('ignores a check-in from another day', () => {
      expect(signals(input({ wellness: [wellnessDay(YESTERDAY, POOR)] }))).toEqual([])
    })
  })

  describe('illness and pain', () => {
    const ill = (daysAgo: number) =>
      input({ wellness: [wellnessDay(addDays(TODAY, -daysAgo), { illness: true })] })

    it('names illness while the gate is closed, as noted', () => {
      expect(only(ill(0))).toMatchObject({
        code: 'illness',
        noted: true,
        template: 'today.signal.illness-rest',
      })
      expect(only(ill(1)).template).toBe('today.signal.illness-rest')
      for (const daysAgo of [2, 3, 4]) {
        expect(only(ill(daysAgo)).template, `${String(daysAgo)} days ago`).toBe(
          'today.signal.illness-easy',
        )
      }
      expect(signals(ill(5))).toEqual([])
    })

    it('names pain with its score, noted from the red-flag score', () => {
      const flagged = only(input({ wellness: [wellnessDay(TODAY, { painScore: 5 })] }))
      expect(flagged).toMatchObject({
        code: 'pain',
        noted: true,
        template: 'today.signal.pain',
        slots: { score: { kind: 'count', n: 5 } },
      })
      expect(text(flagged)).toBe('Pain of 5 out of 10 was reported.')
      const mild = only(input({ wellness: [wellnessDay(TODAY, { painScore: 2 })] }))
      expect(mild.noted).toBe(false)
      const edge = only(
        input({ wellness: [wellnessDay(TODAY, { painScore: P.pain.flagScore.value })] }),
      )
      expect(edge.noted).toBe(true)
    })

    it('gives no pain signal for a score of zero', () => {
      expect(signals(input({ wellness: [wellnessDay(TODAY, { painScore: 0 })] }))).toEqual([])
    })

    it('reads pain from yesterday and from an activity, as the red flag does', () => {
      expect(
        only(input({ wellness: [wellnessDay(YESTERDAY, { painScore: 6 })] })).slots,
      ).toMatchObject({ score: { n: 6 } })
      expect(only(input({ activities: [activity(YESTERDAY, { pain: 6 })] })).code).toBe('pain')
    })

    it('puts focal bone pain ahead of a score and keeps it over days without a check-in', () => {
      const today = only(
        input({ wellness: [wellnessDay(TODAY, { painScore: 2, painFocalBone: true })] }),
      )
      expect(today).toMatchObject({ noted: true, template: 'today.signal.pain-bone' })
      const earlier = only(
        input({
          wellness: [wellnessDay(addDays(TODAY, -6), { painScore: 2, painFocalBone: true })],
        }),
      )
      expect(earlier.template).toBe('today.signal.pain-bone')
    })
  })

  describe('order and limit', () => {
    const everything = () =>
      input({
        wellness: merge(
          ...baseline(),
          ...restingBase(),
          ...nights(6),
          wellnessDay(TODAY, {
            illness: true,
            painScore: 6,
            hrvRmssd: 40,
            restingHr: 60,
            ...POOR,
          }),
        ),
      })

    it('keeps at most SIGNAL_LIMIT, in the order illness, pain, HRV, resting HR, sleep, check-in', () => {
      const all = everything()
      const list = signals(all)
      expect(list).toHaveLength(SIGNAL_LIMIT)
      expect(codes(list)).toEqual(['illness', 'pain', 'hrv'])
      expect(list.every((s) => s.noted)).toBe(true)
    })

    it('puts every noted reading ahead of every ordinary one', () => {
      const i = input({
        wellness: merge(...baseline(), ...nights(6), wellnessDay(TODAY, { hrvRmssd: 61, ...POOR })),
      })
      const list = signals(i)
      expect(codes(list)).toEqual(['sleep', 'checkin', 'hrv'])
      expect(list.map((s) => s.noted)).toEqual([true, true, false])
    })

    it('keeps the fixed order among ordinary readings and drops the rest', () => {
      const i = input({
        wellness: merge(
          ...baseline(),
          ...restingBase(),
          ...nights(7.5),
          wellnessDay(TODAY, { hrvRmssd: 61, restingHr: 51, ...NORMAL }),
        ),
      })
      const list = signals(i)
      expect(codes(list)).toEqual(['hrv', 'resting-hr', 'sleep'])
      expect(list.every((s) => !s.noted)).toBe(true)
    })

    it('is deterministic and leaves the input alone', () => {
      const i = everything()
      const before = JSON.stringify(i)
      expect(signals(i)).toEqual(signals(i))
      expect(JSON.stringify(i)).toBe(before)
    })
  })

  describe('copy', () => {
    const scenarios: Record<string, EngineInput> = {
      'low HRV': input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40 })] }),
      'building HRV': input({ wellness: [wellnessDay(TODAY, { hrvRmssd: 55 })] }),
      'high resting heart rate': input({
        wellness: [...restingBase(), wellnessDay(TODAY, { restingHr: 60 })],
      }),
      'short sleep': input({ wellness: nights(5.5) }),
      'poor check-in': input({ wellness: [wellnessDay(TODAY, POOR)] }),
      illness: input({ wellness: [wellnessDay(TODAY, { illness: true })] }),
      pain: input({ wellness: [wellnessDay(TODAY, { painScore: 7 })] }),
      'bone pain': input({ wellness: [wellnessDay(TODAY, { painFocalBone: true })] }),
    }

    it.each(Object.keys(scenarios))('%s renders clean in both unit systems', (name) => {
      const list = signals(scenarios[name]!)
      expect(list.length).toBeGreaterThan(0)
      for (const signal of list) {
        expect(Object.hasOwn(TEMPLATES, signal.template), signal.template).toBe(true)
        for (const units of ['km', 'mi'] as const) {
          const sentence = text(signal, units)
          expect(lintText(sentence), sentence).toEqual([])
          expect(sentence.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
          expect(sentence).not.toMatch(/NaN|undefined|null/)
        }
      }
    })
  })
})

describe('strongestAdvice', () => {
  it('ranks rest over an easy run over as planned', () => {
    expect(strongestAdvice([])).toBe('as-planned')
    expect(strongestAdvice(['as-planned', 'as-planned'])).toBe('as-planned')
    expect(strongestAdvice(['as-planned', 'downgrade-easy'])).toBe('downgrade-easy')
    expect(strongestAdvice(['downgrade-easy', 'rest', 'as-planned'])).toBe('rest')
  })
})

describe('readinessVerdict', () => {
  const verdict = (
    advice: TodayAdvice,
    state: 'normal' | 'possible-fatigue' | 'persistent-suppression',
    signalCount: number,
  ) => readinessVerdict({ advice, state, signalCount })

  it('maps the six situations to the six sentences of the design', () => {
    const cases = [
      [verdict('as-planned', 'normal', 2), 'ready', 'Ready as planned.'],
      [
        verdict('as-planned', 'possible-fatigue', 3),
        'low-stays',
        "Signals are a little low. Today's session is already easy, so it stays.",
      ],
      [
        verdict('downgrade-easy', 'possible-fatigue', 3),
        'easy',
        'An easy run is the better choice today.',
      ],
      [verdict('rest', 'normal', 1), 'rest', 'A rest day is the better choice today.'],
      [
        verdict('as-planned', 'persistent-suppression', 3),
        'lighter-week',
        'Recent signals have stayed low for several days. A lighter week may help.',
      ],
      [
        verdict('as-planned', 'normal', 0),
        'no-signals',
        'No readiness signals yet. One tap below adds the first.',
      ],
    ] as const
    for (const [result, code, sentence] of cases) {
      expect(result.code).toBe(code)
      expect(result.slots).toEqual({})
      expect(renderFact(result, 'km')).toBe(sentence)
    }
  })

  it('lets the strongest advice win over the fatigue state and the signal count', () => {
    expect(verdict('rest', 'persistent-suppression', 0).code).toBe('rest')
    expect(verdict('downgrade-easy', 'persistent-suppression', 0).code).toBe('easy')
    expect(verdict('as-planned', 'persistent-suppression', 0).code).toBe('lighter-week')
    expect(verdict('as-planned', 'possible-fatigue', 0).code).toBe('low-stays')
  })

  it('reads clean for every combination of advice, state and signal count', () => {
    for (const advice of ['as-planned', 'downgrade-easy', 'rest'] as const) {
      for (const state of ['normal', 'possible-fatigue', 'persistent-suppression'] as const) {
        for (const signalCount of [0, 1, 3]) {
          const sentence = renderFact(verdict(advice, state, signalCount), 'km')
          expect(lintText(sentence), sentence).toEqual([])
          expect(sentence.length).toBeLessThanOrEqual(COPY_MAX_CHARS)
        }
      }
    }
  })

  describe('from the engine, end to end', () => {
    const hardSession = (date: string) => ({ ...spec(date, 'threshold'), id: 'q' })
    function read(i: EngineInput, session = hardSession(TODAY)) {
      const advice = strongestAdvice(todayAdvice(i, [session]).map((row) => row.advice))
      const list = readinessSignals(i, TODAY)
      return readinessVerdict({
        advice,
        state: readinessSnapshot(i, TODAY).state,
        signalCount: list.length,
      })
    }

    it('says an easy run is better after a poor night with a hard session planned', () => {
      const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40, ...POOR })] })
      expect(read(i).code).toBe('easy')
    })

    it('says rest on the day illness is reported', () => {
      const i = input({ wellness: [wellnessDay(TODAY, { illness: true })] })
      expect(read(i).code).toBe('rest')
    })

    it('says the day stays when signals are low and the session is already easy', () => {
      const i = input({ wellness: [wellnessDay(YESTERDAY, POOR), wellnessDay(TODAY, POOR)] })
      expect(read(i, { ...spec(TODAY, 'easy'), id: 'e' }).code).toBe('low-stays')
    })

    it('suggests a lighter week after fourteen low days', () => {
      const wellness = Array.from({ length: 14 }, (_, n) => wellnessDay(addDays(TODAY, -n), POOR))
      expect(read(input({ wellness }), { ...spec(TODAY, 'easy'), id: 'e' }).code).toBe(
        'lighter-week',
      )
    })

    it('asks for a first check-in when nothing is known, and reads ready on a normal day', () => {
      expect(read(input()).code).toBe('no-signals')
      expect(read(input({ wellness: [wellnessDay(TODAY, NORMAL)] })).code).toBe('ready')
    })
  })
})
