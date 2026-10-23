import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  describeIssue,
  describeWindow,
  issueFact,
  WINDOW_TEMPLATES,
  windowFacts,
  windowRuleFact,
} from '../../../shared/copy/revision.ts'
import { renderFact, TEMPLATES } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import { breakRestart } from '../../../shared/engine/adapt.ts'
import {
  dayRuleOn,
  disruptionPlan,
  disruptionWeekCap,
  heldDates,
  illnessGate,
  injuryReportOf,
  RUN_CAP_MAX_MIN,
  restartFraction,
  restSessions,
  validateDisruption,
  windowPhase,
  type DisruptionDraft,
  type DisruptionIssueCode,
  type DisruptionPlan,
} from '../../../shared/engine/disruption.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { illnessPhase } from '../../../shared/engine/readiness.ts'
import type { DisruptionWindow } from '../../../shared/engine/types.ts'
import type { DisruptionReason } from '../../../shared/types.ts'
import { input, wellnessDay } from './e8-fixtures.ts'

// October 2026: the 19th is a Monday, the 26th the next one, 2 November the one after.
const MON = '2026-10-19'
const TODAY = '2026-10-23'

function win(over: Partial<DisruptionWindow> = {}): DisruptionWindow {
  return {
    id: 'w1',
    reason: 'travel',
    mode: 'rest',
    startDate: MON,
    endDate: addDays(MON, 2),
    maxRunMin: null,
    pain: null,
    gaitChange: false,
    ...over,
  }
}

/** A window of `days` days from `start`, resting. */
function rest(start: string, days: number, over: Partial<DisruptionWindow> = {}): DisruptionWindow {
  return win({ startDate: start, endDate: addDays(start, days - 1), ...over })
}

function plan(...windows: DisruptionWindow[]): DisruptionPlan {
  return disruptionPlan(windows)
}

/** Runs `fn` with a Param set to `value`, then puts it back. */
function withValue<T>(param: { value: number }, value: number, fn: () => T): T {
  const before = param.value
  param.value = value
  try {
    return fn()
  } finally {
    param.value = before
  }
}

function dates(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

describe('the module', () => {
  const source = readFileSync(
    join(import.meta.dirname, '../../../shared/engine/disruption.ts'),
    'utf8',
  )

  it('imports only Params, dates and types', () => {
    const specifiers = [...source.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1])
    expect(specifiers.sort()).toEqual([
      '../dates.ts',
      '../types.ts',
      './params/index.ts',
      './types.ts',
    ])
    const valueImports = [...source.matchAll(/^import (?!type)[^;]*?from '([^']+)'/gms)].map(
      (m) => m[1],
    )
    expect(valueImports.sort()).toEqual(['../dates.ts', './params/index.ts'])
  })

  it('reads no clock, no randomness and no outside world', () => {
    for (const forbidden of [
      'Date.now',
      'new Date',
      'Math.random',
      'process.',
      'node:',
      'fetch(',
    ]) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })

  it('gives equal output for equal input, whatever the order of the windows', () => {
    const windows = [
      win({
        id: 'a',
        reason: 'illness-above-neck',
        startDate: '2026-10-20',
        endDate: '2026-10-22',
      }),
      win({ id: 'b', reason: 'niggle', startDate: '2026-10-22', endDate: '2026-10-25', pain: 6 }),
      win({
        id: 'c',
        mode: 'limited',
        maxRunMin: 30,
        startDate: '2026-10-24',
        endDate: '2026-10-28',
      }),
    ]
    const first = disruptionPlan(windows)
    expect(disruptionPlan(windows)).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    const shuffled = disruptionPlan([windows[2]!, windows[0]!, windows[1]!])
    expect(shuffled.days).toEqual(first.days)
    expect(shuffled.holds).toEqual(first.holds)
    expect([...shuffled.injuryReports]).toEqual(first.injuryReports)
    expect(shuffled.windows.map((w) => w.id)).toEqual(['c', 'a', 'b'])
  })

  it('has no days, holds or reports without windows', () => {
    expect(disruptionPlan([])).toEqual({ windows: [], days: [], holds: [], injuryReports: [] })
  })

  it('leaves out a window with a false date or a last day before the first', () => {
    const p = plan(
      win({ id: 'bad-date', startDate: '2026-02-30' }),
      win({ id: 'backwards', startDate: '2026-10-25', endDate: '2026-10-24' }),
      win({ id: 'ok' }),
    )
    expect(p.windows.map((w) => w.id)).toEqual(['ok'])
  })
})

describe('illness gate (n-3)', () => {
  it('rests through the symptom-free day, then eases, then clears', () => {
    const days = ['2026-10-20']
    const free = P.n3.illnessSymptomFreeDays.value
    const easy = P.n3.illnessEasyDaysBeforeIntensity.value
    expect(illnessGate(days, '2026-10-19')).toEqual({ phase: 'clear', since: null })
    expect(illnessGate(days, '2026-10-20')).toEqual({ phase: 'rest', since: 0 })
    expect(illnessGate(days, addDays('2026-10-20', free)).phase).toBe('rest')
    expect(illnessGate(days, addDays('2026-10-20', free + 1)).phase).toBe('easy-only')
    expect(illnessGate(days, addDays('2026-10-20', free + easy)).phase).toBe('easy-only')
    expect(illnessGate(days, addDays('2026-10-20', free + easy + 1))).toEqual({
      phase: 'clear',
      since: free + easy + 1,
    })
  })

  it('reads the newest illness day on or before the date', () => {
    const days = ['2026-10-01', '2026-10-20', '2026-11-30']
    expect(illnessGate(days, '2026-10-21')).toEqual({ phase: 'rest', since: 1 })
    expect(illnessGate([...days].reverse(), '2026-10-21')).toEqual({ phase: 'rest', since: 1 })
    expect(illnessGate(new Set(days), '2026-10-25').phase).toBe('clear')
  })

  it('is what illnessPhase reads from the check-ins', () => {
    const wellness = [wellnessDay('2026-10-20', { illness: true }), wellnessDay('2026-10-22', {})]
    for (const date of dates('2026-10-18', '2026-10-30')) {
      expect(illnessPhase(input({ wellness }), date)).toEqual(illnessGate(['2026-10-20'], date))
    }
  })
})

describe('window phases', () => {
  it('follows an illness window exactly as n-3 follows its check-ins, for every date', () => {
    // Offsets 0-20 from the first day of the window, lengths 1-10, and three days before it.
    const start = '2026-10-21'
    for (let length = 1; length <= 10; length++) {
      const end = addDays(start, length - 1)
      const p = plan(win({ reason: 'illness-above-neck', startDate: start, endDate: end }))
      const checkins = dates(start, end).map((d) => wellnessDay(d, { illness: true }))
      const w = p.windows[0]!
      for (let offset = -3; offset <= 20; offset++) {
        const date = addDays(start, offset)
        const gate = illnessPhase(input({ wellness: checkins }), date)
        const rule = dayRuleOn(p, date)
        const phase = windowPhase(w, date)
        const label = `length ${String(length)}, offset ${String(offset)}`
        expect(rule?.held === true, label).toBe(gate.phase === 'rest')
        if (gate.phase === 'rest') {
          expect(phase, label).toBe(date <= end ? 'resting' : 'rest-gate')
          expect(rule?.maxRunMin, label).toBe(0)
          expect(rule?.quality, label).toBe(false)
        } else if (gate.phase === 'easy-only') {
          expect(phase, label).toBe('easy-only')
          expect(rule, label).toMatchObject({ held: false, quality: false, maxRunMin: null })
        } else {
          expect(rule, label).toBeNull()
          expect(['upcoming', 'returning', 'done'], label).toContain(phase)
          expect(phase === 'upcoming', label).toBe(date < start)
        }
      }
    }
  })

  it('puts an illness window on rest through the wait and eases the days after', () => {
    // Wed 21 to Fri 23 Oct: the symptom-free day is Sat 24, easy running Sun 25 to Tue 27.
    const w = plan(
      win({ reason: 'illness-below-neck', startDate: '2026-10-21', endDate: '2026-10-23' }),
    ).windows[0]!
    expect(w).toMatchObject({
      mode: 'rest',
      restThrough: '2026-10-24',
      easyThrough: '2026-10-27',
      runFrom: '2026-10-25',
      qualityFrom: '2026-10-28',
    })
    const phases = dates('2026-10-20', '2026-10-28').map((d) => windowPhase(w, d))
    expect(phases).toEqual([
      'upcoming',
      'resting',
      'resting',
      'resting',
      'rest-gate',
      'easy-only',
      'easy-only',
      'easy-only',
      'done',
    ])
  })

  it('treats illness as rest whatever mode is stored', () => {
    const w = plan(win({ reason: 'illness-above-neck', mode: 'limited', maxRunMin: 30 }))
      .windows[0]!
    expect(w.mode).toBe('rest')
    expect(w.maxRunMin).toBeNull()
  })

  it('gives a niggle no symptom-free gate and its own easy days', () => {
    // Mon 19 to Tue 20, no running: easy days follow at once, quality returns on the 24th.
    const w = plan(win({ reason: 'niggle', startDate: MON, endDate: '2026-10-20' })).windows[0]!
    expect(w).toMatchObject({
      restThrough: '2026-10-20',
      runFrom: '2026-10-21',
      qualityFrom: addDays('2026-10-20', P.j9.niggleEasyDays.value + 1),
    })
    expect(w.qualityFrom).toBe('2026-10-24')
    expect(dates('2026-10-18', '2026-10-24').map((d) => windowPhase(w, d))).toEqual([
      'upcoming',
      'resting',
      'resting',
      'easy-only',
      'easy-only',
      'easy-only',
      'done',
    ])
  })

  it('keeps a niggle with short runs easy and capped, then eases the days after', () => {
    const p = plan(
      win({
        reason: 'niggle',
        mode: 'limited',
        maxRunMin: 30,
        startDate: MON,
        endDate: '2026-10-21',
      }),
    )
    expect(p.windows[0]).toMatchObject({ mode: 'limited', runFrom: MON, restThrough: null })
    expect(p.holds).toEqual([])
    expect(dayRuleOn(p, MON)).toMatchObject({ held: false, maxRunMin: 30, quality: false })
    expect(dayRuleOn(p, '2026-10-21')).toMatchObject({ maxRunMin: 30, quality: false })
    expect(dayRuleOn(p, '2026-10-22')).toMatchObject({ maxRunMin: null, quality: false })
    expect(dayRuleOn(p, '2026-10-24')).toMatchObject({ quality: false })
    expect(dayRuleOn(p, '2026-10-25')).toBeNull()
    expect(dates('2026-10-18', '2026-10-25').map((d) => windowPhase(p.windows[0]!, d))).toEqual([
      'upcoming',
      'limited',
      'limited',
      'limited',
      'easy-only',
      'easy-only',
      'easy-only',
      'done',
    ])
  })

  it('lets short-on-time and travel windows cap the day and keep quality where a run fits', () => {
    const p = plan(
      win({
        reason: 'short-on-time',
        mode: 'limited',
        maxRunMin: 45,
        startDate: '2026-10-22',
        endDate: '2026-10-24',
      }),
    )
    expect(p.windows[0]).toMatchObject({ runFrom: '2026-10-22', qualityFrom: '2026-10-22' })
    for (const date of ['2026-10-22', '2026-10-23', '2026-10-24']) {
      expect(dayRuleOn(p, date), date).toMatchObject({
        held: false,
        maxRunMin: 45,
        quality: true,
        reason: 'short-on-time',
      })
    }
    expect(dayRuleOn(p, '2026-10-25')).toBeNull()
    expect(windowPhase(p.windows[0]!, '2026-10-23')).toBe('limited')
    expect(windowPhase(p.windows[0]!, '2026-10-25')).toBe('done')
  })

  it('holds a rest window of travel with no tail', () => {
    const p = plan(win({ reason: 'travel', startDate: '2026-10-22', endDate: '2026-10-24' }))
    expect(heldDates(p)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24'])
    expect(p.windows[0]).toMatchObject({
      easyThrough: null,
      runFrom: '2026-10-25',
      qualityFrom: '2026-10-25',
    })
    expect(dayRuleOn(p, '2026-10-25')).toBeNull()
  })

  it('treats a limited window without a cap as a rest window, the safer reading', () => {
    const w = plan(win({ mode: 'limited', maxRunMin: null })).windows[0]!
    expect(w.mode).toBe('rest')
    expect(w.restThrough).toBe(w.endDate)
  })
})

describe('overlaps', () => {
  it('lets the strictest rule win on a day two windows share', () => {
    const p = plan(
      win({ id: 'ill', reason: 'illness-above-neck', startDate: MON, endDate: '2026-10-20' }),
      win({
        id: 'trip',
        reason: 'travel',
        mode: 'limited',
        maxRunMin: 30,
        startDate: '2026-10-21',
        endDate: '2026-10-25',
      }),
      win({
        id: 'cap',
        reason: 'short-on-time',
        mode: 'limited',
        maxRunMin: 60,
        startDate: '2026-10-23',
        endDate: '2026-10-25',
      }),
    )
    // Wed 21 is the symptom-free day: held, though the trip would only cap it.
    expect(dayRuleOn(p, '2026-10-21')).toMatchObject({
      held: true,
      gate: true,
      maxRunMin: 0,
      reason: 'illness-above-neck',
    })
    // Thu 22 to Sat 24 are easy days of the illness, with the trip's cap and, from the 23rd, the lower of the two caps.
    expect(dayRuleOn(p, '2026-10-22')).toMatchObject({ held: false, maxRunMin: 30, quality: false })
    expect(dayRuleOn(p, '2026-10-23')).toMatchObject({
      maxRunMin: 30,
      quality: false,
      windowIds: ['ill', 'trip', 'cap'],
    })
    // Sun 25: the illness is over, the caps remain and quality is back.
    expect(dayRuleOn(p, '2026-10-25')).toMatchObject({ maxRunMin: 30, quality: true })
  })

  it('reads a day that a window holds and another only gates as held by the window', () => {
    const p = plan(
      win({ id: 'ill', reason: 'illness-above-neck', startDate: MON, endDate: '2026-10-20' }),
      win({ id: 'trip', reason: 'travel', startDate: '2026-10-21', endDate: '2026-10-23' }),
    )
    expect(dayRuleOn(p, '2026-10-21')).toMatchObject({ held: true, gate: false, reason: 'travel' })
    expect(p.holds).toHaveLength(1)
    expect(p.holds[0]).toMatchObject({
      from: MON,
      to: '2026-10-23',
      layoffDays: 5,
      windowIds: ['ill', 'trip'],
    })
  })

  it('counts windows that touch, and duplicates, as one layoff, never two restarts', () => {
    const touching = plan(rest(MON, 7, { id: 'a' }), rest('2026-10-26', 7, { id: 'b' }))
    expect(touching.holds).toHaveLength(1)
    expect(touching.holds[0]).toMatchObject({ layoffDays: 14, fraction: P.j7.restart7to14.value })
    const twice = plan(rest(MON, 10, { id: 'a' }), rest(MON, 10, { id: 'b' }))
    expect(twice.holds).toHaveLength(1)
    expect(twice.holds[0]).toMatchObject({ layoffDays: 10, fraction: P.j7.restart7to14.value })
    const single = plan(rest(MON, 10, { id: 'a' }))
    expect(twice.holds[0]!.fraction).toBe(single.holds[0]!.fraction)
    // A run day between two windows is two layoffs.
    const apart = plan(rest(MON, 7, { id: 'a' }), rest('2026-10-27', 7, { id: 'b' }))
    expect(apart.holds).toHaveLength(2)
  })
})

describe('return fractions', () => {
  // Travel with no running from Mon 19 Oct: the lost days are the days of the window.
  const lost = (days: number) => plan(rest(MON, days)).holds[0]!

  it.each([
    [6, P.j7.restartUnder7.value],
    [7, P.j7.restart7to14.value],
    [14, P.j7.restart7to14.value],
    [15, P.j7.restart15to28.value],
    [28, P.j7.restart15to28.value],
    [29, P.j7.restartOver28.value],
  ])('restarts at the J7 fraction after %i lost days', (days, fraction) => {
    expect(lost(days)).toMatchObject({ layoffDays: days, fraction })
    expect(restartFraction(days)).toBe(fraction)
    expect(breakRestart(days, 300).fraction).toBe(fraction)
  })

  it('counts the symptom-free day as lost, so the longest window passes into the last tier', () => {
    const longest = P.j9.maxWindowDays.value
    const hold = plan(rest(MON, longest, { reason: 'illness-above-neck' })).holds[0]!
    expect(hold.layoffDays).toBe(longest + P.n3.illnessSymptomFreeDays.value)
    expect(hold.fraction).toBe(P.j7.restartOver28.value)
    // a travel window of the same length stays in the third tier
    expect(lost(longest).fraction).toBe(P.j7.restart15to28.value)
  })

  it('has no restart under the first tier and a restart for each long hold', () => {
    const short = plan(rest(MON, 6))
    expect(short.windows[0]!.returnThrough).toBeNull()
    expect(
      disruptionWeekCap(short, '2026-10-26', { referenceMin: 300, baselineMin: 300 }),
    ).toBeNull()
    expect(plan(rest(MON, 7)).windows[0]!.returnThrough).toBe('2026-11-01')
  })

  it('counts the days held, not the days of the window', () => {
    // A travel window holds its own days; an illness holds the symptom-free day as well.
    expect(plan(rest(MON, 8)).holds[0]!.layoffDays).toBe(8)
    expect(plan(rest(MON, 6, { reason: 'illness-above-neck' })).holds[0]!.layoffDays).toBe(7)
  })
})

describe('week caps', () => {
  const basis = { referenceMin: 300, baselineMin: 300 }

  it('holds the return week and the first full week after a Monday return', () => {
    // Travel Mon 19 to Sun 25 Oct: 7 days lost, first run day Mon 26 Oct.
    const p = plan(rest(MON, 7))
    expect(p.holds[0]).toMatchObject({
      runFrom: '2026-10-26',
      returnWeekStart: '2026-10-26',
      fullWeekStart: '2026-10-26',
    })
    const fraction = P.j7.restart7to14.value
    expect(disruptionWeekCap(p, '2026-10-26', basis)).toEqual({
      weekStart: '2026-10-26',
      capMin: Math.floor(300 * fraction),
      heldDays: 0,
      openDays: 7,
      fraction,
      flags: ['disruption-return'],
    })
    expect(disruptionWeekCap(p, '2026-11-02', basis)).toBeNull()
  })

  it('prorates a mid-week return by its open days and holds the next full week whole', () => {
    // Travel Mon 19 Oct to Mon 2 Nov (15 days): first run day Tue 3 Nov, return week from Mon 2 Nov.
    const p = plan(rest(MON, 15))
    const fraction = P.j7.restart15to28.value
    expect(p.holds[0]).toMatchObject({
      layoffDays: 15,
      runFrom: '2026-11-03',
      returnWeekStart: '2026-11-02',
      fullWeekStart: '2026-11-09',
    })
    const returnWeek = disruptionWeekCap(p, '2026-11-02', basis)
    expect(returnWeek).toMatchObject({
      capMin: Math.floor((300 * fraction * 6) / 7),
      heldDays: 1,
      openDays: 6,
      flags: ['disrupted', 'disruption-return'],
    })
    const fullWeek = disruptionWeekCap(p, '2026-11-09', basis)
    expect(fullWeek).toMatchObject({
      capMin: Math.floor(300 * fraction),
      heldDays: 0,
      flags: ['disruption-return'],
    })
    expect(disruptionWeekCap(p, '2026-11-16', basis)).toBeNull()
  })

  it.each([
    // 8 days off from Tue 13 Oct: the first run day is Wed 21 Oct, with 5 open days left that week.
    { start: '2026-10-13', days: 8, runFrom: '2026-10-21', open: 5 },
    // 13 days off from Mon 12 Oct: the first run day is Sun 25 Oct, one open day.
    { start: '2026-10-12', days: 13, runFrom: '2026-10-25', open: 1 },
  ])('prorates a return on $runFrom by its $open open days', ({ start, days, runFrom, open }) => {
    const p = plan(rest(start, days))
    const fraction = P.j7.restart7to14.value
    expect(p.holds[0]).toMatchObject({ runFrom, returnWeekStart: MON, fullWeekStart: '2026-10-26' })
    expect(disruptionWeekCap(p, MON, basis)).toMatchObject({
      openDays: open,
      capMin: Math.floor((300 * fraction * open) / 7),
      flags: ['disrupted', 'disruption-return'],
    })
    expect(disruptionWeekCap(p, '2026-10-26', basis)?.capMin).toBe(Math.floor(300 * fraction))
  })

  it('costs a held week what the plan had on the held days, or an equal share without the detail', () => {
    // An illness Wed 21 to Fri 23 Oct holds Wed to Sat; the plan runs 60 min on each of five days.
    const p = plan(
      win({ reason: 'illness-above-neck', startDate: '2026-10-21', endDate: '2026-10-23' }),
    )
    const minByDate = {
      [MON]: 60,
      '2026-10-20': 0,
      '2026-10-21': 60,
      '2026-10-22': 60,
      '2026-10-23': 60,
      '2026-10-24': 60,
      '2026-10-25': 0,
    }
    expect(
      disruptionWeekCap(p, MON, { referenceMin: 300, baselineMin: 300, minByDate }),
    ).toMatchObject({
      capMin: 60,
      heldDays: 4,
      openDays: 3,
      flags: ['disrupted'],
    })
    // a rest day on the held dates costs nothing
    const quiet = { ...minByDate, '2026-10-21': 0, '2026-10-24': 0 }
    expect(
      disruptionWeekCap(p, MON, { referenceMin: 300, baselineMin: 180, minByDate: quiet })?.capMin,
    ).toBe(60)
    // without the detail: an equal share of the week for each held day
    expect(disruptionWeekCap(p, MON, { referenceMin: 300, baselineMin: 280 })?.capMin).toBe(
      Math.floor(280 - (280 * 4) / 7),
    )
  })

  it('returns null for a week no window touches', () => {
    // Thu 29 and Fri 30 Oct lie in the week of the 26th.
    const p = plan(win({ startDate: '2026-10-29', endDate: '2026-10-30' }))
    expect(disruptionWeekCap(p, '2026-10-26', basis)).not.toBeNull()
    expect(disruptionWeekCap(p, MON, basis)).toBeNull()
    expect(disruptionWeekCap(p, '2026-11-02', basis)).toBeNull()
    expect(disruptionWeekCap(plan(), MON, basis)).toBeNull()
  })

  it('flags a week with only a cap or a quiet day as disrupted and puts no total on it', () => {
    const p = plan(
      win({ mode: 'limited', maxRunMin: 30, startDate: '2026-10-22', endDate: '2026-10-23' }),
    )
    expect(disruptionWeekCap(p, MON, basis)).toEqual({
      weekStart: MON,
      capMin: null,
      heldDays: 0,
      openDays: 7,
      fraction: 1,
      flags: ['disrupted'],
    })
  })

  it('never goes negative or above the plan, over every reason, length and start', () => {
    const reasons: DisruptionReason[] = ['illness-above-neck', 'niggle', 'short-on-time', 'travel']
    const weeks = Array.from({ length: 10 }, (_, k) => addDays('2026-10-12', k * 7))
    let checked = 0
    for (const reason of reasons) {
      for (const length of [1, 3, 7, 14, 28]) {
        for (let offset = -14; offset <= 14; offset += 3) {
          const p = plan(rest(addDays(TODAY, offset), length, { reason }))
          for (const baselineMin of [0, 100, 300]) {
            for (const referenceMin of [0, 300]) {
              for (const week of weeks) {
                const cap = disruptionWeekCap(p, week, { referenceMin, baselineMin })
                if (cap === null) continue
                checked += 1
                if (cap.capMin === null) continue
                expect(cap.capMin).toBeGreaterThanOrEqual(0)
                expect(Number.isInteger(cap.capMin)).toBe(true)
                if (cap.heldDays > 0) expect(cap.capMin).toBeLessThanOrEqual(baselineMin)
                if (cap.flags.includes('disruption-return')) {
                  expect(cap.capMin).toBeLessThanOrEqual(referenceMin)
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('keeps every cap a whole, non-negative number whatever figures it is given', () => {
    // Figures that are negative or not finite read as zero; a held day costs what the plan had on it.
    const clean = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)
    const weeks = Array.from({ length: 10 }, (_, k) => addDays('2026-10-12', k * 7))
    const figures = [-50, 0, 100, 300, Number.NaN, Infinity, -Infinity]
    const dayMinutes = [undefined, 0, 500, -40, Number.NaN, Infinity] as const
    let checked = 0
    let heldChecked = 0
    for (const length of [1, 3, 7, 9, 14, 30]) {
      for (const offset of [-14, -7, -1, 2, 9]) {
        const p = plan(rest(addDays(TODAY, offset), length, { reason: 'illness-above-neck' }))
        for (const week of weeks) {
          for (const baselineMin of figures) {
            for (const referenceMin of figures) {
              for (const perDay of dayMinutes) {
                const minByDate =
                  perDay === undefined
                    ? undefined
                    : Object.fromEntries(dates(week, addDays(week, 6)).map((d) => [d, perDay]))
                const cap = disruptionWeekCap(p, week, { referenceMin, baselineMin, minByDate })
                if (cap === null || cap.capMin === null) continue
                checked += 1
                expect(Number.isInteger(cap.capMin)).toBe(true)
                expect(cap.capMin).toBeGreaterThanOrEqual(0)
                if (cap.heldDays > 0) {
                  heldChecked += 1
                  expect(cap.capMin).toBeLessThanOrEqual(clean(baselineMin))
                }
                if (cap.flags.includes('disruption-return')) {
                  expect(cap.capMin).toBeLessThanOrEqual(clean(referenceMin))
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000)
    expect(heldChecked).toBeGreaterThan(5_000)
  })

  it('floors a held week at zero when the held days cost more than the week holds', () => {
    // Thu 22 to Sun 25 held. The plan's four held days add up to 240 minutes, the week to 180.
    const p = plan(win({ startDate: '2026-10-22', endDate: '2026-10-24', reason: 'niggle' }))
    const minByDate = {
      '2026-10-19': 30,
      '2026-10-22': 90,
      '2026-10-23': 60,
      '2026-10-24': 60,
      '2026-10-25': 30,
    }
    const cap = disruptionWeekCap(p, MON, { referenceMin: 300, baselineMin: 180, minByDate })
    expect(cap?.heldDays).toBeGreaterThan(0)
    expect(cap?.capMin).toBe(0)
  })

  it('reads a missing, negative or infinite figure as zero minutes, never a negative or NaN cap', () => {
    const held = plan(rest('2026-10-20', 3))
    for (const baselineMin of [Number.NaN, -120, Infinity, -Infinity]) {
      expect(disruptionWeekCap(held, MON, { referenceMin: 300, baselineMin })?.capMin).toBe(0)
    }
    // A negative day figure costs nothing; it does not add minutes to the week.
    const refund = { '2026-10-20': -400, '2026-10-21': -400, '2026-10-22': -400 }
    expect(
      disruptionWeekCap(held, MON, { referenceMin: 300, baselineMin: 100, minByDate: refund })
        ?.capMin,
    ).toBe(100)
    const noDetail = { referenceMin: 300, baselineMin: 100, minByDate: { '2026-10-20': Infinity } }
    expect(disruptionWeekCap(held, MON, noDetail)?.capMin).toBe(100)

    // The return week and the full week after a 9-day hold: the reference is the only figure.
    const back = plan(rest('2026-10-12', 9))
    for (const referenceMin of [Number.NaN, -300, Infinity]) {
      const week = disruptionWeekCap(back, '2026-10-26', { referenceMin, baselineMin: 300 })
      expect(week).toMatchObject({ capMin: 0, flags: ['disruption-return'] })
    }
  })

  it('rounds a cap down only after the 1e-9 nudge, so 62.99999999999999 minutes is 63', () => {
    // 90 x 0.7 is 62.99999999999999 in floating point; the cap is the minutes the product means.
    expect(0.7 * 90).toBeLessThan(63)
    // The plan reads the J7 fraction when it is built, so it is built with the fraction set.
    const caps = withValue(P.j7.restart7to14, 0.7, () => {
      const back = plan(rest('2026-10-12', 8))
      expect(back.holds[0]).toMatchObject({
        fraction: 0.7,
        returnWeekStart: MON,
        fullWeekStart: '2026-10-26',
      })
      return {
        full: disruptionWeekCap(back, '2026-10-26', { referenceMin: 90, baselineMin: 300 }),
        // The return week prorates the same way: its 6 open days of 45 x 0.7 are 26.999999999999996.
        returnWeek: disruptionWeekCap(back, MON, { referenceMin: 45, baselineMin: 300 }),
      }
    })
    expect(caps.full?.capMin).toBe(63)
    expect(caps.returnWeek).toMatchObject({ openDays: 6, capMin: 27 })
  })

  it('applies the smallest cap when a week is both held and a return week', () => {
    // 9 days off ending Wed 21 Oct, then a second window holding Sat 24 and Sun 25.
    const p = plan(rest('2026-10-13', 9), rest('2026-10-24', 2, { id: 'w2' }))
    const cap = disruptionWeekCap(p, MON, { referenceMin: 300, baselineMin: 300 })
    expect(cap?.heldDays).toBe(5)
    expect(cap?.capMin).toBe(
      Math.min(
        Math.floor(300 - (300 * 5) / 7),
        Math.floor((300 * P.j7.restart7to14.value * 2) / 7),
      ),
    )
  })
})

describe('held dates and rest sessions', () => {
  const p = plan(
    win({ reason: 'illness-above-neck', startDate: '2026-10-21', endDate: '2026-10-23' }),
  )

  it('lists the held dates in order, inside a range', () => {
    expect(heldDates(p)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'])
    expect(heldDates(p, { from: '2026-10-23' })).toEqual(['2026-10-23', '2026-10-24'])
    expect(heldDates(p, { from: '2026-10-22', to: '2026-10-22' })).toEqual(['2026-10-22'])
    expect(heldDates(p, { to: '2026-10-20' })).toEqual([])
    expect(heldDates(plan())).toEqual([])
  })

  it('does not hold a day that a window only caps or eases', () => {
    const capped = plan(win({ mode: 'limited', maxRunMin: 30, reason: 'niggle' }))
    expect(heldDates(capped)).toEqual([])
    expect(restSessions(capped)).toEqual([])
  })

  it('gives each held date one rest session with the window flag and rules', () => {
    const sessions = restSessions(p)
    expect(sessions.map((s) => s.date)).toEqual(heldDates(p))
    for (const s of sessions) {
      expect(s).toMatchObject({
        kind: 'rest',
        order: 0,
        title: 'Rest: illness',
        durationMin: 0,
        distanceM: null,
        gainM: null,
        structure: [],
        flags: ['rest-window'],
      })
      expect(s.target).toEqual({
        zone: 'rest',
        rpe: [...P.expectedRpe.rest.value],
        hr: null,
        paceSecPerKm: null,
        heatNote: null,
      })
      expect(s.rules).toEqual(['J9', 'n-3', 'g-6'])
    }
    // the symptom-free day reads differently from a day inside the window
    expect(sessions[3]!.purpose).toMatch(/symptom-free/)
    expect(sessions[0]!.purpose).toMatch(/not added back/)
  })

  it('names the reason in the title and leaves n-3 to illness', () => {
    const title = (reason: DisruptionReason) => restSessions(plan(win({ reason })))[0]!
    expect(title('illness-below-neck').title).toBe('Rest: illness')
    expect(title('niggle').title).toBe('Rest: niggle')
    expect(title('short-on-time').title).toBe('Rest: short on time')
    expect(title('travel')).toMatchObject({ title: 'Rest: travel', rules: ['J9', 'g-6'] })
  })

  it('limits the sessions to a range of dates', () => {
    expect(restSessions(p, { from: '2026-10-23', to: '2026-10-23' }).map((s) => s.date)).toEqual([
      '2026-10-23',
    ])
  })

  it('writes text that passes the shared G5 lint', () => {
    const reasons: DisruptionReason[] = [
      'illness-above-neck',
      'illness-below-neck',
      'niggle',
      'short-on-time',
      'travel',
    ]
    for (const reason of reasons) {
      for (const s of restSessions(plan(win({ reason })))) {
        expect(lintText(s.title), s.title).toEqual([])
        expect(lintText(s.purpose), s.purpose).toEqual([])
      }
    }
    for (const s of restSessions(p)) expect(lintText(s.purpose), s.purpose).toEqual([])
  })
})

describe('injury report', () => {
  const niggle = (over: Partial<DisruptionWindow> = {}) =>
    win({ reason: 'niggle', startDate: '2026-10-20', endDate: '2026-10-22', ...over })

  it('is made by pain at the red-flag score or by a change in gait', () => {
    expect(injuryReportOf(niggle({ pain: P.pain.flagScore.value - 1 }))).toBeNull()
    expect(injuryReportOf(niggle({ pain: null }))).toBeNull()
    expect(injuryReportOf(niggle({ pain: P.pain.flagScore.value }))).not.toBeNull()
    expect(injuryReportOf(niggle({ pain: 2, gaitChange: true }))).not.toBeNull()
    expect(injuryReportOf(niggle({ pain: null, gaitChange: true }))).not.toBeNull()
  })

  it('is made by a niggle and nothing else', () => {
    for (const reason of [
      'illness-above-neck',
      'illness-below-neck',
      'short-on-time',
      'travel',
    ] as const) {
      expect(injuryReportOf(win({ reason, pain: 9, gaitChange: true }))).toBeNull()
    }
  })

  it('lasts from the first day to the return plus one week for each level of the ladder', () => {
    const report = injuryReportOf(niggle({ id: 'n1', pain: 6 }))
    const weeks = P.injuryReturn.levelsMin.value.length
    expect(weeks).toBe(6)
    expect(report).toEqual({
      windowId: 'n1',
      from: '2026-10-20',
      until: addDays('2026-10-22', weeks * 7),
    })
    expect(report?.until).toBe('2026-12-03')
  })

  it('is listed by the plan, window by window', () => {
    const p = plan(
      niggle({ id: 'n1', pain: 6 }),
      niggle({ id: 'n2', pain: 1 }),
      win({ id: 't', reason: 'travel', gaitChange: true }),
    )
    expect(p.injuryReports.map((r) => r.windowId)).toEqual(['n1'])
  })
})

describe('validation', () => {
  const context: { today: string; goalDate: string | null } = {
    today: TODAY,
    goalDate: '2027-06-12',
  }
  const draft = (over: Partial<DisruptionDraft> = {}): DisruptionDraft => ({
    reason: 'travel',
    mode: 'rest',
    startDate: '2026-10-22',
    endDate: '2026-10-25',
    ...over,
  })
  const codes = (over: Partial<DisruptionDraft>, ctx = context) =>
    validateDisruption(draft(over), ctx).map((i) => i.code)

  it('accepts a good window of each reason', () => {
    expect(validateDisruption(draft(), context)).toEqual([])
    expect(codes({ reason: 'illness-above-neck' })).toEqual([])
    expect(codes({ reason: 'niggle', area: 'calf', pain: 3, gaitChange: true })).toEqual([])
    expect(codes({ reason: 'short-on-time', mode: 'limited', maxRunMin: 30 })).toEqual([])
    expect(codes({ reason: 'travel', mode: 'limited', maxRunMin: RUN_CAP_MAX_MIN })).toEqual([])
    expect(codes({ startDate: TODAY, endDate: TODAY })).toEqual([])
  })

  it('refuses a false or reversed date', () => {
    expect(codes({ startDate: '2026-13-01' })).toEqual(['start-invalid'])
    expect(codes({ endDate: 'soon' })).toEqual(['end-invalid'])
    expect(codes({ startDate: '2026-10-25', endDate: '2026-10-24' })).toEqual(['end-before-start'])
  })

  it('refuses a window longer than the Param allows, and counts both ends', () => {
    const longest = P.j9.maxWindowDays.value
    expect(codes({ startDate: TODAY, endDate: addDays(TODAY, longest - 1) })).toEqual([])
    expect(codes({ startDate: TODAY, endDate: addDays(TODAY, longest) })).toEqual(['too-long'])
  })

  it('refuses a start further back than the Param allows', () => {
    const back = P.j9.maxBackdateDays.value
    const from = (offset: number) => ({
      startDate: addDays(TODAY, offset),
      endDate: addDays(TODAY, offset + 2),
    })
    expect(codes(from(-back))).toEqual([])
    expect(codes(from(-back - 1))).toEqual(['start-too-old'])
  })

  it('refuses a window that ends after the goal, and skips the check without a goal', () => {
    const goal = { today: TODAY, goalDate: '2026-11-01' }
    expect(codes({ endDate: '2026-11-01' }, goal)).toEqual([])
    expect(codes({ endDate: '2026-11-02' }, goal)).toEqual(['end-after-goal'])
    expect(codes({ endDate: '2026-11-02' }, { today: TODAY, goalDate: null })).toEqual([])
  })

  it('makes illness rest only', () => {
    expect(
      validateDisruption(
        draft({ reason: 'illness-below-neck', mode: 'limited', maxRunMin: 30 }),
        context,
      ),
    ).toEqual([{ code: 'illness-rest-only', field: 'mode' }])
  })

  it('needs a run cap of the easy-run floor to the upper bound for limited, and none for rest', () => {
    const floor = P.fplace.easyRunMinMin.value
    const limited = (maxRunMin: number | null | undefined) =>
      codes({ mode: 'limited', ...(maxRunMin === undefined ? {} : { maxRunMin }) })
    expect(limited(undefined)).toEqual(['cap-required'])
    expect(limited(null)).toEqual(['cap-required'])
    expect(limited(floor - 1)).toEqual(['cap-out-of-range'])
    expect(limited(floor)).toEqual([])
    expect(limited(RUN_CAP_MAX_MIN)).toEqual([])
    expect(limited(RUN_CAP_MAX_MIN + 1)).toEqual(['cap-out-of-range'])
    expect(limited(30.5)).toEqual(['cap-out-of-range'])
    expect(codes({ maxRunMin: 30 })).toEqual(['cap-on-rest'])
    expect(codes({ maxRunMin: null })).toEqual([])
  })

  it('lets only a niggle take area, pain and gait change', () => {
    expect(validateDisruption(draft({ area: 'calf', pain: 3, gaitChange: true }), context)).toEqual(
      [
        { code: 'niggle-only', field: 'area' },
        { code: 'niggle-only', field: 'pain' },
        { code: 'niggle-only', field: 'gaitChange' },
      ],
    )
    expect(codes({ area: '  ', pain: null, gaitChange: false })).toEqual([])
    expect(codes({ reason: 'niggle', area: 'calf', gaitChange: true })).toEqual([])
  })

  it('keeps pain on the 0-10 scale as a whole number', () => {
    for (const pain of [0, 5, 10]) expect(codes({ reason: 'niggle', pain })).toEqual([])
    for (const pain of [-1, 11, 4.5]) {
      expect(codes({ reason: 'niggle', pain })).toEqual(['pain-out-of-range'])
    }
  })

  it('reports every problem at once, in field order', () => {
    const issues = validateDisruption(
      draft({
        reason: 'illness-above-neck',
        mode: 'limited',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        maxRunMin: 5,
      }),
      { today: TODAY, goalDate: '2026-11-01' },
    )
    expect(issues.map((i) => i.code)).toEqual([
      'too-long',
      'start-too-old',
      'end-after-goal',
      'illness-rest-only',
      'cap-out-of-range',
    ])
  })
})

describe('window copy', () => {
  const words = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ]
  const phrase = (n: number, noun: string) => `${words[n]!} ${noun}${n === 1 ? '' : 's'}`

  const illnessSentence = () => renderFact(windowRuleFact('illness-above-neck')!, 'km')

  it('states the n-3 days from the Params', () => {
    const free = P.n3.illnessSymptomFreeDays.value
    const easy = P.n3.illnessEasyDaysBeforeIntensity.value
    expect(illnessSentence()).toBe(
      `Running waits until you have had ${phrase(free, 'symptom-free day')}, then ${phrase(easy, 'easy day')} before any hard session.`,
    )
    expect(illnessSentence()).toBe(
      'Running waits until you have had one symptom-free day, then three easy days before any hard session.',
    )
    expect(withValue(P.n3.illnessSymptomFreeDays, 2, illnessSentence)).toContain(
      'two symptom-free days',
    )
    expect(withValue(P.n3.illnessEasyDaysBeforeIntensity, 5, illnessSentence)).toContain(
      'five easy days',
    )
    expect(windowRuleFact('illness-below-neck')).toEqual(windowRuleFact('illness-above-neck'))
  })

  it('states the easy days after a niggle from the Params', () => {
    const sentence = () => renderFact(windowRuleFact('niggle')!, 'km')
    expect(sentence()).toBe(
      `There is no symptom-free wait after a niggle. Easy running only for ${phrase(P.j9.niggleEasyDays.value, 'day')}, then hard sessions return.`,
    )
    expect(withValue(P.j9.niggleEasyDays, 4, sentence)).toContain('four days')
    expect(windowRuleFact('travel')).toBeNull()
    expect(windowRuleFact('short-on-time')).toBeNull()
  })

  it('states the window limits and the run range from the Params', () => {
    const render = (code: DisruptionIssueCode) => describeIssue({ code, field: 'endDate' }, 'km')
    expect(render('too-long')).toBe(
      `A window can last up to ${String(P.j9.maxWindowDays.value)} days.`,
    )
    expect(render('start-too-old')).toBe(
      `A window can start up to ${String(P.j9.maxBackdateDays.value)} days ago.`,
    )
    expect(render('cap-out-of-range')).toBe(
      `The longest run can be ${String(P.fplace.easyRunMinMin.value)} min to ${String(RUN_CAP_MAX_MIN)} min.`,
    )
    expect(withValue(P.j9.maxWindowDays, 21, () => render('too-long'))).toBe(
      'A window can last up to 21 days.',
    )
    expect(withValue(P.j9.maxBackdateDays, 14, () => render('start-too-old'))).toBe(
      'A window can start up to 14 days ago.',
    )
    expect(withValue(P.fplace.easyRunMinMin, 15, () => render('cap-out-of-range'))).toContain(
      '15 min to',
    )
  })

  it('has a sentence for every refusal, and the limits are the validation limits', () => {
    const everyCode: DisruptionIssueCode[] = [
      'start-invalid',
      'end-invalid',
      'end-before-start',
      'too-long',
      'start-too-old',
      'end-after-goal',
      'illness-rest-only',
      'cap-required',
      'cap-out-of-range',
      'cap-on-rest',
      'niggle-only',
      'pain-out-of-range',
    ]
    for (const code of everyCode) {
      const sentence = describeIssue({ code, field: 'startDate' }, 'km')
      expect(sentence.length, code).toBeGreaterThan(10)
      expect(lintText(sentence), sentence).toEqual([])
      expect(TEMPLATES[issueFact({ code, field: 'startDate' }).template]).toBeDefined()
    }
  })

  it('registers every window template, so the shared lint test renders it', () => {
    for (const id of Object.keys(WINDOW_TEMPLATES) as Array<keyof typeof WINDOW_TEMPLATES>) {
      expect(TEMPLATES[id], id).toBe(WINDOW_TEMPLATES[id])
      expect(id.startsWith('window.')).toBe(true)
    }
  })

  it('describes an illness window in order, in both unit systems', () => {
    const w = plan(
      win({ reason: 'illness-above-neck', startDate: '2026-10-21', endDate: '2026-10-23' }),
    ).windows[0]!
    const expected = [
      'Rest from Wed 21 Oct to Sat 24 Oct.',
      'Easy running only from Sun 25 Oct to Tue 27 Oct.',
      'Back to the planned week on Wed 28 Oct.',
    ]
    expect(describeWindow(w, 'km')).toEqual(expected)
    expect(describeWindow(w, 'mi')).toEqual(expected)
  })

  it('describes a niggle, a cap, a single day and a long hold', () => {
    const lines = (...windows: DisruptionWindow[]) =>
      describeWindow(plan(...windows).windows[0]!, 'km')
    expect(lines(win({ reason: 'niggle', startDate: MON, endDate: '2026-10-20' }))).toEqual([
      'Rest from Mon 19 Oct to Tue 20 Oct.',
      'Easy running only from Wed 21 Oct to Fri 23 Oct.',
      'Back to the planned week on Sat 24 Oct.',
    ])
    expect(
      lines(
        win({
          reason: 'travel',
          mode: 'limited',
          maxRunMin: 30,
          startDate: '2026-10-22',
          endDate: '2026-10-24',
        }),
      ),
    ).toEqual([
      'Runs up to 30 min from Thu 22 Oct to Sat 24 Oct.',
      'Back to the planned week on Sun 25 Oct.',
    ])
    expect(lines(win({ startDate: '2026-10-22', endDate: '2026-10-22' }))).toEqual([
      'Rest on Thu 22 Oct.',
      'Back to the planned week on Fri 23 Oct.',
    ])
    expect(
      lines(
        win({
          reason: 'short-on-time',
          mode: 'limited',
          maxRunMin: 45,
          startDate: '2026-10-22',
          endDate: '2026-10-22',
        }),
      ),
    ).toEqual(['Runs up to 45 min on Thu 22 Oct.', 'Back to the planned week on Fri 23 Oct.'])
    expect(lines(rest(MON, 15))).toEqual([
      'Rest from Mon 19 Oct to Mon 2 Nov.',
      'Back to the planned week on Tue 3 Nov.',
      'After 15 days without running, the first two weeks back are held to 75% of the week before.',
    ])
  })

  it('writes sentences that pass the lint and name no banned word', () => {
    const windows = [
      win({ reason: 'illness-below-neck' }),
      win({ reason: 'niggle', pain: 7, gaitChange: true }),
      win({ reason: 'short-on-time', mode: 'limited', maxRunMin: 20 }),
      rest(MON, 29),
    ]
    for (const w of windows) {
      for (const units of ['km', 'mi'] as const) {
        for (const sentence of describeWindow(plan(w).windows[0]!, units)) {
          expect(lintText(sentence), sentence).toEqual([])
        }
      }
    }
  })

  it('gives facts the registry can render, so a stored record keeps working', () => {
    const fact = windowFacts(plan(rest(MON, 3)).windows[0]!)[0]!
    expect(renderFact(fact, 'km')).toBe('Rest from Mon 19 Oct to Wed 21 Oct.')
  })
})
