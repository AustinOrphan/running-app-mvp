import { describe, expect, test } from 'vitest'
import { P } from '../../shared/engine/params/index.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import {
  newWarnings,
  runMinOverNextWeeks,
  windowCovers,
} from '../../web/components/disruption/previewFigures.ts'
import {
  EMPTY_DRAFT,
  RUN_CAP_CHOICES,
  dateBounds,
  datesOf,
  draftErrors,
  inputOf,
  modeOf,
  windowSentences,
  type WindowDraft,
} from '../../web/components/disruption/windowDraft.ts'
import { makeBrief, makeDiff, makeLine, makeWindow } from './plan-fixtures.ts'

const TODAY = '2026-10-22'

const draft = (over: Partial<WindowDraft>): WindowDraft => ({ ...EMPTY_DRAFT, ...over })

describe('the window the runner enters', () => {
  test('starts and ends today until a day is chosen, and a later start carries a short end along', () => {
    expect(datesOf(draft({}), TODAY)).toEqual({ from: TODAY, until: TODAY })
    expect(datesOf(draft({ startDate: '2026-10-20' }), TODAY)).toEqual({
      from: '2026-10-20',
      until: '2026-10-20',
    })
    expect(datesOf(draft({ endDate: '2026-10-25' }), TODAY)).toEqual({
      from: TODAY,
      until: '2026-10-25',
    })
  })

  test('illness is rest only, a niggle rests unless short runs are chosen, the rest allow short runs', () => {
    expect(modeOf(draft({ reason: 'illness-above-neck', mode: 'limited' }))).toBe('rest')
    expect(modeOf(draft({ reason: 'illness-below-neck' }))).toBe('rest')
    expect(modeOf(draft({ reason: 'niggle' }))).toBe('rest')
    expect(modeOf(draft({ reason: 'niggle', mode: 'limited' }))).toBe('limited')
    expect(modeOf(draft({ reason: 'travel' }))).toBe('limited')
    expect(modeOf(draft({ reason: 'short-on-time', mode: 'rest' }))).toBe('rest')
  })

  test('offers the shortest run worth scheduling, from the Params, then 30, 45 and 60 minutes', () => {
    expect(P.fplace.easyRunMinMin.value).toBe(20)
    expect(RUN_CAP_CHOICES).toEqual([20, 30, 45, 60])
  })

  test('bounds the dates by the Params and the race', () => {
    expect(P.j9.maxBackdateDays.value).toBe(28)
    expect(P.j9.maxWindowDays.value).toBe(28)
    expect(dateBounds('2026-10-22', TODAY, null)).toEqual({
      startMin: '2026-09-24',
      endMin: '2026-10-22',
      endMax: '2026-11-18',
    })
    // The race is the later limit only when it is sooner than the longest window.
    expect(dateBounds('2026-10-22', TODAY, '2026-11-01').endMax).toBe('2026-11-01')
    expect(dateBounds('2026-10-22', TODAY, '2027-03-01').endMax).toBe('2026-11-18')
  })

  test('sends only the fields the reason and the mode use', () => {
    expect(inputOf(draft({}), TODAY)).toBeNull()
    expect(
      inputOf(
        draft({ reason: 'illness-above-neck', endDate: '2026-10-24', area: 'calf', pain: 4 }),
        TODAY,
      ),
    ).toEqual({
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: TODAY,
      endDate: '2026-10-24',
    })
    expect(
      inputOf(
        draft({
          reason: 'niggle',
          mode: 'limited',
          maxRunMin: 45,
          area: ' Left calf ',
          pain: 0,
          gaitChange: true,
        }),
        TODAY,
      ),
    ).toEqual({
      reason: 'niggle',
      mode: 'limited',
      startDate: TODAY,
      endDate: TODAY,
      maxRunMin: 45,
      area: 'Left calf',
      pain: 0,
      gaitChange: true,
    })
    // A cap chosen before the mode changed is not sent for a window that rests.
    expect(inputOf(draft({ reason: 'travel', mode: 'rest', maxRunMin: 45 }), TODAY)).toEqual({
      reason: 'travel',
      mode: 'rest',
      startDate: TODAY,
      endDate: TODAY,
    })
  })

  test('refuses a window with the server rules and the server words', () => {
    const context = { today: TODAY, raceDate: '2026-12-01', units: 'km' as const }
    const input = (over: Partial<Parameters<typeof draftErrors>[0]>) => ({
      reason: 'illness-above-neck' as const,
      mode: 'rest' as const,
      startDate: TODAY,
      endDate: TODAY,
      ...over,
    })
    expect(draftErrors(input({}), context)).toEqual({})
    expect(draftErrors(input({ endDate: '2026-10-21' }), context)).toEqual({
      endDate: 'The last day cannot come before the first day.',
    })
    expect(draftErrors(input({ startDate: '2026-09-01', endDate: '2026-09-02' }), context)).toEqual(
      {
        startDate: 'A window can start up to 28 days ago.',
      },
    )
    expect(
      draftErrors(input({ endDate: '2026-11-12' }), { ...context, raceDate: '2026-11-10' }),
    ).toEqual({ endDate: 'A window cannot end after the race.' })
    expect(
      draftErrors(input({ mode: 'limited', reason: 'travel', maxRunMin: 300 }), context),
    ).toEqual({ maxRunMin: 'The longest run can be 20 min to 240 min.' })
    expect(draftErrors(input({ endDate: '2026-12-01', startDate: '2026-09-01' }), context)).toEqual(
      {
        startDate: 'A window can start up to 28 days ago.',
        endDate: 'A window can last up to 28 days.',
      },
    )
  })
})

describe('what a window does to the days around it', () => {
  const illness = (endDate: string) => ({
    reason: 'illness-above-neck' as const,
    mode: 'rest' as const,
    startDate: '2026-10-22',
    endDate,
  })

  test('is told in order from the same module the engine plans with', () => {
    expect(windowSentences(illness('2026-10-23'), [], 'km')).toEqual([
      'Rest from Thu 22 Oct to Sat 24 Oct.',
      'Easy running only from Sun 25 Oct to Tue 27 Oct.',
      'Back to the planned week on Wed 28 Oct.',
    ])
  })

  test('counts a window that touches another as one layoff', () => {
    const other = makeWindow({
      id: 'w0',
      startDate: '2026-10-14',
      endDate: '2026-10-21',
      reason: 'niggle',
      pain: 3,
    })
    const alone = windowSentences(illness('2026-10-23'), [], 'km')
    const together = windowSentences(illness('2026-10-23'), [other], 'km')
    // The two windows are 12 days without running, so the return is held to the J7 fraction.
    expect(together.length).toBeGreaterThan(alone.length)
    expect(together.at(-1)).toMatch(/held to 90% of the week before/)
  })

  test('leaves out a window that was withdrawn', () => {
    const withdrawn = makeWindow({
      id: 'w0',
      status: 'undone',
      startDate: '2026-10-14',
      endDate: '2026-10-21',
    })
    expect(windowSentences(illness('2026-10-23'), [withdrawn], 'km')).toEqual(
      windowSentences(illness('2026-10-23'), [], 'km'),
    )
  })
})

describe('the figures of a preview', () => {
  // Today is Thursday 22 October; the four weeks run to Wednesday 18 November.
  const run = (date: string, durationMin: number, over = {}) => ({
    date,
    kind: 'easy' as const,
    durationMin,
    status: 'planned' as const,
    ...over,
  })
  const sessions = [
    run('2026-10-20', 60), // before today
    run('2026-10-22', 50),
    run('2026-10-25', 90, { kind: 'long' }),
    run('2026-10-23', 30, { kind: 'strength' }),
    run('2026-10-27', 40, { status: 'skipped' }),
    run('2026-11-18', 45), // the last day
    run('2026-11-19', 45), // one day too far
  ]
  const brief = (date: string, kind: SessionKind, durationMin: number) =>
    makeBrief({ date, kind, durationMin, title: kind })

  test('adds up the runs still to come in the next four weeks, before and after', () => {
    const diff = makeDiff([
      // a run day held as rest, a run cut short, and a run moved out of the four weeks
      makeLine({
        externalId: 'a',
        date: '2026-10-22',
        before: brief('2026-10-22', 'easy', 50),
        after: brief('2026-10-22', 'rest', 0),
      }),
      makeLine({
        externalId: 'b',
        date: '2026-10-25',
        before: brief('2026-10-25', 'long', 90),
        after: brief('2026-10-25', 'long', 60),
      }),
      makeLine({
        externalId: 'c',
        date: '2026-11-18',
        before: brief('2026-11-18', 'easy', 45),
        after: brief('2026-11-19', 'easy', 45),
      }),
      // a run added
      makeLine({
        change: 'added',
        externalId: 'd',
        date: '2026-10-30',
        before: null,
        after: brief('2026-10-30', 'easy', 25),
      }),
    ])
    // 50 + 90 + 45 to come now; strength, a skipped run and days outside the weeks do not count.
    // After: 0 + 60 + 0 + 25.
    expect(runMinOverNextWeeks(sessions, diff, '2026-10-22')).toEqual({ before: 185, after: 85 })
  })

  test('a diff that changes no run leaves the total as it is', () => {
    expect(runMinOverNextWeeks(sessions, makeDiff([]), '2026-10-22')).toEqual({
      before: 185,
      after: 185,
    })
  })

  test('has no figure when no run is planned in those weeks', () => {
    expect(runMinOverNextWeeks(sessions, makeDiff([]), '2027-03-01')).toBeNull()
    expect(runMinOverNextWeeks([], makeDiff([]), '2026-10-22')).toBeNull()
  })

  test('keeps only the warnings the plan does not carry already', () => {
    const known = {
      code: 'ramp',
      severity: 'warn' as const,
      message: 'Held at the limit.',
      rules: [],
    }
    const added = { code: 'gap', severity: 'info' as const, message: 'A long gap.', rules: [] }
    expect(newWarnings([known, added], [known])).toEqual([added])
    // The same code with another message is a different warning.
    expect(newWarnings([{ ...known, message: 'Held at 10%.' }], [known])).toHaveLength(1)
    expect(newWarnings([], [known])).toEqual([])
  })

  test('says whether a window covers a day, ends included', () => {
    const window = { startDate: '2026-10-22', endDate: '2026-10-24' }
    expect(windowCovers(window, '2026-10-21')).toBe(false)
    expect(windowCovers(window, '2026-10-22')).toBe(true)
    expect(windowCovers(window, '2026-10-24')).toBe(true)
    expect(windowCovers(window, '2026-10-25')).toBe(false)
  })
})
